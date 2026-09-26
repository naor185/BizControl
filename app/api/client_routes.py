from __future__ import annotations
import os
from uuid import UUID, uuid4
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.schemas.client import ClientCreate, ClientUpdate, ClientOut, ClientProfileOut, ClientPhotoOut
from app.crud.client import create_client, get_client, list_clients, update_client, soft_delete_client
from app.models.client_points_ledger import ClientPointsLedger
from app.models.client_treatment_photo import ClientTreatmentPhoto
from app.models.message_job import MessageJob
from app.api.upload_routes import _cloudinary_upload, _save_image_bytes, ALLOWED_IMAGE_TYPES, UPLOAD_DIR

from app.models.client import Client

router = APIRouter(prefix="/clients", tags=["Clients"])

@router.get("/walk-in", response_model=ClientOut)
def get_or_create_walk_in(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Returns the studio's singleton walk-in (spontaneous) client, creating it lazily if it doesn't exist yet."""
    obj = db.scalar(
        select(Client).where(Client.studio_id == ctx.studio_id, Client.is_walk_in == True)
    )
    if not obj:
        obj = Client(
            studio_id=ctx.studio_id,
            full_name="לקוח מזדמן 🚶",
            phone=None,
            email=None,
            is_walk_in=True,
            marketing_consent=False,
        )
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
def create(
    payload: ClientCreate,
    background_tasks: BackgroundTasks,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    try:
        return create_client(db, ctx.studio_id, payload, background_tasks)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("", response_model=list[ClientOut])
def list_(
    q: str | None = None,
    skip: int = 0,
    limit: int = 50,
    active_only: bool = True,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    return list_clients(db, ctx.studio_id, q=q, skip=skip, limit=limit, active_only=active_only)

@router.get("/counts")
def get_counts(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """True counts — not limited by pagination."""
    from sqlalchemy import func
    total = db.scalar(
        select(func.count(Client.id)).where(Client.studio_id == ctx.studio_id, Client.is_active.is_(True))
    ) or 0
    club = db.scalar(
        select(func.count(Client.id)).where(Client.studio_id == ctx.studio_id, Client.is_active.is_(True), Client.is_club_member.is_(True))
    ) or 0
    return {"total": total, "club_members": club}

@router.get("/club/stats")
def club_stats(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    from sqlalchemy import func
    from datetime import datetime, timezone
    import calendar

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    members = db.scalars(
        select(Client)
        .where(Client.studio_id == ctx.studio_id, Client.is_club_member == True, Client.is_active.is_(True))
        .order_by(Client.created_at.desc())
    ).all()

    result = []
    for c in members:
        source = "landing" if "דרך דף נחיתה" in (c.notes or "") else "manual"
        result.append({
            "id": str(c.id),
            "full_name": c.full_name,
            "phone": c.phone,
            "points": int(c.loyalty_points or 0),
            "joined_at": c.created_at.isoformat() if c.created_at else None,
            "birth_date": c.birth_date.isoformat() if c.birth_date else None,
            "source": source,
        })

    this_month = sum(1 for c in members if c.created_at and c.created_at.replace(tzinfo=timezone.utc) >= month_start)
    via_landing = sum(1 for r in result if r["source"] == "landing")

    return {
        "total": len(result),
        "this_month": this_month,
        "via_landing": via_landing,
        "via_manual": len(result) - via_landing,
        "members": result,
    }


@router.get("/club/leaderboard")
def club_leaderboard(
    limit: int = 10,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Top clients by visit count and by total payments (including POS)."""
    from sqlalchemy import func
    from app.models.appointment import Appointment

    # Top visitors
    visit_rows = db.execute(
        select(Client.id, Client.full_name, Client.phone, Client.is_club_member, Client.loyalty_points,
               func.count(Appointment.id).label("visit_count"))
        .join(Appointment, (Appointment.client_id == Client.id) & (Appointment.studio_id == ctx.studio_id))
        .where(Client.studio_id == ctx.studio_id, Client.is_active.is_(True),
               Client.is_walk_in.is_(False),
               Appointment.status.in_(["done", "scheduled"]))
        .group_by(Client.id, Client.full_name, Client.phone, Client.is_club_member, Client.loyalty_points)
        .order_by(func.count(Appointment.id).desc())
        .limit(limit)
    ).all()

    # Top payers — what each really paid (crud.payment.clients_paid, the client card's sum)
    from app.crud.payment import clients_paid
    paid = {cid: v["net"] for cid, v in clients_paid(db, ctx.studio_id).items() if v["net"] > 0}
    payer_rows = db.execute(
        select(Client.id, Client.full_name, Client.phone, Client.is_club_member, Client.loyalty_points)
        .where(Client.studio_id == ctx.studio_id, Client.is_active.is_(True), Client.is_walk_in.is_(False),
               Client.id.in_(list(paid)))
    ).all() if paid else []
    top_payers = sorted(({"id": str(r.id), "full_name": r.full_name, "phone": r.phone, "is_club_member": r.is_club_member,
                          "loyalty_points": int(r.loyalty_points or 0), "total_paid_cents": paid[r.id]} for r in payer_rows),
                        key=lambda x: x["total_paid_cents"], reverse=True)[:limit]

    def _visit_row(r):
        return {"id": str(r.id), "full_name": r.full_name, "phone": r.phone,
                "is_club_member": r.is_club_member, "loyalty_points": int(r.loyalty_points or 0),
                "visit_count": r.visit_count}

    return {
        "top_visitors": [_visit_row(r) for r in visit_rows],
        "top_payers": top_payers,
    }


@router.get("/analytics")
def client_analytics(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Client-focused KPIs + 6-month new-vs-returning trend (single source for both)."""
    from datetime import datetime, timedelta
    import pytz
    from sqlalchemy import text as _t
    from app.models.studio_settings import StudioSettings

    sid = str(ctx.studio_id)
    settings = db.get(StudioSettings, ctx.studio_id)
    tz = pytz.timezone(settings.timezone if settings and settings.timezone else "Asia/Jerusalem")
    now = datetime.now(tz)

    # LTV: average of what each paying client really paid (all time — crud.payment.clients_paid)
    from app.crud.payment import clients_paid
    nets = [v["net"] for v in clients_paid(db, ctx.studio_id).values()]
    ltv_cents = sum(nets) / len(nets) if nets else 0

    # Retention: % of clients with 2+ appointments in the last 90 days
    retention_row = db.execute(_t("""
        SELECT
            COUNT(*) FILTER (WHERE appt_count >= 2) AS retained,
            COUNT(*) AS total_active
        FROM (
            SELECT client_id, COUNT(*) AS appt_count
            FROM appointments
            WHERE studio_id = :sid AND status != 'canceled'
              AND starts_at >= :since
            GROUP BY client_id
        ) sub
    """), {"sid": sid, "since": now - timedelta(days=90)}).fetchone()
    retained = retention_row[0] or 0
    total_active = retention_row[1] or 0
    retention_rate = round(retained / total_active * 100) if total_active > 0 else 0

    # Churn: clients whose last real appointment was more than 60 days ago
    churn_count = db.execute(_t("""
        SELECT COUNT(*) FROM (
            SELECT client_id, MAX(starts_at) AS last_appt
            FROM appointments
            WHERE studio_id = :sid AND status NOT IN ('canceled','no_show')
            GROUP BY client_id
            HAVING MAX(starts_at) < :cutoff
        ) sub
    """), {"sid": sid, "cutoff": now - timedelta(days=60)}).scalar() or 0

    # New vs returning per month: "new" = the client's FIRST-EVER appointment fell in that month
    retention_trend = []
    for i in range(5, -1, -1):
        m = now.month - i
        y = now.year
        while m <= 0:
            m += 12
            y -= 1
        ms = tz.localize(datetime(y, m, 1))
        me = tz.localize(datetime(y, m + 1, 1)) if m < 12 else tz.localize(datetime(y + 1, 1, 1))

        rows = db.execute(_t("""
            SELECT
                COUNT(DISTINCT client_id) FILTER (WHERE is_new) AS new_c,
                COUNT(DISTINCT client_id) FILTER (WHERE NOT is_new) AS ret_c
            FROM (
                SELECT
                    a.client_id,
                    (SELECT MIN(starts_at) FROM appointments a2
                     WHERE a2.client_id = a.client_id AND a2.studio_id = :sid
                       AND a2.status != 'canceled') >= :ms AS is_new
                FROM appointments a
                WHERE a.studio_id = :sid AND a.status != 'canceled'
                  AND a.starts_at >= :ms AND a.starts_at < :me
            ) sub
        """), {"sid": sid, "ms": ms, "me": me}).fetchone()

        new_c = rows[0] or 0
        ret_c = rows[1] or 0
        total = new_c + ret_c
        retention_trend.append({
            "month": ms.strftime("%m/%y"),
            "new": new_c,
            "returning": ret_c,
            "total": total,
            "retention_pct": round(ret_c / total * 100) if total > 0 else 0,
        })

    return {
        "kpis": {
            "retention_rate_pct": retention_rate,
            "ltv_ils": round(ltv_cents / 100),
            "churn_count": int(churn_count),
        },
        "retention_trend": retention_trend,
    }


@router.get("/{client_id}", response_model=ClientOut)
def get_one(
    client_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    obj = get_client(db, ctx.studio_id, client_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Client not found")
    return obj

@router.patch("/{client_id}", response_model=ClientOut)
def patch(
    client_id: UUID,
    payload: ClientUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    try:
        obj = update_client(db, ctx.studio_id, client_id, payload)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    if not obj:
        raise HTTPException(status_code=404, detail="Client not found")
    return obj

@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(
    client_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    ok = soft_delete_client(db, ctx.studio_id, client_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Client not found")
    return None

@router.post("/{client_id}/reset-points", status_code=200)
def reset_points(
    client_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Zero out a client's loyalty points without touching payment history."""
    client = db.scalar(select(Client).where(Client.id == client_id, Client.studio_id == ctx.studio_id))
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.loyalty_points = 0
    db.commit()
    return {"ok": True, "points": 0}


@router.get("/{client_id}/profile", response_model=ClientProfileOut)
def profile(
    client_id: UUID,
    ledger_limit: int = 100,
    messages_limit: int = 100,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    obj = get_client(db, ctx.studio_id, client_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Client not found")

    ledger_stmt = (
        select(ClientPointsLedger)
        .where(
            ClientPointsLedger.studio_id == ctx.studio_id,
            ClientPointsLedger.client_id == client_id,
        )
        .order_by(ClientPointsLedger.created_at.desc())
        .limit(min(int(ledger_limit), 200))
    )
    ledger = list(db.scalars(ledger_stmt).all())

    msg_stmt = (
        select(MessageJob)
        .where(
            MessageJob.studio_id == ctx.studio_id,
            MessageJob.client_id == client_id,
        )
        .order_by(MessageJob.created_at.desc())
        .limit(min(int(messages_limit), 200))
    )
    messages = list(db.scalars(msg_stmt).all())

    from app.models.appointment import Appointment
    from sqlalchemy import func

    # What the client really paid — payments + till sales, less refunds, club points left out
    from app.crud.payment import clients_paid
    totals = clients_paid(db, ctx.studio_id, [client_id]).get(client_id, {"paid": 0, "refund": 0, "net": 0})
    total_paid, total_refund, net_paid = totals["paid"], totals["refund"], totals["net"]

    total_appts_cents = db.scalar(
        select(func.sum(Appointment.total_price_cents))
        .where(Appointment.client_id == client_id, Appointment.studio_id == ctx.studio_id, Appointment.status != "canceled")
    ) or 0
    
    remaining = max(0, total_appts_cents - net_paid)

    return {
        "client": obj,
        "points_balance": int(getattr(obj, "loyalty_points", 0) or 0),
        "ledger": ledger,
        "messages": messages,
        "total_paid_cents": total_paid,
        "total_refund_cents": total_refund,
        "net_paid_cents": net_paid,
        "total_appointments_cents": total_appts_cents,
        "remaining_balance_cents": remaining
    }


@router.get("/{client_id}/photos", response_model=list[ClientPhotoOut])
def list_photos(
    client_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    obj = get_client(db, ctx.studio_id, client_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Client not found")
    stmt = (
        select(ClientTreatmentPhoto)
        .where(ClientTreatmentPhoto.studio_id == ctx.studio_id, ClientTreatmentPhoto.client_id == client_id)
        .order_by(ClientTreatmentPhoto.created_at.desc())
    )
    return list(db.scalars(stmt).all())


@router.post("/{client_id}/photos", response_model=ClientPhotoOut, status_code=status.HTTP_201_CREATED)
def upload_photo(
    client_id: UUID,
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    appointment_id: UUID | None = Form(None),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    obj = get_client(db, ctx.studio_id, client_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Client not found")

    if appointment_id is not None:
        from app.models.appointment import Appointment
        appt = db.scalar(
            select(Appointment).where(
                Appointment.id == appointment_id,
                Appointment.studio_id == ctx.studio_id,
                Appointment.client_id == client_id,
            )
        )
        if not appt:
            raise HTTPException(status_code=400, detail="Appointment does not belong to this client")

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    file_bytes = file.file.read()
    cloud_url = _cloudinary_upload(file_bytes, f"bizfind/{ctx.studio_id}/clients/{client_id}", uuid4().hex, db=db)
    if cloud_url:
        url = cloud_url
    else:
        # Stored as a relative /uploads/... path (never absolutized) — both
        # web/'s Next rewrite and BizFind's imgUrl() helper already know how
        # to resolve a relative uploads path against the backend origin, and
        # this keeps delete_photo's "only unlink non-http urls" check correct.
        filename = _save_image_bytes(file_bytes, file.content_type, "client_photo", ctx.studio_id)
        url = f"/uploads/{filename}"

    photo = ClientTreatmentPhoto(
        studio_id=ctx.studio_id,
        client_id=client_id,
        appointment_id=appointment_id,
        uploaded_by_id=ctx.user_id,
        photo_url=url,
        caption=caption,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return photo


@router.delete("/{client_id}/photos/{photo_id}", status_code=200)
def delete_photo(
    client_id: UUID,
    photo_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    photo = db.scalar(
        select(ClientTreatmentPhoto).where(
            ClientTreatmentPhoto.id == photo_id,
            ClientTreatmentPhoto.studio_id == ctx.studio_id,
            ClientTreatmentPhoto.client_id == client_id,
        )
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    # Only delete local files — never touch remote (Cloudinary) URLs, mirrors
    # upload_routes.delete_gallery_photo's exact safety check.
    if photo.photo_url and not photo.photo_url.startswith("http"):
        file_path = os.path.normpath(photo.photo_url.lstrip("/"))
        uploads_root = os.path.normpath(UPLOAD_DIR)
        if os.path.abspath(file_path).startswith(os.path.abspath(uploads_root)) and os.path.exists(file_path):
            os.remove(file_path)
    db.delete(photo)
    db.commit()
    return {"ok": True}


@router.post("/{client_id}/send-points-balance")
def send_points_balance(
    client_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Send the client their current loyalty points balance via WhatsApp."""
    from datetime import datetime, timezone
    from app.models.studio_settings import StudioSettings
    from app.crud.automation import format_template

    client = db.scalar(select(Client).where(Client.id == client_id, Client.studio_id == ctx.studio_id))
    if not client:
        raise HTTPException(status_code=404, detail="לקוח לא נמצא")
    if not client.phone:
        raise HTTPException(status_code=400, detail="ללקוח אין מספר טלפון")

    settings = db.get(StudioSettings, ctx.studio_id)
    template = (
        getattr(settings, "points_balance_wa_template", None)
        if settings else None
    ) or "היי {client_name}! 🌟\n\nיתרת הנקודות שלך במועדון: *{loyalty_points} נקודות*\n\nנשמח לראותך שוב בקרוב! 💫"

    context = {
        "client_name": client.full_name or "לקוח",
        "loyalty_points": str(int(client.loyalty_points or 0)),
    }
    body = format_template(template, context)

    phone = client.phone.strip().replace("-", "").replace(" ", "")
    if phone.startswith("0"):
        phone = "972" + phone[1:]

    db.add(MessageJob(
        studio_id=ctx.studio_id,
        client_id=client.id,
        channel="whatsapp",
        to_phone=phone,
        body=body,
        scheduled_at=datetime.now(timezone.utc),
        status="pending",
    ))
    db.commit()
    return {"ok": True}
