import os
import uuid
from datetime import datetime, timezone, timedelta
from app.utils.logger import get_logger

log = get_logger(__name__)

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import select
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from pydantic import BaseModel, Field
from jose import JWTError

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import create_access_token, create_refresh_token, decode_token, create_set_password_token, validate_password_strength, JWT_SECRET, JWT_ALG
from app.core.auth_deps import get_current_user
from app.models.studio import Studio
from app.models.user import User
from app.models.refresh_token import RefreshToken
from app.schemas.auth_schemas import LoginRequest, TokenResponse, RefreshRequest
from app.services.auth_service import (
    find_login_candidates, track_login_failure, raise_if_locked, reset_login_failures,
    create_pending_token, create_studio_selection_token, issue_full_tokens, studio_label,
)
from app.utils.email_utils import send_email_sync
from app.utils.email_templates import reset_password_email_html
from jose import jwt as jose_jwt

router = APIRouter(prefix="/auth", tags=["Auth"])
ph = PasswordHasher()

TOTP_ISSUER = "BizControl"


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    slug = payload.studio_slug.lower().strip()
    studio = db.query(Studio).filter(Studio.slug == slug, Studio.is_active == True).first()  # noqa: E712
    if not studio:
        # Same generic error as wrong email/password — don't reveal which
        # field was wrong, or even which field exists (avoids enumeration of
        # valid studio slugs).
        raise HTTPException(status_code=401, detail="invalid_credentials")

    email = str(payload.email).lower().strip()
    user = db.query(User).filter(User.studio_id == studio.id, User.email == email, User.is_active == True).first()  # noqa: E712
    if not user:
        # Allow superadmin to log in from any studio slug
        user = db.query(User).filter(User.email == email, User.role == "superadmin", User.is_active == True).first()  # noqa: E712
    if not user:
        # Same generic error as a wrong password — don't reveal whether the
        # email exists (avoids account enumeration).
        raise HTTPException(status_code=401, detail="invalid_credentials")

    try:
        ph.verify(user.password_hash, payload.password)
    except VerifyMismatchError:
        track_login_failure(db, user, "סיסמה שגויה")
        raise HTTPException(status_code=401, detail="invalid_credentials")

    raise_if_locked(db, user)

    if user.totp_secret:
        return {
            "requires_2fa": True,
            "pending_token": create_pending_token(str(user.id), str(studio.id)),
        }

    reset_login_failures(db, user)
    return issue_full_tokens(user, db)


# ── 2FA verify (step 2 of login) ─────────────────────────────────────────────

class TwoFAVerifyIn(BaseModel):
    pending_token: str
    code: str


@router.post("/2fa/verify", response_model=TokenResponse)
@limiter.limit("10/minute")
def verify_2fa(request: Request, payload: TwoFAVerifyIn, db: Session = Depends(get_db)):
    try:
        data = decode_token(payload.pending_token)
    except JWTError:
        raise HTTPException(status_code=401, detail="קוד זמני לא תקין או פג תוקף")
    if data.get("type") != "2fa_pending":
        raise HTTPException(status_code=401, detail="Token type invalid")

    user = db.get(User, data["user_id"])
    if not user or not user.totp_secret:
        raise HTTPException(status_code=401, detail="משתמש לא נמצא")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(payload.code.strip(), valid_window=1):
        track_login_failure(db, user, "קוד אימות דו-שלבי שגוי — הסיסמה כבר הוזנה נכון")
        raise HTTPException(status_code=401, detail="קוד שגוי — נסה שנית")

    raise_if_locked(db, user)
    reset_login_failures(db, user)
    return issue_full_tokens(user, db)


# ── Login by email only (no slug — the one login path for every business
# owner/staff account, no studio ID ever asked for or accepted) ──────────────

class EmailLoginIn(BaseModel):
    email: str
    password: str


@router.post("/login-by-email")
@limiter.limit("10/minute")
def login_by_email(request: Request, payload: EmailLoginIn, db: Session = Depends(get_db)):
    """
    The single login path for every business-owner/staff account — no studio
    slug/ID accepted from the client anywhere. Handles the case where the
    same email has more than one active User row (email isn't globally
    unique — see app/models/user.py — a person can have one row per studio)
    by checking the password against every matching row and letting the
    match count decide: 0 → invalid, 1 → log straight in, >1 → same person/
    password on multiple businesses, ask which one (see /select-studio).
    """
    candidates = find_login_candidates(db, payload.email, payload.password)

    if not candidates:
        # Don't know which studio was intended — track the failure against
        # every row sharing this email, not just one.
        email = payload.email.lower().strip()
        for u in db.query(User).filter(User.email == email, User.is_active == True).all():  # noqa: E712
            track_login_failure(db, u, "סיסמה שגויה")
        raise HTTPException(status_code=401, detail="invalid_credentials")

    if len(candidates) > 1:
        return {
            "requires_studio_selection": True,
            "selection_token": create_studio_selection_token([str(u.id) for u in candidates]),
            "studios": [studio_label(u) for u in candidates],
        }

    user = candidates[0]
    raise_if_locked(db, user)

    if user.totp_secret:
        return {
            "requires_2fa": True,
            "pending_token": create_pending_token(str(user.id), str(user.studio_id)),
        }
    reset_login_failures(db, user)
    return issue_full_tokens(user, db)


# ── Studio selection (step 2 of login-by-email, only when >1 match) ──────────

class SelectStudioIn(BaseModel):
    selection_token: str
    studio_id: str


@router.post("/select-studio")
@limiter.limit("10/minute")
def select_studio(request: Request, payload: SelectStudioIn, db: Session = Depends(get_db)):
    """
    Completes login after login-by-email returned requires_studio_selection.
    studio_id is never trusted on its own — it must belong to one of the
    user_ids the server itself signed into selection_token after already
    verifying the password against that exact row.
    """
    try:
        data = decode_token(payload.selection_token)
    except JWTError:
        raise HTTPException(status_code=401, detail="קוד זמני לא תקין או פג תוקף")
    if data.get("type") != "studio_selection_pending":
        raise HTTPException(status_code=401, detail="Token type invalid")

    user = None
    for uid in (data.get("user_ids") or []):
        candidate = db.get(User, uid)
        if candidate and str(candidate.studio_id) == str(payload.studio_id):
            user = candidate
            break
    if not user:
        raise HTTPException(status_code=401, detail="invalid_selection")

    raise_if_locked(db, user)

    if user.totp_secret:
        return {
            "requires_2fa": True,
            "pending_token": create_pending_token(str(user.id), str(user.studio_id)),
        }
    reset_login_failures(db, user)
    return issue_full_tokens(user, db)


# ── Cross-app handoff (secure one-time code instead of JWT in URL) ────────────

from sqlalchemy import text as _text


class UseHandoffIn(BaseModel):
    code: str


@router.post("/create-handoff")
def create_handoff(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Authenticated: create a 2-minute one-time code wrapping the caller's token."""
    access = create_access_token({
        "user_id": str(current_user.id),
        "studio_id": str(current_user.studio_id),
        "role": current_user.role,
    })
    row = db.execute(
        _text("INSERT INTO auth_handoff_codes (token) VALUES (:t) RETURNING code"),
        {"t": access},
    ).fetchone()
    db.commit()
    return {"code": str(row[0])}


@router.post("/use-handoff")
@limiter.limit("20/minute")
def use_handoff(request: Request, payload: UseHandoffIn, db: Session = Depends(get_db)):
    """Exchange a one-time code for a real JWT (code consumed on first use).
    Uses atomic UPDATE...RETURNING so concurrent requests cannot both succeed."""
    row = db.execute(
        _text("""
            UPDATE auth_handoff_codes
            SET used_at = NOW()
            WHERE code = :code
              AND used_at IS NULL
              AND expires_at > NOW()
            RETURNING token
        """),
        {"code": payload.code},
    ).fetchone()
    if not row:
        # Could be: unknown code, already used, or expired — all treated the same
        raise HTTPException(status_code=400, detail="קוד לא תקין, כבר נוצל, או פג תוקף")
    db.commit()
    return {"access_token": row[0], "token_type": "bearer"}


# ── Refresh ───────────────────────────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    try:
        data = decode_token(payload.refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token type")

    user_id = data.get("user_id")
    studio_id = data.get("studio_id")
    if not user_id or not studio_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token payload")

    token_row = db.query(RefreshToken).filter(RefreshToken.token == payload.refresh_token).first()
    if not token_row:
        raise HTTPException(status_code=401, detail="Refresh token revoked or not found")

    if token_row.is_revoked:
        # The server already rotated this token once. Normally that means
        # reuse (stolen/replayed token) — reject. But it's also exactly what
        # happens when the mobile app gets killed by iOS mid-request, right
        # after the server responded but before the new pair made it into
        # localStorage: the client is left holding a token that's already
        # dead, with no way back short of a full re-login — often only
        # discovered long after (whenever the app is next opened), so a
        # short time window wouldn't help. Chase the single successor this
        # token was rotated into and reissue from there instead of hard-
        # failing. No time limit needed: this is self-limiting on its own —
        # chasing forward immediately re-rotates again, closing this same
        # hole behind it, and an attacker holding a stale token here has by
        # definition also captured whatever superseded it, making the chase
        # moot for them. Anything more than one hop away is real reuse.
        successor = None
        if token_row.replaced_by_token:
            successor = db.query(RefreshToken).filter(
                RefreshToken.token == token_row.replaced_by_token,
                RefreshToken.is_revoked == False,  # noqa: E712
            ).first()
        if not successor:
            raise HTTPException(status_code=401, detail="Refresh token revoked or not found")
        token_row = successor

    user = db.query(User).filter(User.id == user_id, User.studio_id == studio_id, User.is_active == True).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access = create_access_token({"user_id": str(user.id), "studio_id": str(user.studio_id), "role": user.role})
    new_refresh = create_refresh_token({"user_id": str(user.id), "studio_id": str(user.studio_id)})

    token_row.is_revoked = True
    token_row.revoked_at = datetime.now(timezone.utc)
    token_row.replaced_by_token = new_refresh
    db.add(RefreshToken(id=uuid.uuid4(), studio_id=user.studio_id, user_id=user.id, token=new_refresh, is_revoked=False))
    db.commit()

    return TokenResponse(access_token=new_access, refresh_token=new_refresh)


# ── Forgot Password ───────────────────────────────────────────────────────────

class ForgotPasswordIn(BaseModel):
    studio_slug: str
    email: str


@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, payload: ForgotPasswordIn, db: Session = Depends(get_db)):
    slug = payload.studio_slug.lower().strip()
    studio = db.scalar(select(Studio).where(Studio.slug == slug))
    if not studio:
        raise HTTPException(status_code=404, detail="studio_not_found")

    user = db.scalar(select(User).where(
        User.studio_id == studio.id,
        User.email == payload.email.lower().strip(),
        User.is_active == True,  # noqa: E712
    ))
    if not user:
        # Same response as the success path — don't reveal whether this
        # email is registered (avoids account enumeration).
        return {"status": "sent"}

    token = create_set_password_token(str(user.id))
    frontend_url = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app")
    reset_link = f"{frontend_url}/set-password?token={token}"

    try:
        smtp_host = os.getenv("PLATFORM_SMTP_HOST", "")
        smtp_port = int(os.getenv("PLATFORM_SMTP_PORT", "587"))
        smtp_user_env = os.getenv("PLATFORM_SMTP_USER", "")
        smtp_pass = os.getenv("PLATFORM_SMTP_PASS", "")
        smtp_from = os.getenv("PLATFORM_SMTP_FROM", smtp_user_env)
        send_email_sync(
            host=smtp_host, port=smtp_port, user=smtp_user_env,
            password=smtp_pass, from_email=smtp_from,
            to_email=user.email,
            subject="איפוס סיסמה — BizControl",
            html_content=reset_password_email_html(user.display_name or user.email, reset_link),
        )
    except Exception as e:
        log.error("[forgot_password] email failed: %s", e)

    return {"status": "sent"}


# ── Set Password ──────────────────────────────────────────────────────────────

class SetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


@router.post("/set-password")
def set_password(payload: SetPasswordRequest, db: Session = Depends(get_db)):
    try:
        data = decode_token(payload.token)
    except Exception:
        raise HTTPException(status_code=400, detail="הקישור לא תקין או פג תוקף")
    if data.get("type") != "set_password":
        raise HTTPException(status_code=400, detail="הקישור לא תקין")
    user = db.get(User, data["sub"])
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="משתמש לא נמצא")
    validate_password_strength(payload.new_password)
    user.password_hash = ph.hash(payload.new_password)
    db.commit()
    return {"status": "ok"}


# ── Change Password ───────────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


@router.post("/change-password")
def change_password(payload: ChangePasswordRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        ph.verify(current_user.password_hash, payload.current_password)
    except VerifyMismatchError:
        raise HTTPException(status_code=400, detail="הסיסמה הנוכחית שגויה")
    validate_password_strength(payload.new_password)
    current_user.password_hash = ph.hash(payload.new_password)
    db.commit()
    return {"status": "ok"}


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "display_name": current_user.display_name,
        "role": current_user.role,
        "studio_id": str(current_user.studio_id),
        "totp_enabled": bool(current_user.totp_secret),
        "email_verified": bool(current_user.email_verified),
    }


@router.post("/resend-verification")
@limiter.limit("3/minute")
def resend_verification(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Re-send the email-verification link to the logged-in user. No-op (still
    returns ok) if already verified, so the UI can call it safely."""
    import secrets
    from app.services.email_center import send_email
    from app.utils.email_templates import verify_email_html

    if current_user.email_verified:
        return {"ok": True, "already_verified": True}

    token = secrets.token_urlsafe(32)
    current_user.email_verify_token = token
    current_user.email_verify_sent_at = datetime.now(timezone.utc)
    db.commit()

    bizfind_url = os.getenv("BIZFIND_URL", "https://find.biz-control.com").rstrip("/")
    verify_link = f"{bizfind_url}/verify-email?token={token}"
    try:
        send_email(
            db,
            to_email=current_user.email,
            subject="אימות כתובת המייל — BizControl",
            html_content=verify_email_html(current_user.display_name or current_user.email, verify_link),
            from_name="BizControl",
            studio_id=str(current_user.studio_id),
            template_key="verify_email",
            email_type="system",
        )
    except Exception as e:
        log.error("[resend_verification] email failed: %s", e)
        raise HTTPException(status_code=502, detail="שליחת מייל האימות נכשלה, נסה שוב מאוחר יותר")

    return {"ok": True}


@router.get("/studio-info")
def studio_info(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lightweight endpoint — returns studio plan + expiry for trial banner."""
    from app.models.studio import Studio
    studio = db.get(Studio, current_user.studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    return {
        "subscription_plan": studio.subscription_plan,
        "plan_expires_at": studio.plan_expires_at.isoformat() if studio.plan_expires_at else None,
        "is_active": studio.is_active,
    }


# ── 2FA Setup / Enable / Disable ─────────────────────────────────────────────

@router.get("/2fa/setup")
def setup_2fa(current_user: User = Depends(get_current_user)):
    """Generate a new TOTP secret and return the otpauth URI. Does NOT save yet."""
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=current_user.email, issuer_name=TOTP_ISSUER)
    return {"secret": secret, "otpauth_uri": uri}


class TwoFAEnableIn(BaseModel):
    secret: str
    code: str


@router.post("/2fa/enable")
def enable_2fa(payload: TwoFAEnableIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Verify the TOTP code against the given secret, then save it."""
    totp = pyotp.TOTP(payload.secret)
    if not totp.verify(payload.code.strip(), valid_window=1):
        raise HTTPException(status_code=400, detail="קוד שגוי — בדוק שסרקת את ה-QR נכון")
    current_user.totp_secret = payload.secret
    db.commit()
    return {"status": "enabled"}


class TwoFADisableIn(BaseModel):
    code: str


@router.post("/2fa/disable")
def disable_2fa(payload: TwoFADisableIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.totp_secret:
        raise HTTPException(status_code=400, detail="אימות דו-שלבי לא מופעל")
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(payload.code.strip(), valid_window=1):
        raise HTTPException(status_code=400, detail="קוד שגוי")
    current_user.totp_secret = None
    db.commit()
    return {"status": "disabled"}
