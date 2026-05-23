"""
Business PIN Security API

GET  /api/security/pin/status   — is PIN set? is locked?
POST /api/security/pin/set      — set or change PIN (requires current PIN if already set)
POST /api/security/pin/verify   — verify PIN → returns short-lived business_unlock token
POST /api/security/pin/reset    — owner resets another user's PIN (owner/admin only)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.security import create_business_unlock_token, decode_token
from app.models.user_pin_settings import UserPinSettings
from app.models.pin_attempt_log import PinAttemptLog

router = APIRouter(prefix="/security", tags=["Business Security"])

ph = PasswordHasher()

MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_none(db: Session, user_id: uuid.UUID) -> UserPinSettings | None:
    return db.scalar(select(UserPinSettings).where(UserPinSettings.user_id == user_id))


def _log_attempt(db: Session, studio_id: uuid.UUID, user_id: uuid.UUID, success: bool, ip: str | None) -> None:
    db.add(PinAttemptLog(studio_id=studio_id, user_id=user_id, success=success, ip_address=ip))


def _get_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return getattr(request.client, "host", None)


# ── Schemas ───────────────────────────────────────────────────────────────────

class PinIn(BaseModel):
    pin: str

    @field_validator("pin")
    @classmethod
    def validate_pin(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or len(v) != 4:
            raise ValueError("PIN חייב להיות 4 ספרות")
        return v


class SetPinIn(BaseModel):
    pin: str
    current_pin: Optional[str] = None  # required only if PIN already set

    @field_validator("pin")
    @classmethod
    def validate_pin(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or len(v) != 4:
            raise ValueError("PIN חייב להיות 4 ספרות")
        return v


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/pin/status")
def pin_status(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    settings = _get_or_none(db, ctx.user_id)
    if not settings:
        return {"has_pin": False, "is_locked": False, "locked_until": None}

    now = datetime.now(timezone.utc)
    is_locked = bool(settings.locked_until and settings.locked_until > now)
    return {
        "has_pin": True,
        "is_locked": is_locked,
        "locked_until": settings.locked_until.isoformat() if is_locked else None,
    }


@router.post("/pin/set")
def set_pin(
    body: SetPinIn,
    request: Request,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    settings = _get_or_none(db, ctx.user_id)

    # If PIN already exists, require current PIN to change it
    if settings:
        now = datetime.now(timezone.utc)
        if settings.locked_until and settings.locked_until > now:
            remaining = int((settings.locked_until - now).total_seconds() / 60)
            raise HTTPException(status_code=429, detail=f"חשבון נעול. נסה שוב בעוד {remaining} דקות")

        if not body.current_pin:
            raise HTTPException(status_code=400, detail="נדרש PIN נוכחי לשינוי")

        try:
            ph.verify(settings.pin_hash, body.current_pin)
        except VerifyMismatchError:
            settings.failed_attempts += 1
            if settings.failed_attempts >= MAX_ATTEMPTS:
                settings.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            _log_attempt(db, ctx.studio_id, ctx.user_id, False, _get_ip(request))
            db.commit()
            raise HTTPException(status_code=400, detail="PIN שגוי")

        settings.pin_hash = ph.hash(body.pin)
        settings.failed_attempts = 0
        settings.locked_until = None
        settings.updated_at = datetime.now(timezone.utc)
    else:
        # First time setting PIN
        settings = UserPinSettings(
            studio_id=ctx.studio_id,
            user_id=ctx.user_id,
            pin_hash=ph.hash(body.pin),
        )
        db.add(settings)

    _log_attempt(db, ctx.studio_id, ctx.user_id, True, _get_ip(request))
    db.commit()
    return {"ok": True, "message": "PIN הוגדר בהצלחה"}


@router.post("/pin/verify")
def verify_pin(
    body: PinIn,
    request: Request,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    settings = _get_or_none(db, ctx.user_id)
    if not settings:
        raise HTTPException(status_code=404, detail="PIN לא הוגדר עדיין. הגדר PIN בהגדרות חשבון")

    now = datetime.now(timezone.utc)

    # Check lockout
    if settings.locked_until and settings.locked_until > now:
        remaining = int((settings.locked_until - now).total_seconds() / 60) + 1
        _log_attempt(db, ctx.studio_id, ctx.user_id, False, _get_ip(request))
        db.commit()
        raise HTTPException(status_code=429, detail=f"חשבון נעול. נסה שוב בעוד {remaining} דקות")

    # Verify
    try:
        ph.verify(settings.pin_hash, body.pin)
    except VerifyMismatchError:
        settings.failed_attempts += 1
        if settings.failed_attempts >= MAX_ATTEMPTS:
            settings.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            _log_attempt(db, ctx.studio_id, ctx.user_id, False, _get_ip(request))
            db.commit()
            raise HTTPException(
                status_code=429,
                detail=f"יותר מדי ניסיונות כושלים. חשבון נעול ל-{LOCKOUT_MINUTES} דקות"
            )
        remaining_attempts = MAX_ATTEMPTS - settings.failed_attempts
        _log_attempt(db, ctx.studio_id, ctx.user_id, False, _get_ip(request))
        db.commit()
        raise HTTPException(status_code=400, detail=f"PIN שגוי. נותרו {remaining_attempts} ניסיונות")

    # Success — reset attempts, issue unlock token
    settings.failed_attempts = 0
    settings.locked_until = None
    _log_attempt(db, ctx.studio_id, ctx.user_id, True, _get_ip(request))
    db.commit()

    token = create_business_unlock_token(str(ctx.user_id), str(ctx.studio_id))
    return {"business_token": token, "expires_in_minutes": 30}


@router.post("/pin/reset/{target_user_id}")
def reset_user_pin(
    target_user_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Owner/admin can reset another user's PIN (forces them to set a new one)."""
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="אין הרשאה")

    settings = db.scalar(
        select(UserPinSettings).where(
            UserPinSettings.user_id == target_user_id,
            UserPinSettings.studio_id == ctx.studio_id,
        )
    )
    if settings:
        db.delete(settings)
        db.commit()
    return {"ok": True, "message": "PIN אופס. המשתמש יצטרך להגדיר PIN חדש"}
