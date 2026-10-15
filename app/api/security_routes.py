"""
Business PIN Security API

GET  /api/security/pin/status   — is PIN set? is locked?
POST /api/security/pin/set      — set or change PIN (requires current PIN if already set)
POST /api/security/pin/verify-owner — the business owner's PIN approves a discount at the till, whoever is there

The PIN approves a discount at the till and the export of the clients (data_export_routes). "ניהול עסק" doesn't ask
for it — only the owner and the managers reach it (the owner, 2026-10-15).
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


def _check_pin(db: Session, settings: UserPinSettings, pin: str, studio_id: uuid.UUID, actor_id: uuid.UUID,
               ip: str | None) -> None:
    """The PIN against these settings — the lockout, the wrong tries and the log; raises on a wrong or locked PIN.
    The tries count on the PIN's own settings; the log records who typed it (actor_id)."""
    now = datetime.now(timezone.utc)
    if settings.locked_until and settings.locked_until > now:
        remaining = int((settings.locked_until - now).total_seconds() / 60) + 1
        _log_attempt(db, studio_id, actor_id, False, ip)
        db.commit()
        raise HTTPException(status_code=429, detail=f"חשבון נעול. נסה שוב בעוד {remaining} דקות")
    try:
        ph.verify(settings.pin_hash, pin)
    except VerifyMismatchError:
        settings.failed_attempts += 1
        _log_attempt(db, studio_id, actor_id, False, ip)
        if settings.failed_attempts >= MAX_ATTEMPTS:
            settings.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            db.commit()
            raise HTTPException(status_code=429, detail=f"יותר מדי ניסיונות כושלים. חשבון נעול ל-{LOCKOUT_MINUTES} דקות")
        db.commit()
        raise HTTPException(status_code=400, detail=f"PIN שגוי. נותרו {MAX_ATTEMPTS - settings.failed_attempts} ניסיונות")
    settings.failed_attempts = 0
    settings.locked_until = None
    _log_attempt(db, studio_id, actor_id, True, ip)
    db.commit()


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


@router.post("/pin/verify-owner")
def verify_owner_pin(
    body: PinIn,
    request: Request,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """The business owner's PIN — a discount at the till needs it, whoever is at the till (the owner, 2026-10-12)."""
    from app.models.user import User
    owners = db.scalars(select(User).where(User.studio_id == ctx.studio_id, User.role == "owner",
                                           User.is_active == True)).all()  # noqa: E712
    settings = next((st for st in (_get_or_none(db, o.id) for o in owners) if st), None)
    if not settings:
        raise HTTPException(status_code=404, detail="בעל העסק עוד לא הגדיר קוד PIN — מגדירים אותו בהגדרות › החשבון שלי")
    _check_pin(db, settings, body.pin, ctx.studio_id, ctx.user_id, _get_ip(request))
    return {"ok": True}


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
