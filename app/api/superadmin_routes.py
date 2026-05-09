"""
Super Admin API — only accessible to users with role='superadmin'.
Provides full control over all studios in the platform.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select, func, extract
from pydantic import BaseModel
from argon2 import PasswordHasher

from app.core.database import get_db
from app.core.auth_deps import get_current_user
from app.core.security import create_access_token, create_set_password_token
from app.utils.email_utils import send_email_sync
from app.models.user import User
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio_note import StudioNote
from app.models.audit_log import AuditLog
from app.models.studio_integration import StudioIntegration
from app.models.lead import Lead

router = APIRouter(prefix="/admin", tags=["SuperAdmin"])
ph = PasswordHasher()

ADMIN_SETUP_SECRET = os.getenv("ADMIN_SETUP_SECRET", "bizcontrol-setup-secret")
PLATFORM_SLUG = os.getenv("PLATFORM_SLUG", "bizcontrol-platform")


def _audit(db: Session, admin: User, action: str, studio: Studio | None = None, details: dict | None = None) -> None:
    db.add(AuditLog(
        admin_id=str(admin.id),
        admin_email=admin.email,
        action=action,
        studio_id=str(studio.id) if studio else None,
        studio_name=studio.name if studio else None,
        details=details,
    ))
    db.flush()


# ── Dependency ────────────────────────────────────────────────────────────────

def require_superadmin(user: User = Depends(get_current_user)) -> User:
    if user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Super admin access required")
    return user


# ── Schemas ───────────────────────────────────────────────────────────────────

class StudioOut(BaseModel):
    id: str
    name: str
    slug: str
    subscription_plan: str
    is_active: bool
    plan_expires_at: Optional[datetime]
    created_at: datetime
    owner_email: Optional[str]
    client_count: int
    appointment_count_month: int

class GlobalStats(BaseModel):
    total_studios: int
    active_studios: int
    new_studios_month: int
    total_clients: int
    total_appointments_month: int
    pending_messages: int

class CreateStudioIn(BaseModel):
    studio_name: str
    slug: str
    owner_email: str
    owner_password: str
    owner_display_name: str
    subscription_plan: str = "starter"
    plan_days: int = 30

class UpdateStudioIn(BaseModel):
    is_active: Optional[bool] = None
    subscription_plan: Optional[str] = None
    plan_days: Optional[int] = None  # extend by N days from now

class AdminSettingsIn(BaseModel):
    self_booking_enabled: Optional[bool] = None
    ai_generations_count: Optional[int] = None
    calendar_start_hour: Optional[str] = None
    calendar_end_hour: Optional[str] = None
    whatsapp_provider: Optional[str] = None
    whatsapp_phone_id: Optional[str] = None
    whatsapp_api_key: Optional[str] = None

class AdminSettingsOut(BaseModel):
    subscription_plan: str
    is_active: bool
    plan_expires_at: Optional[datetime]
    self_booking_enabled: bool
    self_booking_slot_minutes: int
    ai_generations_count: int
    calendar_start_hour: str
    calendar_end_hour: str
    whatsapp_provider: Optional[str]
    whatsapp_phone_id: Optional[str]
    whatsapp_api_key: Optional[str]

class SetupIn(BaseModel):
    secret: str
    email: str
    password: str
    display_name: str = "Super Admin"


# ── Setup (one-time) ──────────────────────────────────────────────────────────

@router.post("/setup", tags=["SuperAdmin"])
def setup_superadmin(payload: SetupIn, db: Session = Depends(get_db)):
    """
    One-time setup: creates the platform studio + first superadmin user.
    Protected by ADMIN_SETUP_SECRET env var.
    """
    if payload.secret != ADMIN_SETUP_SECRET:
        raise HTTPException(status_code=403, detail="Invalid setup secret")

    # Check no superadmin exists yet
    existing = db.scalar(select(User).where(User.role == "superadmin"))
    if existing:
        raise HTTPException(status_code=409, detail="Superadmin already exists")

    # Create platform studio
    platform = Studio(
        id=uuid.uuid4(),
        name="BizControl Platform",
        slug=PLATFORM_SLUG,
        subscription_plan="platform",
        is_active=True,
        is_platform=True,
    )
    db.add(platform)
    db.flush()

    # Create default settings for platform studio
    db.add(StudioSettings(studio_id=platform.id))
    db.flush()

    # Create superadmin user
    admin_user = User(
        id=uuid.uuid4(),
        studio_id=platform.id,
        email=payload.email.lower().strip(),
        password_hash=ph.hash(payload.password),
        role="superadmin",
        display_name=payload.display_name,
        is_active=True,
    )
    db.add(admin_user)
    db.commit()

    return {"status": "created", "email": admin_user.email, "slug": PLATFORM_SLUG}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=GlobalStats)
def global_stats(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_studios = db.scalar(select(func.count(Studio.id)).where(Studio.is_platform == False)) or 0  # noqa: E712
    active_studios = db.scalar(select(func.count(Studio.id)).where(Studio.is_platform == False, Studio.is_active == True)) or 0  # noqa: E712
    new_month = db.scalar(select(func.count(Studio.id)).where(Studio.is_platform == False, Studio.created_at >= month_start)) or 0
    total_clients = db.scalar(select(func.count(Client.id))) or 0
    appts_month = db.scalar(select(func.count(Appointment.id)).where(Appointment.starts_at >= month_start)) or 0
    pending_msgs = db.scalar(select(func.count(MessageJob.id)).where(MessageJob.status == "pending")) or 0

    return GlobalStats(
        total_studios=total_studios,
        active_studios=active_studios,
        new_studios_month=new_month,
        total_clients=total_clients,
        total_appointments_month=appts_month,
        pending_messages=pending_msgs,
    )


# ── Studios List ──────────────────────────────────────────────────────────────

@router.get("/studios", response_model=list[StudioOut])
def list_studios(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    studios = db.scalars(
        select(Studio).where(Studio.is_platform == False).order_by(Studio.created_at.desc())  # noqa: E712
    ).all()

    result = []
    for s in studios:
        owner = db.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
        client_count = db.scalar(select(func.count(Client.id)).where(Client.studio_id == s.id)) or 0
        appt_count = db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.studio_id == s.id,
                Appointment.starts_at >= month_start
            )
        ) or 0
        result.append(StudioOut(
            id=str(s.id),
            name=s.name,
            slug=s.slug,
            subscription_plan=s.subscription_plan,
            is_active=s.is_active,
            plan_expires_at=s.plan_expires_at,
            created_at=s.created_at,
            owner_email=owner.email if owner else None,
            client_count=client_count,
            appointment_count_month=appt_count,
        ))
    return result


# ── Create Studio ─────────────────────────────────────────────────────────────

@router.post("/studios", response_model=StudioOut)
def create_studio(payload: CreateStudioIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    if db.scalar(select(Studio).where(Studio.slug == payload.slug)):
        raise HTTPException(status_code=409, detail="Slug already taken")

    expires = datetime.now(timezone.utc) + timedelta(days=payload.plan_days)

    studio = Studio(
        id=uuid.uuid4(),
        name=payload.studio_name,
        slug=payload.slug,
        subscription_plan=payload.subscription_plan,
        is_active=True,
        plan_expires_at=expires,
        is_platform=False,
    )
    db.add(studio)
    db.flush()

    db.add(StudioSettings(studio_id=studio.id))

    owner = User(
        id=uuid.uuid4(),
        studio_id=studio.id,
        email=payload.owner_email.lower().strip(),
        password_hash=ph.hash(payload.owner_password),
        role="owner",
        display_name=payload.owner_display_name,
        is_active=True,
    )
    db.add(owner)
    _audit(db, admin, "create_studio", studio, {"owner_email": owner.email, "plan": studio.subscription_plan})
    db.commit()

    # Send welcome email with credentials and set-password link
    try:
        frontend_url = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app")
        token = create_set_password_token(str(owner.id))
        set_pw_link = f"{frontend_url}/set-password?token={token}"
        smtp_host = os.getenv("PLATFORM_SMTP_HOST", "")
        smtp_port = int(os.getenv("PLATFORM_SMTP_PORT", "587"))
        smtp_user = os.getenv("PLATFORM_SMTP_USER", "")
        smtp_pass = os.getenv("PLATFORM_SMTP_PASS", "")
        smtp_from = os.getenv("PLATFORM_SMTP_FROM", smtp_user)
        send_email_sync(
            host=smtp_host, port=smtp_port, user=smtp_user,
            password=smtp_pass, from_email=smtp_from,
            to_email=owner.email,
            subject="ברוך הבא ל-BizControl! פרטי הגישה שלך",
            html_content=f"""
            <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
              <h2 style="color:#1a1a2e;">ברוך הבא ל-BizControl! 🎉</h2>
              <p>שלום {payload.owner_display_name},</p>
              <p>הסטודיו <strong>{payload.studio_name}</strong> נוצר בהצלחה.</p>
              <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:20px 0;">
                <h3 style="margin-top:0;">פרטי הגישה שלך:</h3>
                <p><strong>כתובת האתר:</strong> <a href="{frontend_url}">{frontend_url}</a></p>
                <p><strong>מזהה סטודיו (Slug):</strong> {payload.slug}</p>
                <p><strong>אימייל:</strong> {payload.owner_email}</p>
                <p><strong>סיסמה זמנית:</strong> {payload.owner_password}</p>
              </div>
              <p>מומלץ להגדיר סיסמה אישית בלחיצה כאן:</p>
              <a href="{set_pw_link}" style="display:inline-block;background:#1a1a2e;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">הגדר סיסמה חדשה</a>
              <p style="font-size:12px;color:#888;margin-top:20px;">הקישור תקף ל-72 שעות.</p>
              <hr style="border:none;border-top:1px solid #eaeaea;margin:20px 0;"/>
              <p style="font-size:12px;color:#888;">הודעה זו נשלחה אוטומטית ממערכת BizControl.</p>
            </div>"""
        )
    except Exception as e:
        print(f"[welcome_email] failed: {e}")

    return StudioOut(
        id=str(studio.id),
        name=studio.name,
        slug=studio.slug,
        subscription_plan=studio.subscription_plan,
        is_active=studio.is_active,
        plan_expires_at=studio.plan_expires_at,
        created_at=studio.created_at,
        owner_email=owner.email,
        client_count=0,
        appointment_count_month=0,
    )


# ── Update Studio ─────────────────────────────────────────────────────────────

@router.patch("/studios/{studio_id}")
def update_studio(studio_id: uuid.UUID, payload: UpdateStudioIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")

    changes: dict = {}
    if payload.is_active is not None:
        changes["is_active"] = payload.is_active
        studio.is_active = payload.is_active
    if payload.subscription_plan is not None:
        changes["subscription_plan"] = payload.subscription_plan
        studio.subscription_plan = payload.subscription_plan
    if payload.plan_days is not None:
        base = max(datetime.now(timezone.utc), studio.plan_expires_at or datetime.now(timezone.utc))
        studio.plan_expires_at = base + timedelta(days=payload.plan_days)
        changes["plan_days_added"] = payload.plan_days

    _audit(db, admin, "update_studio", studio, changes)
    db.commit()
    return {"status": "updated"}


# ── Delete Studio ─────────────────────────────────────────────────────────────

@router.delete("/studios/{studio_id}")
def delete_studio(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    _audit(db, admin, "delete_studio", studio, {"slug": studio.slug})
    db.delete(studio)
    db.commit()
    return {"status": "deleted"}


# ── Studio Detail ─────────────────────────────────────────────────────────────

class StudioNoteOut(BaseModel):
    id: str
    body: str
    created_by_email: str
    created_at: datetime

class NoteIn(BaseModel):
    body: str

class StudioDetailOut(BaseModel):
    id: str
    name: str
    slug: str
    subscription_plan: str
    is_active: bool
    plan_expires_at: Optional[datetime]
    created_at: datetime
    owner_email: Optional[str]
    owner_display_name: Optional[str]
    user_count: int
    client_count: int
    appointment_count_total: int
    appointment_count_month: int
    users: list[dict]


@router.get("/studios/{studio_id}/detail", response_model=StudioDetailOut)
def studio_detail(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    users = db.scalars(select(User).where(User.studio_id == studio_id)).all()
    owner = next((u for u in users if u.role == "owner"), None)

    client_count = db.scalar(select(func.count(Client.id)).where(Client.studio_id == studio_id)) or 0
    appt_total = db.scalar(select(func.count(Appointment.id)).where(Appointment.studio_id == studio_id)) or 0
    appt_month = db.scalar(
        select(func.count(Appointment.id)).where(Appointment.studio_id == studio_id, Appointment.starts_at >= month_start)
    ) or 0

    return StudioDetailOut(
        id=str(studio.id),
        name=studio.name,
        slug=studio.slug,
        subscription_plan=studio.subscription_plan,
        is_active=studio.is_active,
        plan_expires_at=studio.plan_expires_at,
        created_at=studio.created_at,
        owner_email=owner.email if owner else None,
        owner_display_name=owner.display_name if owner else None,
        user_count=len(users),
        client_count=client_count,
        appointment_count_total=appt_total,
        appointment_count_month=appt_month,
        users=[
            {"id": str(u.id), "email": u.email, "display_name": u.display_name, "role": u.role, "is_active": u.is_active}
            for u in users
        ],
    )


@router.get("/studios/{studio_id}/settings", response_model=AdminSettingsOut)
def get_studio_settings(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    settings = db.get(StudioSettings, studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")
    return AdminSettingsOut(
        subscription_plan=studio.subscription_plan,
        is_active=studio.is_active,
        plan_expires_at=studio.plan_expires_at,
        self_booking_enabled=settings.self_booking_enabled,
        self_booking_slot_minutes=settings.self_booking_slot_minutes or 60,
        ai_generations_count=settings.ai_generations_count or 0,
        calendar_start_hour=settings.calendar_start_hour or "08:00",
        calendar_end_hour=settings.calendar_end_hour or "23:00",
        whatsapp_provider=settings.whatsapp_provider,
        whatsapp_phone_id=settings.whatsapp_phone_id,
        whatsapp_api_key=settings.whatsapp_api_key,
    )


@router.patch("/studios/{studio_id}/settings")
def update_studio_settings(studio_id: uuid.UUID, payload: AdminSettingsIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    settings = db.get(StudioSettings, studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    changes: dict = {}
    if payload.self_booking_enabled is not None:
        changes["self_booking_enabled"] = payload.self_booking_enabled
        settings.self_booking_enabled = payload.self_booking_enabled
    if payload.ai_generations_count is not None:
        changes["ai_generations_count"] = payload.ai_generations_count
        settings.ai_generations_count = payload.ai_generations_count
    if payload.calendar_start_hour is not None:
        changes["calendar_start_hour"] = payload.calendar_start_hour
        settings.calendar_start_hour = payload.calendar_start_hour
    if payload.calendar_end_hour is not None:
        changes["calendar_end_hour"] = payload.calendar_end_hour
        settings.calendar_end_hour = payload.calendar_end_hour
    if payload.whatsapp_provider is not None:
        changes["whatsapp_provider"] = payload.whatsapp_provider
        settings.whatsapp_provider = payload.whatsapp_provider or None
    if payload.whatsapp_phone_id is not None:
        changes["whatsapp_phone_id"] = payload.whatsapp_phone_id
        settings.whatsapp_phone_id = payload.whatsapp_phone_id or None
    if payload.whatsapp_api_key is not None:
        changes["whatsapp_api_key"] = "***"  # redact from audit log
        settings.whatsapp_api_key = payload.whatsapp_api_key or None

    _audit(db, admin, "update_settings", studio, changes)
    db.commit()
    return {"status": "updated"}


@router.get("/studios/{studio_id}/notes", response_model=list[StudioNoteOut])
def list_notes(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    notes = db.scalars(
        select(StudioNote).where(StudioNote.studio_id == studio_id).order_by(StudioNote.created_at.desc())
    ).all()
    return [StudioNoteOut(id=str(n.id), body=n.body, created_by_email=n.created_by_email, created_at=n.created_at) for n in notes]


@router.post("/studios/{studio_id}/notes", response_model=StudioNoteOut, status_code=201)
def add_note(studio_id: uuid.UUID, payload: NoteIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    note = StudioNote(studio_id=studio_id, body=payload.body.strip(), created_by_email=admin.email)
    db.add(note)
    db.commit()
    db.refresh(note)
    return StudioNoteOut(id=str(note.id), body=note.body, created_by_email=note.created_by_email, created_at=note.created_at)


@router.delete("/studios/{studio_id}/notes/{note_id}", status_code=204)
def delete_note(studio_id: uuid.UUID, note_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    note = db.scalar(select(StudioNote).where(StudioNote.id == note_id, StudioNote.studio_id == studio_id))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()


# ── Charts ───────────────────────────────────────────────────────────────────

@router.get("/charts")
def admin_charts(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)

    # Last 12 months labels
    months = []
    for i in range(11, -1, -1):
        d = now - timedelta(days=30 * i)
        months.append((d.year, d.month))

    # New studios per month
    studios_by_month = []
    for y, m in months:
        count = db.scalar(
            select(func.count(Studio.id)).where(
                Studio.is_platform == False,  # noqa: E712
                extract("year", Studio.created_at) == y,
                extract("month", Studio.created_at) == m,
            )
        ) or 0
        studios_by_month.append({"month": f"{y}-{m:02d}", "count": count})

    # Appointments per month
    appts_by_month = []
    for y, m in months:
        count = db.scalar(
            select(func.count(Appointment.id)).where(
                extract("year", Appointment.starts_at) == y,
                extract("month", Appointment.starts_at) == m,
            )
        ) or 0
        appts_by_month.append({"month": f"{y}-{m:02d}", "count": count})

    # Plan distribution (current)
    plan_dist: dict[str, int] = {}
    rows = db.execute(
        select(Studio.subscription_plan, func.count(Studio.id))
        .where(Studio.is_platform == False)  # noqa: E712
        .group_by(Studio.subscription_plan)
    ).all()
    for plan, cnt in rows:
        plan_dist[plan] = cnt

    # Active / trial / expired breakdown
    active = expired = trial = 0
    for s in db.scalars(select(Studio).where(Studio.is_platform == False)).all():  # noqa: E712
        if not s.is_active:
            expired += 1
        elif s.plan_expires_at and s.plan_expires_at < now:
            expired += 1
        elif s.plan_expires_at:
            days_left = (s.plan_expires_at - now).days
            if days_left <= 14:
                trial += 1
            else:
                active += 1
        else:
            active += 1

    return {
        "studios_by_month": studios_by_month,
        "appts_by_month": appts_by_month,
        "plan_distribution": plan_dist,
        "status_breakdown": {"active": active, "trial": trial, "expired": expired},
    }


# ── Impersonate ───────────────────────────────────────────────────────────────

@router.post("/impersonate/{studio_id}")
def impersonate(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")

    owner = db.scalar(select(User).where(User.studio_id == studio_id, User.role == "owner", User.is_active == True))  # noqa: E712
    if not owner:
        raise HTTPException(status_code=404, detail="Studio owner not found")

    token = create_access_token({
        "user_id": str(owner.id),
        "studio_id": str(studio_id),
        "role": owner.role,
        "impersonated_by": str(admin.id),
    })
    _audit(db, admin, "impersonate", studio, {"owner_email": owner.email})
    db.commit()
    return {
        "access_token": token,
        "studio_name": studio.name,
        "studio_slug": studio.slug,
        "owner_email": owner.email,
    }


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: str
    admin_email: str
    action: str
    studio_id: Optional[str]
    studio_name: Optional[str]
    details: Optional[dict]
    created_at: datetime


ACTION_LABELS = {
    "create_studio": "יצירת סטודיו",
    "update_studio": "עדכון סטודיו",
    "delete_studio": "מחיקת סטודיו",
    "update_settings": "עדכון הגדרות",
    "impersonate": "התחברות כסטודיו",
}


@router.post("/test-plan-alert/{studio_id}")
def test_plan_alert(
    studio_id: str,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Manually trigger a 7-day expiry warning email for a studio (for testing)."""
    from app.services.plan_alert_service import _send_alert
    studio = db.get(Studio, studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    owner = db.scalar(
        select(User).where(User.studio_id == studio.id, User.role == "owner", User.is_active == True)  # noqa: E712
    )
    if not owner or not owner.email:
        raise HTTPException(status_code=404, detail="Studio has no active owner with email")
    _send_alert(studio, owner.email, days=7)
    return {"ok": True, "sent_to": owner.email}


@router.get("/audit-log", response_model=list[AuditLogOut])
def get_audit_log(
    studio_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    q = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    if studio_id:
        q = q.where(AuditLog.studio_id == studio_id)
    rows = db.scalars(q).all()
    return [
        AuditLogOut(
            id=str(r.id),
            admin_email=r.admin_email,
            action=ACTION_LABELS.get(r.action, r.action),
            studio_id=r.studio_id,
            studio_name=r.studio_name,
            details=r.details,
            created_at=r.created_at,
        )
        for r in rows
    ]


# ── Studio Integrations ───────────────────────────────────────────────────────

PLATFORMS = ["whatsapp", "instagram", "facebook", "lead_ads"]


class IntegrationOut(BaseModel):
    platform: str
    is_active: bool
    expires_at: Optional[datetime]
    is_permanent: bool
    phone_number_id: Optional[str]
    access_token: Optional[str]
    page_id: Optional[str]
    instagram_account_id: Optional[str]


class IntegrationIn(BaseModel):
    is_active: Optional[bool] = None
    trial_days: Optional[int] = None      # grant N-day trial from now
    permanent: Optional[bool] = None      # True = remove expiry
    phone_number_id: Optional[str] = None
    access_token: Optional[str] = None
    page_id: Optional[str] = None
    instagram_account_id: Optional[str] = None


def _get_or_create_integration(db: Session, studio_id: uuid.UUID, platform: str) -> StudioIntegration:
    row = db.scalar(
        select(StudioIntegration).where(
            StudioIntegration.studio_id == studio_id,
            StudioIntegration.platform == platform,
        )
    )
    if not row:
        row = StudioIntegration(id=uuid.uuid4(), studio_id=studio_id, platform=platform)
        db.add(row)
        db.flush()
    return row


def _integration_out(row: StudioIntegration) -> IntegrationOut:
    return IntegrationOut(
        platform=row.platform,
        is_active=row.is_active,
        expires_at=row.expires_at,
        is_permanent=row.is_active and row.expires_at is None,
        phone_number_id=row.phone_number_id,
        access_token=row.access_token,
        page_id=row.page_id,
        instagram_account_id=row.instagram_account_id,
    )


@router.get("/studios/{studio_id}/integrations", response_model=list[IntegrationOut])
def list_integrations(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    rows = db.scalars(select(StudioIntegration).where(StudioIntegration.studio_id == studio_id)).all()
    by_platform = {r.platform: r for r in rows}
    result = []
    for p in PLATFORMS:
        if p in by_platform:
            result.append(_integration_out(by_platform[p]))
        else:
            result.append(IntegrationOut(
                platform=p, is_active=False, expires_at=None, is_permanent=False,
                phone_number_id=None, access_token=None, page_id=None, instagram_account_id=None,
            ))
    return result


@router.patch("/studios/{studio_id}/integrations/{platform}", response_model=IntegrationOut)
def update_integration(
    studio_id: uuid.UUID,
    platform: str,
    payload: IntegrationIn,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    if platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail=f"Unknown platform: {platform}")
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")

    row = _get_or_create_integration(db, studio_id, platform)
    changes: dict = {}

    if payload.is_active is not None:
        row.is_active = payload.is_active
        changes["is_active"] = payload.is_active

    if payload.trial_days is not None:
        row.is_active = True
        row.expires_at = datetime.now(timezone.utc) + timedelta(days=payload.trial_days)
        changes["trial_days"] = payload.trial_days

    if payload.permanent is True:
        row.is_active = True
        row.expires_at = None
        changes["permanent"] = True

    if payload.phone_number_id is not None:
        row.phone_number_id = payload.phone_number_id or None
        changes["phone_number_id"] = "set"
    if payload.access_token is not None:
        row.access_token = payload.access_token or None
        changes["access_token"] = "***"
    if payload.page_id is not None:
        row.page_id = payload.page_id or None
        changes["page_id"] = "set"
    if payload.instagram_account_id is not None:
        row.instagram_account_id = payload.instagram_account_id or None
        changes["instagram_account_id"] = "set"

    _audit(db, admin, "update_integration", studio, {"platform": platform, **changes})
    db.commit()
    db.refresh(row)
    return _integration_out(row)


# ── Campaign Analytics ────────────────────────────────────────────────────────

class CampaignStat(BaseModel):
    campaign_name: str
    source: str
    total: int
    booked: int
    lost: int
    conversion_rate: float


class LeadAnalyticsOut(BaseModel):
    total_leads: int
    by_source: dict
    by_status: dict
    campaigns: list[CampaignStat]


@router.get("/studios/{studio_id}/lead-analytics", response_model=LeadAnalyticsOut)
def lead_analytics(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")

    all_leads = db.scalars(select(Lead).where(Lead.studio_id == studio_id)).all()

    by_source: dict[str, int] = {}
    by_status: dict[str, int] = {}
    campaigns: dict[str, dict] = {}

    for lead in all_leads:
        by_source[lead.source] = by_source.get(lead.source, 0) + 1
        by_status[lead.status] = by_status.get(lead.status, 0) + 1

        if lead.campaign_name:
            key = lead.campaign_name
            if key not in campaigns:
                campaigns[key] = {"source": lead.source, "total": 0, "booked": 0, "lost": 0}
            campaigns[key]["total"] += 1
            if lead.status == "booked":
                campaigns[key]["booked"] += 1
            elif lead.status == "lost":
                campaigns[key]["lost"] += 1

    campaign_list = [
        CampaignStat(
            campaign_name=name,
            source=v["source"],
            total=v["total"],
            booked=v["booked"],
            lost=v["lost"],
            conversion_rate=round(v["booked"] / v["total"] * 100, 1) if v["total"] else 0,
        )
        for name, v in sorted(campaigns.items(), key=lambda x: -x[1]["total"])
    ]

    return LeadAnalyticsOut(
        total_leads=len(all_leads),
        by_source=by_source,
        by_status=by_status,
        campaigns=campaign_list,
    )
