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
from pydantic import BaseModel
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
        raise HTTPException(status_code=401, detail="studio_not_found")

    email = str(payload.email).lower().strip()
    user = db.query(User).filter(User.studio_id == studio.id, User.email == email, User.is_active == True).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=401, detail="email_not_found")

    try:
        ph.verify(user.password_hash, payload.password)
    except VerifyMismatchError:
        raise HTTPException(status_code=401, detail="wrong_password")

    if user.totp_secret:
        return {
            "requires_2fa": True,
            "pending_token": _create_pending_token(str(user.id), str(studio.id)),
        }

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
        raise HTTPException(status_code=401, detail="קוד שגוי — נסה שנית")

    return _issue_full_tokens(user, db)


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
    new_password: str


@router.post("/set-password")
def set_password(payload: SetPasswordRequest, db: Session = Depends(get_db)):
    try:
        data = decode_token(payload.token)
    except Exception:
        raise HTTPException(status_code=400, detail="הקישור לא תקין או פג תוקף")
    if data.get("type") != "set_password":
        raise HTTPException(status_code=400, detail="הקישור לא תקין")
    user = db.get(User, data["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="משתמש לא נמצא")
    user.password_hash = ph.hash(payload.new_password)
    db.commit()
    return {"status": "ok"}


# ── Change Password ───────────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


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
