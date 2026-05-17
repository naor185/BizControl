from __future__ import annotations
import logging
from uuid import UUID
from sqlalchemy import select, or_
from sqlalchemy.orm import Session

from app.models.client import Client
from app.schemas.client import ClientCreate, ClientUpdate

log = logging.getLogger(__name__)

def _handle_new_club_member(db: Session, studio_id: UUID, client: Client):
    from app.models.studio_settings import StudioSettings
    from app.models.client_points_ledger import ClientPointsLedger
    from app.models.message_job import MessageJob
    from app.crud.automation import format_template
    from datetime import datetime, timezone

    settings = db.get(StudioSettings, studio_id)
    if not settings:
        return
        
    points = settings.points_on_signup or 0
    if points > 0:
        client.loyalty_points = int(client.loyalty_points or 0) + points
        db.add(ClientPointsLedger(
            studio_id=studio_id,
            client_id=client.id,
            appointment_id=None,
            delta_points=points,
            reason="Club signup bonus"
        ))
        
    # Build context for placeholders
    context = {
        "client_name": client.full_name,
        "points_added": points,
        "points_total": client.loyalty_points,
    }

    # WhatsApp Welcome
    wa_template = settings.welcome_wa_template
    if not wa_template:
        wa_template = "שלום {client_name}, ברוכים הבאים למועדון הלקוחות שלנו! שמחים שהצטרפת. צברת {points_added} נקודות במתנה! סה״כ: {points_total}"

    if client.phone:
        wa_body = format_template(wa_template, context)
        db.add(MessageJob(
            studio_id=studio_id,
            client_id=client.id,
            channel="whatsapp",
            to_phone=client.phone,
            body=wa_body,
            scheduled_at=datetime.now(timezone.utc),
            status="pending",
        ))

    # In-app notification to studio owner
    from app.models.notification import Notification
    points_text = f" • {points} נקודות" if points > 0 else ""
    db.add(Notification(
        studio_id=studio_id,
        type="new_member",
        title=f"חבר/ה חדש/ה הצטרפ/ה למועדון",
        body=f"{client.full_name} | {client.phone or client.email or ''}{points_text}",
        action_url="/clients",
    ))

    # Email Welcome
    if client.email and settings.smtp_host:
        email_template = settings.welcome_email_template
        if not email_template:
            # Fallback to old hardcoded HTML if template is empty
            email_template = f"""
            <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #333;">ברוכים הבאים למועדון! 👑</h2>
                <p>שלום {client.full_name},</p>
                <p>שמחים שהצטרפת למועדון הלקוחות שלנו. פינקנו אותך ב-<strong style="color: #10b981;">{points} נקודות</strong> במתנה!</p>
                <p><strong>סה״כ היתרה שלך עומדת כעת על: {client.loyalty_points} נקודות.</strong></p>
                <p>נשמח לראותך בקרוב!</p>
                <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
                <p style="font-size: 12px; color: #888;">הודעה זו נשלחה אוטומטית ממערכת BizControl.</p>
            </div>
            """
        
        email_body = format_template(email_template, context)

        db.add(MessageJob(
            studio_id=studio_id,
            client_id=client.id,
            channel="email",
            to_phone=client.email,
            body=email_body,
            scheduled_at=datetime.now(timezone.utc),
            status="pending",
        ))


def _run_club_member_bg(studio_id: UUID, client_id: UUID) -> None:
    """Runs in background after client commit — creates points/messages/notification."""
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        client = db.get(Client, client_id)
        if client:
            _handle_new_club_member(db, studio_id, client)
            db.commit()
    except Exception as e:
        log.error("_handle_new_club_member failed for client %s: %s", client_id, e, exc_info=True)
        db.rollback()
    finally:
        db.close()


def create_client(db: Session, studio_id: UUID, data: ClientCreate, background_tasks=None) -> Client:
    full_name_clean = data.full_name.strip()
    phone_clean = data.phone.strip() if data.phone else None
    email_clean = str(data.email).lower().strip() if data.email else None

    conditions = []
    if phone_clean:
        conditions.append(Client.phone == phone_clean)
    if email_clean:
        conditions.append(Client.email == email_clean)

    existing = None
    if conditions:
        existing = db.scalars(
            select(Client).where(Client.studio_id == studio_id, or_(*conditions))
        ).first()

    if existing:
        if existing.is_active:
            raise ValueError("לקוח עם טלפון או אימייל זהה כבר קיים במערכת")

        existing.is_active = True
        existing.full_name = full_name_clean
        existing.phone = phone_clean
        existing.email = email_clean
        existing.birth_date = data.birth_date
        existing.notes = data.notes
        existing.is_club_member = data.is_club_member
        db.commit()
        db.refresh(existing)

        if existing.is_club_member:
            if background_tasks:
                background_tasks.add_task(_run_club_member_bg, studio_id, existing.id)
            else:
                _run_club_member_bg(studio_id, existing.id)
        return existing

    obj = Client(
        studio_id=studio_id,
        full_name=full_name_clean,
        phone=phone_clean,
        email=email_clean,
        birth_date=data.birth_date,
        notes=data.notes,
        is_active=data.is_active,
        is_club_member=data.is_club_member,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    if obj.is_club_member:
        if background_tasks:
            background_tasks.add_task(_run_club_member_bg, studio_id, obj.id)
        else:
            _run_club_member_bg(studio_id, obj.id)

    return obj

def get_client(db: Session, studio_id: UUID, client_id: UUID) -> Client | None:
    q = select(Client).where(Client.studio_id == studio_id, Client.id == client_id)
    return db.scalar(q)

def list_clients(
    db: Session,
    studio_id: UUID,
    q: str | None = None,
    skip: int = 0,
    limit: int = 50,
    active_only: bool = True,
) -> list[Client]:
    stmt = select(Client).where(Client.studio_id == studio_id)

    if active_only:
        stmt = stmt.where(Client.is_active.is_(True))

    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            Client.full_name.ilike(like) |
            Client.phone.ilike(like) |
            Client.email.ilike(like)
        )

    stmt = stmt.order_by(Client.created_at.desc()).offset(skip).limit(min(limit, 100))
    return list(db.scalars(stmt).all())

def update_client(db: Session, studio_id: UUID, client_id: UUID, data: ClientUpdate) -> Client | None:
    obj = get_client(db, studio_id, client_id)
    if not obj:
        return None

    was_club_member = obj.is_club_member

    if data.full_name is not None:
        obj.full_name = data.full_name.strip()
    if data.phone is not None:
        obj.phone = data.phone.strip() if data.phone else None
    if data.email is not None:
        obj.email = str(data.email).lower().strip() if data.email else None
    if data.birth_date is not None or data.birth_date is None:
        obj.birth_date = data.birth_date
    if data.notes is not None:
        obj.notes = data.notes
    if data.is_active is not None:
        obj.is_active = data.is_active
    if data.is_club_member is not None:
        obj.is_club_member = data.is_club_member

    if obj.is_club_member and not was_club_member:
        sp = db.begin_nested()
        try:
            _handle_new_club_member(db, studio_id, obj)
            sp.commit()
        except Exception:
            sp.rollback()

    db.commit()
    db.refresh(obj)
    return obj

def soft_delete_client(db: Session, studio_id: UUID, client_id: UUID) -> bool:
    obj = get_client(db, studio_id, client_id)
    if not obj:
        return False
    obj.is_active = False
    db.commit()
    return True
