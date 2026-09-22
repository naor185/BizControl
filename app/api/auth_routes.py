import os
import uuid
from datetime import datetime, timezone, timedelta
from app.utils.logger import get_logger

log = get_logger(__name__)

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from pydantic import BaseModel, Field
from jose import JWTError

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import create_access_token, create_refresh_token, decode_token, create_set_password_token, validate_password_strength, JWT_SECRET, JWT_ALG
from app.core.auth_deps import get_current_user
from app.core.permissions import require_roles, Perms
from app.models.studio import Studio
from app.models.user import User
from app.models.refresh_token import RefreshToken
from app.schemas.auth_schemas import LoginRequest, TokenResponse, RefreshRequest, SessionOut
from app.services.auth_service import (
    find_login_candidates, track_login_failure, raise_if_locked, reset_login_failures,
    create_pending_token, create_studio_selection_token, issue_full_tokens, studio_label,
)
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
    return issue_full_tokens(user, db, user_agent=request.headers.get("user-agent"))


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
    return issue_full_tokens(user, db, user_agent=request.headers.get("user-agent"))


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
    return issue_full_tokens(user, db, user_agent=request.headers.get("user-agent"))


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
    return issue_full_tokens(user, db, user_agent=request.headers.get("user-agent"))


# ── Cross-app handoff (secure one-time code instead of JWT in URL) ────────────

from sqlalchemy import text as _text


class UseHandoffIn(BaseModel):
    code: str


@router.post("/create-handoff")
def create_handoff(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Authenticated: create a 2-minute one-time code wrapping a real
    access+refresh pair for the caller (issue_full_tokens — same as any other
    login path), so a session that arrives via /auto-login is a genuine
    persistent login too, not one that dies the moment the access token
    expires. Previously issued an access-only token here."""
    tokens = issue_full_tokens(current_user, db, user_agent=request.headers.get("user-agent"))
    row = db.execute(
        _text("INSERT INTO auth_handoff_codes (token, refresh_token) VALUES (:t, :r) RETURNING code"),
        {"t": tokens.access_token, "r": tokens.refresh_token},
    ).fetchone()
    db.commit()
    return {"code": str(row[0])}


@router.post("/use-handoff")
@limiter.limit("20/minute")
def use_handoff(request: Request, payload: UseHandoffIn, db: Session = Depends(get_db)):
    """Exchange a one-time code for a real JWT pair (code consumed on first
    use). Uses atomic UPDATE...RETURNING so concurrent requests cannot both
    succeed."""
    row = db.execute(
        _text("""
            UPDATE auth_handoff_codes
            SET used_at = NOW()
            WHERE code = :code
              AND used_at IS NULL
              AND expires_at > NOW()
            RETURNING token, refresh_token
        """),
        {"code": payload.code},
    ).fetchone()
    if not row:
        # Could be: unknown code, already used, or expired — all treated the same
        raise HTTPException(status_code=400, detail="קוד לא תקין, כבר נוצל, או פג תוקף")
    db.commit()
    return {"access_token": row[0], "refresh_token": row[1], "token_type": "bearer"}


# ── Refresh ───────────────────────────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
def refresh(request: Request, payload: RefreshRequest, db: Session = Depends(get_db)):
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
        # storage: the client is left holding a token that's already dead,
        # with no way back short of a full re-login — often only discovered
        # long after (whenever the app is next opened), so a short time
        # window wouldn't help. Chase the chain of successors this token
        # was rotated into and reissue from the live end of it, instead of
        # hard-failing. Bounded at a handful of hops (not unbounded) purely
        # as a sanity cap against a corrupted chain looping — legitimate
        # chains are always this short, since every hop the client actually
        # uses stops the chase right there. No time limit: this is
        # self-limiting on its own — chasing forward immediately re-rotates
        # again, closing this same hole behind it, and an attacker holding a
        # stale token here has by definition also captured whatever
        # superseded it, making the chase moot for them.
        successor = None
        cursor = token_row
        for _ in range(5):
            if not cursor.replaced_by_token:
                break
            nxt = db.query(RefreshToken).filter(
                RefreshToken.token == cursor.replaced_by_token,
            ).first()
            if not nxt:
                break
            if not nxt.is_revoked:
                successor = nxt
                break
            cursor = nxt
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
    db.add(RefreshToken(
        id=uuid.uuid4(), studio_id=user.studio_id, user_id=user.id, token=new_refresh, is_revoked=False,
        # Carried forward from the row being rotated, not reset — this is
        # still the same session/device as far as the session-list UI is
        # concerned, just a later hop in its rotation chain. Falls back to
        # THIS request's own header only when the chain never had one at
        # all (sessions that started before this column existed, or from
        # any other pre-existing gap) — otherwise a legacy row would show
        # "unidentified device" forever, since nothing else ever revisits it.
        user_agent=token_row.user_agent or request.headers.get("user-agent"),
        session_started_at=token_row.session_started_at,
    ))
    db.commit()

    return TokenResponse(access_token=new_access, refresh_token=new_refresh)


# ── Sessions ("logged-in devices") — list / revoke ────────────────────────────
# A "session" here is a refresh-token rotation chain: at any moment exactly
# one row in that chain is non-revoked (see /refresh above, which always
# revokes the old row the instant it rotates), so "every non-revoked row for
# this user" is naturally "every currently active login/device" — no
# separate session-id concept needed.

def _session_out(row: RefreshToken) -> SessionOut:
    return SessionOut(
        id=str(row.id),
        user_agent=row.user_agent,
        session_started_at=row.session_started_at.isoformat() if row.session_started_at else None,
        last_active_at=row.created_at.isoformat(),
    )


@router.get("/sessions", response_model=list[SessionOut])
def list_my_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Self-service — 'which devices am I logged in on'."""
    rows = db.query(RefreshToken).filter(
        RefreshToken.user_id == current_user.id,
        RefreshToken.is_revoked == False,  # noqa: E712
    ).order_by(RefreshToken.created_at.desc()).all()
    return [_session_out(r) for r in rows]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_my_session(session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Self-service 'log out this device' — the next time that device tries
    to refresh, it's hard-rejected (nothing replaced this row, so the reuse-
    chase in /refresh has nowhere to go)."""
    row = db.query(RefreshToken).filter(
        RefreshToken.id == session_id, RefreshToken.user_id == current_user.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    row.is_revoked = True
    row.revoked_at = datetime.now(timezone.utc)
    db.commit()


@router.get("/users/{user_id}/sessions", response_model=list[SessionOut])
def list_user_sessions(
    user_id: str,
    current_user: User = Depends(require_roles(Perms.OWNER, Perms.ADMIN)),
    db: Session = Depends(get_db),
):
    """Owner/admin view of a staff member's active sessions — same studio only."""
    target = db.get(User, user_id)
    if not target or str(target.studio_id) != str(current_user.studio_id):
        raise HTTPException(status_code=404, detail="User not found")
    rows = db.query(RefreshToken).filter(
        RefreshToken.user_id == target.id,
        RefreshToken.is_revoked == False,  # noqa: E712
    ).order_by(RefreshToken.created_at.desc()).all()
    return [_session_out(r) for r in rows]


@router.delete("/users/{user_id}/sessions/{session_id}", status_code=204)
def revoke_user_session(
    user_id: str,
    session_id: str,
    current_user: User = Depends(require_roles(Perms.OWNER, Perms.ADMIN)),
    db: Session = Depends(get_db),
):
    """Force-logout a specific device belonging to another staff member in
    the same studio."""
    target = db.get(User, user_id)
    if not target or str(target.studio_id) != str(current_user.studio_id):
        raise HTTPException(status_code=404, detail="User not found")
    row = db.query(RefreshToken).filter(
        RefreshToken.id == session_id, RefreshToken.user_id == target.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    row.is_revoked = True
    row.revoked_at = datetime.now(timezone.utc)
    db.commit()


# ── Forgot Password ───────────────────────────────────────────────────────────
#
# Two independent recovery channels, both resolving the account from email
# alone (no studio ID — Unified Login already dropped it everywhere else;
# this was the one screen left behind). Email is not globally unique
# (uq_users_studio_email), so a shared email can own one User row per
# studio — both channels handle that by acting on every matching row.

class ForgotPasswordIn(BaseModel):
    email: str


def _gen_reset_code() -> str:
    import random, string
    return "".join(random.choices(string.digits, k=6))


def _normalize_il_phone(phone: str) -> str:
    clean = (phone or "").strip().replace("+", "").replace(" ", "").replace("-", "")
    if clean.startswith("0") and len(clean) >= 9:
        clean = "972" + clean[1:]
    return clean


def _send_reset_code_whatsapp(phone: str, code: str, db: Session) -> None:
    """Send a password-reset code over WhatsApp using the platform-level
    Green API instance (same credentials/pattern as
    marketplace_customer_routes.py's consumer OTP). This is account
    recovery for the business owner themselves, so it deliberately does
    NOT go through that studio's own WhatsApp integration — which may be
    unconfigured or broken, i.e. exactly when recovery is most needed."""
    clean = phone.lstrip("+").replace("-", "").replace(" ", "")
    if clean.startswith("0"):
        clean = "972" + clean[1:]
    chat_id = clean + "@c.us"
    msg = f"קוד האימות שלך לאיפוס סיסמה ב-BizControl: *{code}*\n\nהקוד תקף ל-10 דקות."

    wa_instance, wa_token = None, None
    try:
        row_i = db.execute(text("SELECT value FROM platform_config WHERE key='platform_wa_instance'")).fetchone()
        row_t = db.execute(text("SELECT value FROM platform_config WHERE key='platform_wa_token'")).fetchone()
        wa_instance = row_i[0] if row_i else None
        wa_token = row_t[0] if row_t else None
    except Exception as e:
        log.warning("[forgot_password_phone] platform_config read failed: %s", e)

    if not wa_instance or not wa_token:
        wa_instance = os.getenv("BIZFIND_WA_INSTANCE")
        wa_token = os.getenv("BIZFIND_WA_TOKEN")

    if not wa_instance or not wa_token:
        log.warning("[forgot_password_phone] no platform WhatsApp credentials configured")
        return

    try:
        import requests
        url = f"https://api.green-api.com/waInstance{wa_instance}/sendMessage/{wa_token}"
        requests.post(url, json={"chatId": chat_id, "message": msg}, timeout=10)
    except Exception as e:
        log.warning("[forgot_password_phone] WhatsApp send failed: %s", e)


@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, payload: ForgotPasswordIn, db: Session = Depends(get_db)):
    """Email a password-reset link. Resolves the account from email alone —
    sends one email per active studio membership sharing that address, each
    naming its studio so the recipient can tell them apart."""
    from app.services.email_center import send_email as send_platform_email

    email = payload.email.lower().strip()
    users = db.query(User).filter(User.email == email, User.is_active == True).all()  # noqa: E712
    if not users:
        # Same response as the success path — don't reveal whether this
        # email is registered (avoids account enumeration).
        return {"status": "sent"}

    frontend_url = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app")
    for user in users:
        token = create_set_password_token(str(user.id))
        reset_link = f"{frontend_url}/set-password?token={token}"
        studio = user.studio
        subject = "איפוס סיסמה — BizControl"
        if len(users) > 1 and studio:
            subject = f"איפוס סיסמה — BizControl ({studio.name})"
        try:
            send_platform_email(
                db,
                to_email=user.email,
                subject=subject,
                html_content=reset_password_email_html(user.display_name or user.email, reset_link),
                from_name="BizControl",
                studio_id=str(user.studio_id),
                template_key="forgot_password",
                email_type="system",
            )
        except Exception as e:
            log.error("[forgot_password] email failed for user %s: %s", user.id, e)

    return {"status": "sent"}


class ForgotPasswordPhoneIn(BaseModel):
    phone: str


class VerifyResetCodeIn(BaseModel):
    phone: str
    code: str


@router.post("/forgot-password/phone")
@limiter.limit("5/minute")
def forgot_password_phone(request: Request, payload: ForgotPasswordPhoneIn, db: Session = Depends(get_db)):
    """Alternative to the email link: the owner types their phone directly
    (not email — "recover via WhatsApp" means giving the phone WhatsApp
    will message, and doesn't require remembering which email a
    half-forgotten account used) and gets a 6-digit code over WhatsApp.
    Silently no-ops (same {"status": "sent"} response) when no active user
    has that phone on file — same anti-enumeration posture as the email
    path."""
    target = _normalize_il_phone(payload.phone)
    if not target:
        return {"status": "sent"}

    candidates = db.query(User).filter(User.phone.isnot(None), User.is_active == True).all()  # noqa: E712
    user = next((u for u in candidates if _normalize_il_phone(u.phone) == target), None)
    if not user:
        return {"status": "sent"}

    code = _gen_reset_code()
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.execute(text("UPDATE password_reset_otps SET used_at = NOW() WHERE user_id = :uid AND used_at IS NULL"), {"uid": str(user.id)})
    db.execute(
        text("INSERT INTO password_reset_otps (id, user_id, phone, code, expires_at) VALUES (:id, :uid, :phone, :code, :exp)"),
        {"id": str(uuid.uuid4()), "uid": str(user.id), "phone": target, "code": code, "exp": expires},
    )
    db.commit()
    _send_reset_code_whatsapp(user.phone, code, db)
    return {"status": "sent"}


@router.post("/forgot-password/verify-phone")
@limiter.limit("8/minute")
def forgot_password_verify_phone(request: Request, payload: VerifyResetCodeIn, db: Session = Depends(get_db)):
    """Verify a WhatsApp code and return a set-password token directly — the
    phone check IS the proof of ownership, so this skips the emailed link
    entirely and the frontend can jump straight to setting a new password."""
    target = _normalize_il_phone(payload.phone)
    code = payload.code.strip()
    now = datetime.now(timezone.utc)
    row = db.execute(
        text("""
            SELECT user_id FROM password_reset_otps
            WHERE phone = :phone AND code = :code
              AND expires_at > :now AND used_at IS NULL
            ORDER BY created_at DESC LIMIT 1
        """),
        {"phone": target, "code": code, "now": now},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="קוד שגוי או פג תוקף")

    db.execute(text("UPDATE password_reset_otps SET used_at = NOW() WHERE user_id = :uid AND code = :code"), {"uid": str(row[0]), "code": code})
    db.commit()

    user = db.get(User, row[0])
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="משתמש לא נמצא")

    token = create_set_password_token(str(user.id))
    return {"token": token}


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
        "phone": current_user.phone,
        "role": current_user.role,
        "studio_id": str(current_user.studio_id),
        "totp_enabled": bool(current_user.totp_secret),
        "email_verified": bool(current_user.email_verified),
    }


class UpdateMyPhoneIn(BaseModel):
    phone: str


@router.patch("/me/phone")
def update_my_phone(payload: UpdateMyPhoneIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lets the logged-in user set/change their own phone — needed for the
    WhatsApp password-recovery option to work at all (it matches against
    User.phone, which nothing else in the product ever asked an owner to
    fill in)."""
    current_user.phone = payload.phone.strip() or None
    db.commit()
    return {"phone": current_user.phone}


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

    # Every resend mints a genuinely fresh token and invalidates whatever
    # was sent before — by design: the owner explicitly wants a stale/failed
    # link to stop working and each "resend" to be a real, new attempt, not
    # a reuse of the same one under the hood. The verify page itself only
    # spends the token on an explicit click (not on page load), which is
    # what actually stops it from being silently burned by an email
    # security scanner before the person ever opens the message — that
    # protection doesn't depend on reusing tokens.
    token = secrets.token_urlsafe(32)
    current_user.email_verify_token = token
    current_user.email_verify_sent_at = datetime.now(timezone.utc)
    db.commit()

    bizfind_url = os.getenv("BIZFIND_URL", "https://find.biz-control.com").rstrip("/")
    verify_link = f"{bizfind_url}/verify-email?token={token}"
    try:
        # A different subject than the original signup email — Gmail (and
        # most mail clients) group messages into one conversation primarily
        # by exact subject match; with no In-Reply-To/References headers
        # set here to override that, every resend kept landing in the same
        # thread as the very first email, reading as "the same message"
        # even though the link inside was genuinely new each time.
        email_sent = send_email(
            db,
            to_email=current_user.email,
            subject="תזכורת: אימות כתובת המייל — BizControl",
            html_content=verify_email_html(current_user.display_name or current_user.email, verify_link),
            from_name="BizControl",
            studio_id=str(current_user.studio_id),
            template_key="verify_email",
            email_type="system",
        )
        if not email_sent:
            raise RuntimeError("send_email() returned False")
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
