"""
Super Admin API — only accessible to users with role='superadmin'.
Provides full control over all studios in the platform.
"""
from __future__ import annotations
import os
import threading
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from app.utils.logger import get_logger

log = get_logger(__name__)

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import select, func, extract, text
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


from app.utils.email_templates import welcome_email_html as _welcome_email_html
from app.utils.email_templates import reset_password_email_html as _reset_password_email_html
from app.utils.email_templates import invite_user_email_html as _invite_user_email_html


def _send_email_bg(**kwargs) -> None:
    """Fire-and-forget: run send_email_sync in a daemon thread so it never blocks the HTTP response."""
    def _run():
        try:
            send_email_sync(**kwargs)
        except Exception as e:
            log.error("[email_bg] failed: %s", e)
    threading.Thread(target=_run, daemon=True).start()


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
    owner_display_name: Optional[str] = None
    owner_phone: Optional[str] = None
    client_count: int
    appointment_count_month: int
    has_whatsapp: bool = False   # whatsapp_provider configured in studio_settings
    has_branding: bool = False   # logo or landing page title set
    has_activity: bool = False   # at least 1 client

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
    owner_phone: str = ""
    subscription_plan: str = "starter"
    plan_days: int = 30

class UpdateStudioIn(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    is_active: Optional[bool] = None
    subscription_plan: Optional[str] = None
    plan_days: Optional[int] = None  # extend by N days from now

class UpdateOwnerIn(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

class AddUserIn(BaseModel):
    email: str
    display_name: str
    role: str = "staff"
    phone: str = ""
    password: str = ""

class UpdateUserIn(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None

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
        settings = db.get(StudioSettings, s.id)
        has_whatsapp = bool(settings and settings.whatsapp_provider and (settings.whatsapp_phone_id or settings.whatsapp_instance_id))
        has_branding = bool(settings and (settings.logo_filename or settings.landing_page_title))
        has_activity = client_count > 0
        result.append(StudioOut(
            id=str(s.id),
            name=s.name,
            slug=s.slug,
            subscription_plan=s.subscription_plan,
            is_active=s.is_active,
            plan_expires_at=s.plan_expires_at,
            created_at=s.created_at,
            owner_email=owner.email if owner else None,
            owner_display_name=owner.display_name if owner else None,
            owner_phone=owner.phone if owner else None,
            client_count=client_count,
            appointment_count_month=appt_count,
            has_whatsapp=has_whatsapp,
            has_branding=has_branding,
            has_activity=has_activity,
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
        phone=payload.owner_phone.strip() or None,
        is_active=True,
    )
    db.add(owner)
    _audit(db, admin, "create_studio", studio, {"owner_email": owner.email, "plan": studio.subscription_plan})
    db.commit()

    # Send welcome email in background so it doesn't block the response
    frontend_url = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app")
    token = create_set_password_token(str(owner.id))
    set_pw_link = f"{frontend_url}/set-password?token={token}"
    _send_email_bg(
        host=os.getenv("PLATFORM_SMTP_HOST", ""),
        port=int(os.getenv("PLATFORM_SMTP_PORT", "587")),
        user=os.getenv("PLATFORM_SMTP_USER", ""),
        password=os.getenv("PLATFORM_SMTP_PASS", ""),
        from_email=os.getenv("PLATFORM_SMTP_FROM", os.getenv("PLATFORM_SMTP_USER", "")),
        to_email=owner.email,
        subject="ברוך הבא ל-BizControl — פרטי הגישה שלך 🎉",
        html_content=_welcome_email_html(
            name=payload.owner_display_name,
            studio_name=payload.studio_name,
            slug=payload.slug,
            email=payload.owner_email,
            tmp_password=payload.owner_password,
            set_pw_link=set_pw_link,
            frontend_url=frontend_url,
        ),
    )

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
    if payload.name is not None and payload.name.strip():
        changes["name"] = payload.name.strip()
        studio.name = payload.name.strip()
    if payload.slug is not None and payload.slug.strip():
        new_slug = payload.slug.strip().lower()
        existing = db.scalar(select(Studio).where(Studio.slug == new_slug, Studio.id != studio_id))
        if existing:
            raise HTTPException(status_code=409, detail="Slug כבר תפוס")
        changes["slug"] = new_slug
        studio.slug = new_slug
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


@router.patch("/studios/{studio_id}/owner")
def update_owner(studio_id: uuid.UUID, payload: UpdateOwnerIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    owner = db.scalar(select(User).where(User.studio_id == studio_id, User.role == "owner"))
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")

    changes: dict = {}
    if payload.display_name is not None:
        changes["display_name"] = payload.display_name
        owner.display_name = payload.display_name
    if payload.email is not None and payload.email.strip():
        changes["email"] = payload.email.strip()
        owner.email = payload.email.strip().lower()
    if payload.phone is not None:
        changes["phone"] = payload.phone
        owner.phone = payload.phone.strip() or None

    _audit(db, admin, "update_owner", studio, changes)
    db.commit()
    return {"status": "updated"}


@router.get("/studios/{studio_id}/users")
def list_studio_users(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    users = db.scalars(select(User).where(User.studio_id == studio_id).order_by(User.role)).all()
    return [{"id": str(u.id), "email": u.email, "display_name": u.display_name, "role": u.role, "phone": u.phone, "is_active": u.is_active} for u in users]


@router.post("/studios/{studio_id}/users", status_code=201)
def add_studio_user(studio_id: uuid.UUID, payload: AddUserIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    if db.scalar(select(User).where(User.studio_id == studio_id, User.email == payload.email.lower().strip())):
        raise HTTPException(status_code=409, detail="אימייל כבר קיים בסטודיו")

    import secrets
    tmp_password = payload.password or secrets.token_urlsafe(10)
    user = User(
        id=uuid.uuid4(),
        studio_id=studio_id,
        email=payload.email.lower().strip(),
        password_hash=ph.hash(tmp_password),
        role=payload.role,
        display_name=payload.display_name,
        phone=payload.phone.strip() or None,
        is_active=True,
    )
    db.add(user)
    _audit(db, admin, "add_user", studio, {"email": user.email, "role": user.role})
    db.commit()

    # Send invite email in background
    frontend_url = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app")
    token = create_set_password_token(str(user.id))
    set_pw_link = f"{frontend_url}/set-password?token={token}"
    role_he = {"admin": "מנהל", "artist": "אמן/אמנית", "staff": "צוות"}.get(payload.role, payload.role)
    _send_email_bg(
        host=os.getenv("PLATFORM_SMTP_HOST", ""),
        port=int(os.getenv("PLATFORM_SMTP_PORT", "587")),
        user=os.getenv("PLATFORM_SMTP_USER", ""),
        password=os.getenv("PLATFORM_SMTP_PASS", ""),
        from_email=os.getenv("PLATFORM_SMTP_FROM", os.getenv("PLATFORM_SMTP_USER", "")),
        to_email=user.email,
        subject=f"הוזמנת ל-{studio.name} ב-BizControl",
        html_content=_invite_user_email_html(payload.display_name, studio.name, role_he, set_pw_link),
    )

    return {"id": str(user.id), "email": user.email, "display_name": user.display_name, "role": user.role, "phone": user.phone, "is_active": user.is_active}


@router.patch("/users/{user_id}")
def update_studio_user(user_id: uuid.UUID, payload: UpdateUserIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user or user.role == "superadmin":
        raise HTTPException(status_code=404, detail="User not found")
    studio = db.get(Studio, user.studio_id)

    changes: dict = {}
    if payload.display_name is not None:
        changes["display_name"] = payload.display_name
        user.display_name = payload.display_name
    if payload.email is not None and payload.email.strip():
        changes["email"] = payload.email.strip()
        user.email = payload.email.strip().lower()
    if payload.role is not None:
        changes["role"] = payload.role
        user.role = payload.role
    if payload.phone is not None:
        changes["phone"] = payload.phone
        user.phone = payload.phone.strip() or None
    if payload.is_active is not None:
        changes["is_active"] = payload.is_active
        user.is_active = payload.is_active

    _audit(db, admin, "update_user", studio, {"user_email": user.email, **changes})
    db.commit()
    return {"status": "updated"}


@router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user or user.role == "superadmin":
        raise HTTPException(status_code=404, detail="User not found")

    frontend_url = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app")
    token = create_set_password_token(str(user.id))
    set_pw_link = f"{frontend_url}/set-password?token={token}"

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
            html_content=_reset_password_email_html(user.display_name or user.email, set_pw_link),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"שליחת מייל נכשלה: {e}")

    studio = db.get(Studio, user.studio_id)
    _audit(db, admin, "reset_password", studio, {"user_email": user.email})
    db.commit()
    return {"status": "sent", "link": set_pw_link}


# ── Delete Studio ─────────────────────────────────────────────────────────────

@router.delete("/studios/{studio_id}")
def delete_studio(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    _audit(db, admin, "delete_studio", studio, {"slug": studio.slug})
    sid = str(studio_id)
    # Delete in FK-safe order: appointments first (artist_id RESTRICT), then rest
    for tbl in ("message_jobs", "payments", "appointments", "booking_requests",
                "product_sales", "work_sessions", "client_points_ledger",
                "expenses", "monthly_goals", "leads", "clients",
                "products", "users", "studio_notes", "studio_integrations"):
        db.execute(text(f"DELETE FROM {tbl} WHERE studio_id = :sid"), {"sid": sid})
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
        owner = db.scalar(select(User).where(User.studio_id == studio_id, User.role.in_(["admin", "superadmin"]), User.is_active == True))  # noqa: E712
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


# ── Platform WhatsApp Settings ────────────────────────────────────────────────

PLATFORM_STUDIO_ID = os.getenv("PLATFORM_STUDIO_ID", "")


class PlatformSettingsOut(BaseModel):
    whatsapp_provider: str | None
    whatsapp_phone_id: str | None
    whatsapp_api_key: str | None


class PlatformSettingsIn(BaseModel):
    whatsapp_provider: str | None = None
    whatsapp_phone_id: str | None = None
    whatsapp_api_key: str | None = None


@router.get("/webhook-config")
def get_webhook_config(admin: User = Depends(require_superadmin)):
    verify_token = os.getenv("META_WEBHOOK_VERIFY_TOKEN", "bizcontrol_verify")
    backend_url = os.getenv("BACKEND_URL", "")
    webhook_url = f"{backend_url}/api/webhook/meta" if backend_url else ""
    return {
        "webhook_url": webhook_url,
        "verify_token": verify_token,
    }


@router.get("/platform-settings", response_model=PlatformSettingsOut)
def get_platform_settings(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    settings = db.get(StudioSettings, PLATFORM_STUDIO_ID) if PLATFORM_STUDIO_ID else None
    if not settings:
        raise HTTPException(status_code=404, detail="Platform settings not found")
    return PlatformSettingsOut(
        whatsapp_provider=settings.whatsapp_provider,
        whatsapp_phone_id=settings.whatsapp_phone_id,
        whatsapp_api_key=settings.whatsapp_api_key,
    )


class TestWhatsappIn(BaseModel):
    phone: str


@router.post("/test-whatsapp")
def test_whatsapp(payload: TestWhatsappIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    import urllib.request as _urllib_req, json as _json, urllib.error as _urllib_err
    settings = db.get(StudioSettings, PLATFORM_STUDIO_ID) if PLATFORM_STUDIO_ID else None
    if not settings or not settings.whatsapp_provider:
        raise HTTPException(status_code=400, detail="WhatsApp לא מוגדר בפלטפורמה")

    if settings.whatsapp_provider == "meta":
        phone_id = settings.whatsapp_phone_id
        token = settings.whatsapp_api_key
        if not phone_id or not token:
            raise HTTPException(status_code=400, detail="Phone Number ID או Token חסרים")
        url = f"https://graph.facebook.com/v19.0/{phone_id}/messages"
        body_bytes = _json.dumps({
            "messaging_product": "whatsapp",
            "to": payload.phone,
            "type": "text",
            "text": {"body": "✅ הודעת טסט מ-BizControl — WhatsApp מחובר ועובד!"},
        }).encode()
        req = _urllib_req.Request(url, data=body_bytes, method="POST")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        try:
            with _urllib_req.urlopen(req, timeout=10) as resp:
                result = _json.loads(resp.read())
                if "error" in result:
                    err_msg = result["error"].get("message", str(result["error"]))
                    raise HTTPException(status_code=502, detail=f"Meta: {err_msg}")
        except _urllib_err.HTTPError as e:
            raw = e.read().decode()
            try:
                err_msg = _json.loads(raw).get("error", {}).get("message", raw)
            except Exception:
                err_msg = raw
            raise HTTPException(status_code=502, detail=f"Meta API שגיאה {e.code}: {err_msg}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"שליחה נכשלה: {e}")
    else:
        try:
            from app.services.message_worker import send_whatsapp_message
            send_whatsapp_message(payload.phone, "✅ הודעת טסט מ-BizControl — WhatsApp מחובר ועובד!", settings=settings)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"שליחה נכשלה: {e}")

    return {"status": "sent"}


@router.patch("/platform-settings", response_model=PlatformSettingsOut)
def update_platform_settings(
    payload: PlatformSettingsIn,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    settings = db.get(StudioSettings, PLATFORM_STUDIO_ID) if PLATFORM_STUDIO_ID else None
    if not settings:
        raise HTTPException(status_code=404, detail="Platform settings not found")
    if payload.whatsapp_provider is not None:
        settings.whatsapp_provider = payload.whatsapp_provider or None
    if payload.whatsapp_phone_id is not None:
        settings.whatsapp_phone_id = payload.whatsapp_phone_id or None
    if payload.whatsapp_api_key is not None:
        settings.whatsapp_api_key = payload.whatsapp_api_key or None
    db.commit()
    db.refresh(settings)
    return PlatformSettingsOut(
        whatsapp_provider=settings.whatsapp_provider,
        whatsapp_phone_id=settings.whatsapp_phone_id,
        whatsapp_api_key=settings.whatsapp_api_key,
    )


# ── BizFind System Settings (platform_config) ─────────────────────────────────

def _cfg_get(db: Session, key: str) -> str | None:
    row = db.execute(text("SELECT value FROM platform_config WHERE key = :k"), {"k": key}).fetchone()
    return row[0] if row else None

def _cfg_set(db: Session, key: str, value: str | None):
    if value:
        db.execute(text("""
            INSERT INTO platform_config (key, value, updated_at)
            VALUES (:k, :v, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        """), {"k": key, "v": value})
    else:
        db.execute(text("DELETE FROM platform_config WHERE key = :k"), {"k": key})


class BizFindStudioOption(BaseModel):
    studio_id: str
    name: str
    phone_number: str | None  # from whatsapp_connections
    instance_id: str


class BizFindSettingsOut(BaseModel):
    otp_studio_id: str | None
    otp_studio_name: str | None
    otp_phone_number: str | None


class BizFindSettingsIn(BaseModel):
    otp_studio_id: str | None = None


class TestOTPIn(BaseModel):
    phone: str


@router.get("/bizfind-settings/studios", response_model=list[BizFindStudioOption])
def get_bizfind_connectable_studios(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Return all studios with an active Green API WhatsApp connection."""
    rows = db.execute(text("""
        SELECT s.id, s.name,
               COALESCE(ss.whatsapp_instance_id, wc.instance_id) AS instance_id,
               wc.phone_number
        FROM studios s
        LEFT JOIN studio_settings ss ON ss.studio_id = s.id
        LEFT JOIN whatsapp_connections wc ON wc.studio_id = s.id
        WHERE s.is_platform IS NOT TRUE
          AND (
              ss.whatsapp_instance_id IS NOT NULL
              OR wc.instance_id IS NOT NULL
          )
        ORDER BY s.name
    """)).fetchall()
    return [
        BizFindStudioOption(
            studio_id=str(r[0]),
            name=r[1],
            phone_number=r[3],
            instance_id=r[2],
        )
        for r in rows
    ]


@router.get("/bizfind-settings", response_model=BizFindSettingsOut)
def get_bizfind_settings(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio_id = _cfg_get(db, "bizfind_otp_studio_id")
    if not studio_id:
        return BizFindSettingsOut(otp_studio_id=None, otp_studio_name=None, otp_phone_number=None)
    row = db.execute(text("""
        SELECT s.name, wc.phone_number
        FROM studios s
        LEFT JOIN whatsapp_connections wc ON wc.studio_id = s.id AND wc.status = 'authorized'
        WHERE s.id = :sid
    """), {"sid": studio_id}).fetchone()
    return BizFindSettingsOut(
        otp_studio_id=studio_id,
        otp_studio_name=row[0] if row else None,
        otp_phone_number=row[1] if row else None,
    )


@router.post("/bizfind-settings", response_model=BizFindSettingsOut)
def save_bizfind_settings(payload: BizFindSettingsIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    _cfg_set(db, "bizfind_otp_studio_id", payload.otp_studio_id)
    db.commit()
    return get_bizfind_settings(admin=admin, db=db)


@router.post("/bizfind-settings/test-otp")
def test_bizfind_otp(payload: TestOTPIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio_id = _cfg_get(db, "bizfind_otp_studio_id")
    if not studio_id:
        raise HTTPException(status_code=400, detail="לא נבחר סטודיו לשליחת OTP")
    row = db.execute(text("""
        SELECT ss.whatsapp_instance_id, ss.whatsapp_api_key
        FROM studio_settings ss WHERE ss.studio_id = :sid
    """), {"sid": studio_id}).fetchone()
    if not row or not row[0] or not row[1]:
        raise HTTPException(status_code=400, detail="אין Instance ID או Token לסטודיו הנבחר")
    instance, token = row[0], row[1]
    phone = payload.phone.strip().replace("-", "").replace(" ", "")
    if phone.startswith("0"):
        phone = "972" + phone[1:]
    try:
        import requests as _req
        url = f"https://api.green-api.com/waInstance{instance}/sendMessage/{token}"
        r = _req.post(url, json={"chatId": phone + "@c.us", "message": "✅ BizFind — הגדרות OTP עובדות!"}, timeout=10)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Green API שגיאה: {r.text[:200]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "sent"}


class SystemWAOut(BaseModel):
    studio_id: str | None
    studio_name: str | None
    phone_number: str | None


class SystemWAIn(BaseModel):
    studio_id: str | None = None


@router.get("/system-whatsapp", response_model=SystemWAOut)
def get_system_whatsapp(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    sid = _cfg_get(db, "system_wa_studio_id")
    if not sid:
        return SystemWAOut(studio_id=None, studio_name=None, phone_number=None)
    row = db.execute(text("""
        SELECT s.name, wc.phone_number FROM studios s
        LEFT JOIN whatsapp_connections wc ON wc.studio_id = s.id AND wc.status = 'authorized'
        WHERE s.id = :sid
    """), {"sid": sid}).fetchone()
    return SystemWAOut(studio_id=sid, studio_name=row[0] if row else None, phone_number=row[1] if row else None)


@router.post("/system-whatsapp", response_model=SystemWAOut)
def save_system_whatsapp(payload: SystemWAIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    _cfg_set(db, "system_wa_studio_id", payload.studio_id)
    db.commit()
    return get_system_whatsapp(admin=admin, db=db)


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


# ── Global Leads Inbox ────────────────────────────────────────────────────────

class GlobalLeadOut(BaseModel):
    id: str
    studio_id: str
    studio_name: str
    studio_slug: str
    name: str
    phone: Optional[str]
    email: Optional[str]
    source: str
    status: str
    service_interest: Optional[str]
    notes: Optional[str]
    campaign_name: Optional[str]
    created_at: datetime
    updated_at: datetime


class GlobalLeadUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("/leads-inbox", response_model=list[GlobalLeadOut])
def leads_inbox(
    source: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 200,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    stmt = (
        select(Lead, Studio.name, Studio.slug)
        .join(Studio, Lead.studio_id == Studio.id)
        .where(Studio.is_platform == False)  # noqa: E712
    )
    if source:
        stmt = stmt.where(Lead.source == source)
    if status:
        stmt = stmt.where(Lead.status == status)
    if search:
        q = f"%{search}%"
        stmt = stmt.where(
            (Lead.name.ilike(q)) | (Lead.phone.ilike(q)) | (Lead.email.ilike(q))
        )
    stmt = stmt.order_by(Lead.created_at.desc()).limit(limit)

    rows = db.execute(stmt).all()
    return [
        GlobalLeadOut(
            id=str(r.Lead.id),
            studio_id=str(r.Lead.studio_id),
            studio_name=r[1],
            studio_slug=r[2],
            name=r.Lead.name,
            phone=r.Lead.phone,
            email=r.Lead.email,
            source=r.Lead.source,
            status=r.Lead.status,
            service_interest=r.Lead.service_interest,
            notes=r.Lead.notes,
            campaign_name=r.Lead.campaign_name,
            created_at=r.Lead.created_at,
            updated_at=r.Lead.updated_at,
        )
        for r in rows
    ]


@router.patch("/leads/{lead_id}")
def update_global_lead(
    lead_id: uuid.UUID,
    payload: GlobalLeadUpdate,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if payload.status is not None:
        lead.status = payload.status
    if payload.notes is not None:
        lead.notes = payload.notes
    db.commit()
    return {"status": "updated"}


# ── Global Contacts (all clients across studios) ──────────────────────────────

class GlobalClientOut(BaseModel):
    id: str
    studio_id: str
    studio_name: str
    studio_slug: str
    full_name: str
    phone: Optional[str]
    email: Optional[str]
    is_active: bool
    created_at: datetime


class GlobalAppointmentOut(BaseModel):
    id: str
    studio_id: str
    studio_name: str
    studio_slug: str
    client_name: str
    client_phone: Optional[str]
    title: str
    starts_at: datetime
    status: str
    total_price_cents: int


@router.get("/contacts", response_model=list[GlobalClientOut])
def global_contacts(
    search: Optional[str] = None,
    studio_id: Optional[str] = None,
    limit: int = 300,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    stmt = (
        select(Client, Studio.name, Studio.slug)
        .join(Studio, Client.studio_id == Studio.id)
        .where(Studio.is_platform == False)  # noqa: E712
    )
    if studio_id:
        stmt = stmt.where(Client.studio_id == studio_id)
    if search:
        q = f"%{search}%"
        stmt = stmt.where(
            (Client.full_name.ilike(q)) | (Client.phone.ilike(q)) | (Client.email.ilike(q))
        )
    stmt = stmt.order_by(Client.created_at.desc()).limit(limit)

    rows = db.execute(stmt).all()
    return [
        GlobalClientOut(
            id=str(r.Client.id),
            studio_id=str(r.Client.studio_id),
            studio_name=r[1],
            studio_slug=r[2],
            full_name=r.Client.full_name,
            phone=r.Client.phone,
            email=r.Client.email,
            is_active=r.Client.is_active,
            created_at=r.Client.created_at,
        )
        for r in rows
    ]


@router.get("/appointments", response_model=list[GlobalAppointmentOut])
def global_appointments(
    search: Optional[str] = None,
    studio_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 300,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    stmt = (
        select(Appointment, Client.full_name, Client.phone, Studio.name, Studio.slug)
        .join(Client, Appointment.client_id == Client.id)
        .join(Studio, Appointment.studio_id == Studio.id)
        .where(Studio.is_platform == False)  # noqa: E712
    )
    if studio_id:
        stmt = stmt.where(Appointment.studio_id == studio_id)
    if status:
        stmt = stmt.where(Appointment.status == status)
    if search:
        q = f"%{search}%"
        stmt = stmt.where(
            (Client.full_name.ilike(q)) | (Client.phone.ilike(q))
        )
    stmt = stmt.order_by(Appointment.starts_at.desc()).limit(limit)

    rows = db.execute(stmt).all()
    return [
        GlobalAppointmentOut(
            id=str(r.Appointment.id),
            studio_id=str(r.Appointment.studio_id),
            studio_name=r[3],
            studio_slug=r[4],
            client_name=r[1],
            client_phone=r[2],
            title=r.Appointment.title,
            starts_at=r.Appointment.starts_at,
            status=r.Appointment.status,
            total_price_cents=r.Appointment.total_price_cents,
        )
        for r in rows
    ]


@router.get("/wallet-system", tags=["SuperAdmin"])
def wallet_system_status(_admin: User = Depends(require_superadmin)):
    """Return status of all Wallet environment variables — superadmin only."""
    apple_vars = {
        "APPLE_WALLET_PASS_TYPE_ID": bool(os.getenv("APPLE_WALLET_PASS_TYPE_ID")),
        "APPLE_WALLET_TEAM_ID": bool(os.getenv("APPLE_WALLET_TEAM_ID")),
        "APPLE_WALLET_CERT_PEM": bool(os.getenv("APPLE_WALLET_CERT_PEM")),
        "APPLE_WALLET_CERT_KEY_PEM": bool(os.getenv("APPLE_WALLET_CERT_KEY_PEM")),
        "APPLE_WALLET_WWDR_PEM": bool(os.getenv("APPLE_WALLET_WWDR_PEM")),
    }
    google_vars = {
        "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON": bool(os.getenv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON")),
        "GOOGLE_WALLET_ISSUER_ID": bool(os.getenv("GOOGLE_WALLET_ISSUER_ID")),
    }
    return {
        "apple": {
            "configured": all(apple_vars.values()),
            "vars": apple_vars,
        },
        "google": {
            "configured": all(google_vars.values()),
            "vars": google_vars,
        },
    }


@router.get("/health", tags=["SuperAdmin"])
def platform_health(db: Session = Depends(get_db), _admin: User = Depends(require_superadmin)):
    """Returns health status for all studios: WhatsApp connection + failed message jobs."""
    import urllib.request as _req
    import json as _json

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    studios = db.execute(
        select(Studio, StudioSettings)
        .join(StudioSettings, StudioSettings.studio_id == Studio.id, isouter=True)
    ).all()

    results = []
    for studio, settings in studios:
        # --- Failed message jobs last 24h ---
        failed_count = db.scalar(
            select(func.count(MessageJob.id)).where(
                MessageJob.studio_id == studio.id,
                MessageJob.status == "failed",
                MessageJob.created_at >= cutoff,
            )
        ) or 0

        pending_count = db.scalar(
            select(func.count(MessageJob.id)).where(
                MessageJob.studio_id == studio.id,
                MessageJob.status == "pending",
                MessageJob.scheduled_at <= datetime.now(timezone.utc) - timedelta(minutes=5),
            )
        ) or 0

        # --- WhatsApp Green API status ---
        wa_status = "not_configured"
        if settings and settings.whatsapp_provider == "green_api" and settings.whatsapp_instance_id and settings.whatsapp_api_key:
            try:
                url = f"https://api.green-api.com/waInstance{settings.whatsapp_instance_id}/getStateInstance/{settings.whatsapp_api_key}"
                with _req.urlopen(_req.Request(url), timeout=5) as resp:
                    data = _json.loads(resp.read())
                    state = data.get("stateInstance", "unknown")
                    wa_status = "connected" if state == "authorized" else f"disconnected:{state}"
            except Exception as e:
                wa_status = f"error:{str(e)[:60]}"

        has_alert = failed_count > 0 or pending_count > 0 or (wa_status not in ("not_configured", "connected"))

        results.append({
            "studio_id": str(studio.id),
            "studio_name": studio.name,
            "wa_status": wa_status,
            "failed_jobs_24h": failed_count,
            "stuck_pending_jobs": pending_count,
            "has_alert": has_alert,
        })

    results.sort(key=lambda x: (not x["has_alert"], x["studio_name"]))
    return results


# ── Invoice AI Scan Management ────────────────────────────────────────────────

class InvoiceScanQuotaUpdate(BaseModel):
    quota: int  # 0 = unlimited


@router.get("/invoice-scans/stats", tags=["SuperAdmin"])
def invoice_scan_stats(_admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Get invoice scan usage stats for all studios."""
    from app.models.studio_feature import StudioFeature
    studios = db.query(Studio).filter(Studio.is_active == True).order_by(Studio.name).all()
    result = []
    for s in studios:
        feature = db.query(StudioFeature).filter_by(
            studio_id=s.id, feature="invoice_ai_scan"
        ).first()
        result.append({
            "studio_id": str(s.id),
            "studio_name": s.name,
            "enabled": feature.is_enabled if feature else False,
            "quota": getattr(s, "invoice_scan_quota", 0),
            "used": getattr(s, "invoice_scan_used", 0),
            "reset_month": getattr(s, "invoice_scan_reset_month", None),
        })
    # Sort: most used first
    result.sort(key=lambda x: x["used"], reverse=True)
    total_used = sum(r["used"] for r in result)
    return {"studios": result, "total_used": total_used}


@router.put("/studios/{studio_id}/invoice-scan-quota", tags=["SuperAdmin"])
def set_invoice_scan_quota(
    studio_id: str,
    payload: InvoiceScanQuotaUpdate,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Set monthly invoice scan quota for a studio (0 = unlimited)."""
    studio = db.query(Studio).filter_by(id=studio_id).first()
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    studio.invoice_scan_quota = payload.quota
    _audit(db, admin, "set_invoice_scan_quota", studio, {"quota": payload.quota})
    db.commit()
    return {"studio_id": studio_id, "quota": payload.quota}


@router.post("/studios/{studio_id}/invoice-scan-enable", tags=["SuperAdmin"])
def enable_invoice_scan(
    studio_id: str,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Enable invoice AI scan feature for a studio."""
    from app.models.studio_feature import StudioFeature
    studio = db.query(Studio).filter_by(id=studio_id).first()
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    feature = db.query(StudioFeature).filter_by(
        studio_id=studio_id, feature="invoice_ai_scan"
    ).first()
    if feature:
        feature.is_enabled = True
    else:
        db.add(StudioFeature(studio_id=studio_id, feature="invoice_ai_scan", is_enabled=True))
    _audit(db, admin, "enable_invoice_ai_scan", studio)
    db.commit()
    return {"enabled": True}


@router.post("/studios/{studio_id}/invoice-scan-disable", tags=["SuperAdmin"])
def disable_invoice_scan(
    studio_id: str,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Disable invoice AI scan feature for a studio."""
    from app.models.studio_feature import StudioFeature
    studio = db.query(Studio).filter_by(id=studio_id).first()
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    feature = db.query(StudioFeature).filter_by(
        studio_id=studio_id, feature="invoice_ai_scan"
    ).first()
    if feature:
        feature.is_enabled = False
    _audit(db, admin, "disable_invoice_ai_scan", studio)
    db.commit()
    return {"enabled": False}


# ── Phase 0: Module Management ───────────────────────────────────────────────

class ModuleToggle(BaseModel):
    is_enabled: bool


@router.get("/modules", tags=["SuperAdmin"])
def list_modules(_admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """List all registered modules."""
    from app.models.module import Module as ModuleModel
    mods = db.scalars(select(ModuleModel).order_by(ModuleModel.sort_order)).all()
    return [{"id": m.id, "name": m.name, "category": m.category,
             "is_available": m.is_available, "sort_order": m.sort_order} for m in mods]


@router.get("/studios/{studio_id}/modules", tags=["SuperAdmin"])
def get_studio_module_status(
    studio_id: str,
    _admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Get all modules with enabled status for a studio."""
    from app.core.features import get_studio_modules
    studio = db.query(Studio).filter_by(id=studio_id).first()
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    return get_studio_modules(db, studio_id, studio.subscription_plan)


@router.put("/studios/{studio_id}/modules/{module_id}", tags=["SuperAdmin"])
def set_studio_module(
    studio_id: str,
    module_id: str,
    payload: ModuleToggle,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Enable or disable a specific module for a studio."""
    from app.models.module import StudioModule
    studio = db.query(Studio).filter_by(id=studio_id).first()
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    override = db.query(StudioModule).filter_by(studio_id=studio_id, module_id=module_id).first()
    if override:
        override.is_enabled = payload.is_enabled
        override.enabled_by_id = admin.id
    else:
        db.add(StudioModule(
            studio_id=studio_id, module_id=module_id,
            is_enabled=payload.is_enabled, enabled_by_id=admin.id,
        ))
    action = f"{'enable' if payload.is_enabled else 'disable'}_module_{module_id}"
    _audit(db, admin, action, studio, {"module": module_id, "enabled": payload.is_enabled})
    db.commit()
    return {"studio_id": studio_id, "module_id": module_id, "is_enabled": payload.is_enabled}


@router.get("/plan-modules", tags=["SuperAdmin"])
def get_plan_modules(_admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Get module list per plan."""
    from app.models.module import PlanModule
    rows = db.query(PlanModule).all()
    result: dict = {}
    for r in rows:
        result.setdefault(r.plan, []).append(r.module_id)
    return result


@router.get("/business-types", tags=["SuperAdmin"])
def get_business_types(_admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Get all business type templates."""
    from app.models.module import BusinessTypeTemplate
    rows = db.query(BusinessTypeTemplate).all()
    return [{"business_type": r.business_type, "display_name": r.display_name,
             "default_modules": r.default_modules, "default_services": r.default_services} for r in rows]


@router.put("/studios/{studio_id}/business-type", tags=["SuperAdmin"])
def set_studio_business_type(
    studio_id: str,
    payload: dict,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Set business type and optionally load default modules."""
    from app.models.module import BusinessTypeTemplate, StudioModule
    studio = db.query(Studio).filter_by(id=studio_id).first()
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    bt = payload.get("business_type", "other")
    studio.business_type = bt
    # Optionally load defaults
    if payload.get("load_defaults"):
        tmpl = db.query(BusinessTypeTemplate).filter_by(business_type=bt).first()
        if tmpl:
            for mod_id in tmpl.default_modules:
                existing = db.query(StudioModule).filter_by(
                    studio_id=studio_id, module_id=mod_id
                ).first()
                if not existing:
                    db.add(StudioModule(studio_id=studio_id, module_id=mod_id,
                                        is_enabled=True, enabled_by_id=admin.id))
    _audit(db, admin, "set_business_type", studio, {"business_type": bt})
    db.commit()
    return {"studio_id": studio_id, "business_type": bt}


@router.delete("/studios/{studio_id}/clients", tags=["SuperAdmin"])
def delete_all_studio_clients(studio_id: str, _admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    from app.models.client_points_ledger import ClientPointsLedger
    from app.models.appointment import Appointment
    from app.models.payment import Payment
    from app.models.incoming_message import IncomingMessage
    # Delete in FK-safe order: dependents before clients
    db.query(ClientPointsLedger).filter(ClientPointsLedger.studio_id == studio_id).delete(synchronize_session=False)
    db.query(MessageJob).filter(MessageJob.studio_id == studio_id).delete(synchronize_session=False)
    db.query(IncomingMessage).filter(IncomingMessage.studio_id == studio_id).update({"client_id": None}, synchronize_session=False)
    db.query(Payment).filter(Payment.studio_id == studio_id).delete(synchronize_session=False)
    db.query(Appointment).filter(Appointment.studio_id == studio_id).delete(synchronize_session=False)
    db.query(Client).filter(Client.studio_id == studio_id).delete(synchronize_session=False)
    db.commit()
    return {"deleted": True, "studio_id": studio_id}


# ── Package Editor ────────────────────────────────────────────────────────────

class PlanModuleUpdate(BaseModel):
    plan: str
    module_ids: list[str]


@router.get("/packages", tags=["SuperAdmin"])
def get_packages(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Get current module list for all plans."""
    from app.models.module import PlanModule, Module
    all_modules = db.scalars(select(Module).where(Module.is_available == True).order_by(Module.sort_order)).all()
    plan_rows = db.query(PlanModule).all()
    plan_map: dict = {}
    for row in plan_rows:
        plan_map.setdefault(row.plan, []).append(row.module_id)
    return {
        "plans": ["free", "starter", "pro", "enterprise", "platform"],
        "modules": [{"id": m.id, "name": m.name, "category": m.category} for m in all_modules],
        "plan_modules": plan_map,
    }


@router.put("/packages", tags=["SuperAdmin"])
def update_package(payload: PlanModuleUpdate, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Replace the module list for a plan."""
    from app.models.module import PlanModule
    db.query(PlanModule).filter(PlanModule.plan == payload.plan).delete()
    for mid in payload.module_ids:
        db.add(PlanModule(plan=payload.plan, module_id=mid))
    _audit(db, admin, "update_package", details={"plan": payload.plan, "modules": payload.module_ids})
    db.commit()
    return {"plan": payload.plan, "modules": payload.module_ids}


# ── Global Platform Analytics ─────────────────────────────────────────────────

@router.get("/platform-analytics", tags=["SuperAdmin"])
def platform_analytics(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Aggregate metrics across all studios for the SuperAdmin dashboard."""
    from app.models.appointment import Appointment
    from app.models.payment import Payment
    from app.models.client import Client
    from app.models.message_job import MessageJob
    from app.models.studio_feature import StudioFeature
    import pytz
    from datetime import datetime, timezone, timedelta

    tz = pytz.timezone("Asia/Jerusalem")
    now = datetime.now(tz)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    thirty_days_ago = (now - timedelta(days=30)).astimezone(timezone.utc)

    # Studio counts
    active_studios = db.scalar(select(func.count(Studio.id)).where(
        Studio.is_active == True, Studio.is_platform == False  # noqa
    )) or 0

    # MRR (all payments this month)
    mrr_cents = db.scalar(select(func.sum(Payment.amount_cents)).where(
        Payment.status == "paid", Payment.type == "payment",
        Payment.created_at >= month_start,
    )) or 0

    # Appointments today
    appts_today = db.scalar(select(func.count(Appointment.id)).where(
        Appointment.starts_at >= today_start,
        Appointment.status != "canceled",
    )) or 0

    # Total appointments this month
    appts_month = db.scalar(select(func.count(Appointment.id)).where(
        Appointment.starts_at >= month_start,
        Appointment.status.in_(["done", "scheduled"]),
    )) or 0

    # Messages sent this month
    messages_sent = db.scalar(select(func.count(MessageJob.id)).where(
        MessageJob.status == "sent",
        MessageJob.sent_at >= month_start,
    )) or 0

    # Total clients
    total_clients = db.scalar(select(func.count(Client.id))) or 0

    # Top 5 studios by revenue this month
    top_studios = db.execute(
        select(Studio.name, Studio.slug, func.sum(Payment.amount_cents).label("rev"))
        .join(Payment, Payment.studio_id == Studio.id)
        .where(Payment.status == "paid", Payment.type == "payment", Payment.created_at >= month_start)
        .group_by(Studio.id, Studio.name, Studio.slug)
        .order_by(func.sum(Payment.amount_cents).desc())
        .limit(5)
    ).all()

    # At-risk studios (no appointment in 30 days, active subscription)
    active_studio_ids = db.scalars(
        select(Studio.id).where(Studio.is_active == True, Studio.is_platform == False)  # noqa
    ).all()
    recent_active = set(db.scalars(
        select(func.distinct(Appointment.studio_id)).where(
            Appointment.starts_at >= thirty_days_ago
        )
    ).all())
    at_risk_count = sum(1 for sid in active_studio_ids if sid not in recent_active)

    # Plan distribution
    plan_dist = db.execute(
        select(Studio.subscription_plan, func.count(Studio.id))
        .where(Studio.is_active == True, Studio.is_platform == False)  # noqa
        .group_by(Studio.subscription_plan)
    ).all()

    return {
        "active_studios": active_studios,
        "mrr_ils": mrr_cents / 100,
        "appts_today": appts_today,
        "appts_month": appts_month,
        "messages_sent_month": messages_sent,
        "total_clients": total_clients,
        "at_risk_studios": at_risk_count,
        "top_studios": [
            {"name": r.name, "slug": r.slug, "revenue_ils": (r.rev or 0) / 100}
            for r in top_studios
        ],
        "plan_distribution": [
            {"plan": plan, "count": count} for plan, count in plan_dist
        ],
    }


# ── Hero Slides (BizFind carousel) ───────────────────────────────────────────

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}

from app.api.upload_routes import _cloudinary_upload as _upload_to_cloudinary


@router.get("/hero-slides")
def list_hero_slides(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "superadmin":
        raise HTTPException(403, "Forbidden")
    rows = db.execute(
        text("SELECT id, url, label, sort_order, is_active, created_at FROM hero_slides ORDER BY sort_order, created_at")
    ).fetchall()
    return [{"id": str(r[0]), "url": r[1], "label": r[2], "sort_order": r[3], "is_active": r[4], "created_at": str(r[5])} for r in rows]


@router.post("/hero-slides", status_code=201)
def upload_hero_slide(
    file: UploadFile = File(...),
    label: str = Form(""),
    sort_order: int = Form(0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "superadmin":
        raise HTTPException(403, "Forbidden")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Only image files are allowed")
    file_bytes = file.file.read()
    slide_id = str(uuid.uuid4()).replace("-", "")
    cloud_url = _upload_to_cloudinary(file_bytes, "bizfind/hero", slide_id)
    if not cloud_url:
        os.makedirs("uploads/hero", exist_ok=True)
        ext = (file.filename or "img.jpg").rsplit(".", 1)[-1].lower()
        fname = f"hero_{slide_id[:16]}.{ext}"
        with open(f"uploads/hero/{fname}", "wb") as f:
            f.write(file_bytes)
        cloud_url = f"/uploads/hero/{fname}"
    db.execute(
        text("INSERT INTO hero_slides (url, label, sort_order) VALUES (:url, :label, :sort)"),
        {"url": cloud_url, "label": label, "sort": sort_order}
    )
    db.commit()
    row = db.execute(
        text("SELECT id, url, label, sort_order FROM hero_slides WHERE url=:url ORDER BY created_at DESC LIMIT 1"),
        {"url": cloud_url}
    ).fetchone()
    return {"id": str(row[0]), "url": row[1], "label": row[2], "sort_order": row[3]}


@router.patch("/hero-slides/{slide_id}")
def update_hero_slide(
    slide_id: str,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "superadmin":
        raise HTTPException(403, "Forbidden")
    updates = []
    params: dict = {"sid": slide_id}
    if "label" in payload:
        updates.append("label = :label")
        params["label"] = payload["label"]
    if "sort_order" in payload:
        updates.append("sort_order = :sort_order")
        params["sort_order"] = payload["sort_order"]
    if "is_active" in payload:
        updates.append("is_active = :is_active")
        params["is_active"] = payload["is_active"]
    if not updates:
        raise HTTPException(400, "Nothing to update")
    db.execute(text(f"UPDATE hero_slides SET {', '.join(updates)} WHERE id = :sid"), params)
    db.commit()
    return {"ok": True}


@router.delete("/hero-slides/{slide_id}")
def delete_hero_slide(
    slide_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "superadmin":
        raise HTTPException(403, "Forbidden")
    db.execute(text("DELETE FROM hero_slides WHERE id = :sid"), {"sid": slide_id})
    db.commit()
    return {"ok": True}
