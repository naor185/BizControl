"""ויקי, stage 3 — she follows what was done and what came of it (the stages the owner approved, 2026-10-16: "she learns
what was done and what happened after"; 2026-10-19: "let's run on it").

A message sent to the clients (a broadcast): how many of its recipients set an appointment after it — up to 30 days —
and for how much. Shown on the broadcasts page, on her card ("5 of them already booked"), and in her next suggestion
of the same kind ("last time 5 clients booked after the message"). And what the owner tells her: a suggestion marked
"לא רלוונטי" twice comes up far less. Nothing is made up — "booked after the message", never "because of it"."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

WINDOW = timedelta(days=30)          # an appointment set this long after the message counts as after it
QUIET_AFTER = 2                      # "not relevant" this many times (in 120 days) — the kind comes up far less


def recipient_ids(db: Session, b) -> set:
    """Who the broadcast went to: its messages carry "bc:<broadcast>:<client>" (since 2026-10-19); an older one — the
    broadcast messages queued in the minutes it was sent."""
    from app.models.message_job import MessageJob
    ids = set(db.scalars(select(MessageJob.client_id).where(
        MessageJob.studio_id == b.studio_id, MessageJob.dedup_key.like(f"bc:{b.id}:%"))).all())
    if not ids and b.scheduled_at is not None:
        ids = set(db.scalars(select(MessageJob.client_id).where(
            MessageJob.studio_id == b.studio_id, MessageJob.reminder_type == "broadcast", MessageJob.dedup_key.is_(None),
            MessageJob.created_at >= b.scheduled_at - timedelta(minutes=1),
            MessageJob.created_at <= b.scheduled_at + timedelta(minutes=10))).all())
    ids.discard(None)
    return ids


def result(db: Session, b, now: datetime | None = None) -> dict:
    """{recipients, booked (clients), appointments, revenue (₪, the appointments' prices), days (since it was sent)}."""
    from app.models.appointment import Appointment
    now = now or datetime.now(timezone.utc)
    ids = recipient_ids(db, b)
    out = {"recipients": len(ids) or (b.sent_count or 0), "booked": 0, "appointments": 0, "revenue": 0.0,
           "days": max((now - b.scheduled_at).days, 0) if b.scheduled_at else 0}
    if not ids:
        return out
    clients, appts, cents = db.execute(select(
        func.count(func.distinct(Appointment.client_id)), func.count(Appointment.id), func.coalesce(func.sum(Appointment.total_price_cents), 0))
        .where(Appointment.studio_id == b.studio_id, Appointment.client_id.in_(ids),
               Appointment.status.in_(("scheduled", "done")),
               Appointment.created_at >= b.scheduled_at, Appointment.created_at < b.scheduled_at + WINDOW,
               Appointment.starts_at >= b.scheduled_at)).one()        # set after it, for after it — not a past one typed in later
    out.update(booked=int(clients or 0), appointments=int(appts or 0), revenue=round(float(cents or 0) / 100, 2))
    return out


def recent(db: Session, studio_id, now: datetime | None = None, days: int = 45) -> list[tuple]:
    """The broadcasts sent in the last `days`, newest first, each with its result."""
    from app.models.broadcast import Broadcast
    now = now or datetime.now(timezone.utc)
    rows = db.scalars(select(Broadcast).where(Broadcast.studio_id == studio_id, Broadcast.status == "sent",
                                              Broadcast.scheduled_at >= now - timedelta(days=days),
                                              Broadcast.scheduled_at <= now)
                      .order_by(Broadcast.scheduled_at.desc()).limit(10)).all()
    return [(b, result(db, b, now)) for b in rows]


def quiet_kinds(db: Session, studio_id, now: datetime | None = None) -> set[str]:
    """The kinds of suggestion the business marked "לא רלוונטי" again and again (key "lapsed:2026-10" → "lapsed")."""
    from app.models.viki_dismissal import VikiDismissal
    now = now or datetime.now(timezone.utc)
    keys = db.scalars(select(VikiDismissal.key).where(VikiDismissal.studio_id == studio_id, VikiDismissal.kind == "not_relevant",
                                                      VikiDismissal.created_at >= now - timedelta(days=120))).all()
    counts: dict[str, int] = {}
    for k in keys:
        kind = k.split(":")[0]
        counts[kind] = counts.get(kind, 0) + 1
    return {k for k, n in counts.items() if n >= QUIET_AFTER}
