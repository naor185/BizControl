from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.schemas.client import ClientCreate, ClientUpdate, ClientOut, ClientProfileOut
from app.crud.client import create_client, get_client, list_clients, update_client, soft_delete_client
from app.models.client_points_ledger import ClientPointsLedger
from app.models.message_job import MessageJob

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

    from app.models.payment import Payment
    from app.models.appointment import Appointment
    from sqlalchemy import func, case

    # Financial totals
    totals = db.execute(
        select(
            func.sum(case((Payment.type != 'refund', Payment.amount_cents), else_=0)).label("paid"),
            func.sum(case((Payment.type == 'refund', Payment.amount_cents), else_=0)).label("refund")
        )
        .where(Payment.client_id == client_id, Payment.studio_id == ctx.studio_id, Payment.status == "paid")
    ).first()
    
    total_paid = int(totals.paid or 0)
    total_refund = int(totals.refund or 0)
    net_paid = total_paid - total_refund

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


@router.get("/club/stats")
def club_stats(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    from sqlalchemy import func
    from datetime import datetime, timezone
    import calendar

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    members = db.scalars(
        select(Client)
        .where(Client.studio_id == ctx.studio_id, Client.is_club_member == True, Client.is_deleted == False)
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
