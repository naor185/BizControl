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
from app.core.security import create_access_token, create_refresh_token, decode_token, create_set_password_token, JWT_SECRET, JWT_ALG
from app.core.auth_deps import get_current_user
from app.models.studio import Studio
from app.models.user import User
from app.models.refresh_token import RefreshToken
from app.schemas.auth_schemas import LoginRequest, TokenResponse, RefreshRequest
from app.utils.email_utils import send_email_sync
from app.utils.email_templates import reset_password_email_html
from jose import jwt as jose_jwt

router = APIRouter(prefix="/auth", tags=["Auth"])
ph = PasswordHasher()

TOTP_ISSUER = "BizControl"
PENDING_TOKEN_MINUTES = 5

LOGIN_FAILURE_THRESHOLD = 5
LOGIN_FAILURE_WINDOW = timedelta(minutes=30)
LOGIN_ALERT_COOLDOWN = timedelta(hours=1)
LOGIN_LOCKOUT_DURATION = timedelta(minutes=15)


def _track_login_failure(db: Session, user: User, reason: str) -> None:
    """Count repeated failed login attempts against a real account, lock the
    ACCOUNT (not the caller's IP — trivially defeated by switching VPN/proxy)
    once the threshold is crossed, and email the studio owner(s). Best-effort
    — must never break the login flow itself."""
    try:
        from sqlalchemy import text as _text
        now = datetime.now(timezone.utc)
        studio_id = str(user.studio_id)
        email = user.email

        row = db.execute(
            _text("SELECT failure_count, first_failure_at, last_alerted_at FROM login_failure_tracking WHERE studio_id = :sid AND email = :email"),
            {"sid": studio_id, "email": email},
        ).fetchone()

        if row and row[1] and (now - row[1]) < LOGIN_FAILURE_WINDOW:
            new_count = row[0] + 1
            first_failure_at = row[1]
        else:
            new_count = 1
            first_failure_at = now
        last_alerted_at = row[2] if row else None

        locked_until = now + LOGIN_LOCKOUT_DURATION if new_count >= LOGIN_FAILURE_THRESHOLD else None

        db.execute(
            _text("""
                INSERT INTO login_failure_tracking (studio_id, email, failure_count, first_failure_at, last_failure_at, last_alerted_at, locked_until)
                VALUES (:sid, :email, :cnt, :first, :now, :alerted, :locked)
                ON CONFLICT (studio_id, email)
                DO UPDATE SET failure_count = :cnt, first_failure_at = :first, last_failure_at = :now,
                    locked_until = COALESCE(:locked, login_failure_tracking.locked_until)
            """),
            {"sid": studio_id, "email": email, "cnt": new_count, "first": first_failure_at, "now": now, "alerted": last_alerted_at, "locked": locked_until},
        )
        db.commit()

        if new_count >= LOGIN_FAILURE_THRESHOLD and (not last_alerted_at or (now - last_alerted_at) >= LOGIN_ALERT_COOLDOWN):
            db.execute(
                _text("UPDATE login_failure_tracking SET last_alerted_at = :now WHERE studio_id = :sid AND email = :email"),
                {"now": now, "sid": studio_id, "email": email},
            )
            db.commit()
            _send_login_alert(db, user, new_count, reason)
    except Exception:
        log.exception("[login-alert] failed to track/alert on login failure")


def _get_lockout(db: Session, user: User) -> datetime | None:
    """Returns the lockout expiry if this account is currently locked, else None."""
    try:
        from sqlalchemy import text as _text
        row = db.execute(
            _text("SELECT locked_until FROM login_failure_tracking WHERE studio_id = :sid AND email = :email"),
            {"sid": str(user.studio_id), "email": user.email},
        ).fetchone()
        if row and row[0] and row[0] > datetime.now(timezone.utc):
            return row[0]
    except Exception:
        log.exception("[login-alert] failed to check lockout status")
    return None


def _raise_if_locked(db: Session, user: User) -> None:
    """Call once credentials (password and/or 2FA) have already verified
    correct — only at that point does distinguishing 'locked' from 'invalid
    credentials' not leak anything an attacker doesn't already know."""
    locked_until = _get_lockout(db, user)
    if locked_until:
        minutes_left = max(1, int((locked_until - datetime.now(timezone.utc)).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=423,
            detail=f"account_locked:{minutes_left}",
        )


def _send_login_alert(db: Session, user: User, failure_count: int, reason: str) -> None:
    owners = db.query(User).filter(
        User.studio_id == user.studio_id, User.role == "owner", User.is_active == True,  # noqa: E712
    ).all()
    if not owners:
        return
    from app.services.email_center import send_email as _ec_send_email
    lockout_minutes = int(LOGIN_LOCKOUT_DURATION.total_seconds() // 60)
    html = f"""
    <div dir="rtl" style="font-family:Arial,sans-serif;padding:20px">
        <h2 style="color:#dc2626">🔒 ניסיונות התחברות כושלים חוזרים — החשבון ננעל זמנית</h2>
        <p>זוהו <b>{failure_count}</b> ניסיונות התחברות כושלים ({reason}) עבור החשבון <b>{user.email}</b> ב-30 הדקות האחרונות.</p>
        <p>החשבון ננעל אוטומטית ל-{lockout_minutes} דקות — גם אם הסיסמה הנכונה תוזן, ההתחברות תיחסם עד שהנעילה תפוג. הנעילה חלה על החשבון עצמו ולא תלויה בכתובת ה-IP או ה-VPN של מי שמנסה, כך שלא ניתן לעקוף אותה במעבר לרשת אחרת.</p>
        <p style="color:#64748b;font-size:12px">אם זה לא היית אתה — כדאי לשקול לאפס סיסמה לחשבון זה. התראה זו לא תישלח שוב על אותו חשבון למשך שעה.</p>
    </div>
    """
    for owner in owners:
        try:
            _ec_send_email(
                db, to_email=owner.email, subject=f"🔒 BizControl: ניסיונות התחברות כושלים חוזרים — {user.email}",
                html_content=html, from_name="BizControl Security", email_type="system",
            )
        except Exception:
            log.exception("[login-alert] failed to send alert email to owner")


def _reset_login_failures(db: Session, user: User) -> None:
    try:
        from sqlalchemy import text as _text
        db.execute(
            _text("DELETE FROM login_failure_tracking WHERE studio_id = :sid AND email = :email"),
            {"sid": str(user.studio_id), "email": user.email},
        )
        db.commit()
    except Exception:
        log.exception("[login-alert] failed to reset login failure tracking")


def _create_pending_token(user_id: str, studio_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=PENDING_TOKEN_MINUTES)
    return jose_jwt.encode(
        {"type": "2fa_pending", "user_id": user_id, "studio_id": studio_id, "exp": exp},
        JWT_SECRET, algorithm=JWT_ALG,
    )


def _issue_full_tokens(user: User, db: Session) -> TokenResponse:
    access = create_access_token({"user_id": str(user.id), "studio_id": str(user.studio_id), "role": user.role})
    refresh = create_refresh_token({"user_id": str(user.id), "studio_id": str(user.studio_id)})
    db.add(RefreshToken(id=uuid.uuid4(), studio_id=user.studio_id, user_id=user.id, token=refresh, is_revoked=False))
    db.commit()
    return TokenResponse(access_token=access, refresh_token=refresh)


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
        _track_login_failure(db, user, "סיסמה שגויה")
        raise HTTPException(status_code=401, detail="invalid_credentials")

    _raise_if_locked(db, user)

    if user.totp_secret:
        return {
            "requires_2fa": True,
            "pending_token": _create_pending_token(str(user.id), str(studio.id)),
        }

    _reset_login_failures(db, user)
    return _issue_full_tokens(user, db)


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
        _track_login_failure(db, user, "קוד אימות דו-שלבי שגוי — הסיסמה כבר הוזנה נכון")
        raise HTTPException(status_code=401, detail="קוד שגוי — נסה שנית")

    _raise_if_locked(db, user)
    _reset_login_failures(db, user)
    return _issue_full_tokens(user, db)


# ── Login by email only (no slug — for owners with a single studio) ───────────

class EmailLoginIn(BaseModel):
    email: str
    password: str


@router.post("/login-by-email")
@limiter.limit("10/minute")
def login_by_email(request: Request, payload: EmailLoginIn, db: Session = Depends(get_db)):
    """Login without studio slug — finds owner/admin by email alone."""
    from argon2.exceptions import VerifyMismatchError as _VE
    email = payload.email.lower().strip()
    user = db.query(User).filter(
        User.email == email,
        User.is_active == True,  # noqa
        User.role.in_(["owner", "admin", "superadmin"]),
    ).order_by(User.created_at).first()
    if not user:
        raise HTTPException(status_code=401, detail="invalid_credentials")
    try:
        ph.verify(user.password_hash, payload.password)
    except _VE:
        _track_login_failure(db, user, "סיסמה שגויה")
        raise HTTPException(status_code=401, detail="invalid_credentials")

    _raise_if_locked(db, user)

    if user.totp_secret:
        return {
            "requires_2fa": True,
            "pending_token": _create_pending_token(str(user.id), str(user.studio_id)),
        }
    _reset_login_failures(db, user)
    return _issue_full_tokens(user, db)


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

    token_row = db.query(RefreshToken).filter(
        RefreshToken.token == payload.refresh_token,
        RefreshToken.is_revoked == False,  # noqa: E712
    ).first()
    if not token_row:
        raise HTTPException(status_code=401, detail="Refresh token revoked or not found")

    user = db.query(User).filter(User.id == user_id, User.studio_id == studio_id, User.is_active == True).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access = create_access_token({"user_id": str(user.id), "studio_id": str(user.studio_id), "role": user.role})
    new_refresh = create_refresh_token({"user_id": str(user.id), "studio_id": str(user.studio_id)})

    token_row.is_revoked = True
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
        raise HTTPException(status_code=404, detail="email_not_found")

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
    }


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
