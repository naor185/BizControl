"""
Writers: the only place the engine touches BizControl's own tables. They write directly to the
models — not through the API's create functions — on purpose: an import must not trigger welcome
messages, club sign-up messages or any other automation, and must not create charges.

Every write returns what it did, precisely enough for rollback to undo it (or to see that the
record was changed afterwards and leave it alone).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.migration import ExternalRecord, Migration, MigrationRow
from app.models.service import Service

# What rollback compares to decide whether a created record was edited after the import.
CLIENT_FIELDS = ("full_name", "phone", "email", "birth_date", "notes")
SERVICE_FIELDS = ("name", "duration_minutes", "price_cents", "category", "description")


def as_json(v):
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def from_json(field: str, v):
    if v is not None and field == "birth_date":
        return date.fromisoformat(v)
    return v


class TargetGone(Exception):
    pass


def _link(db: Session, m: Migration, row: MigrationRow, local_id: uuid.UUID, created: bool) -> bool:
    """Upsert the (source, external_id) → local record link. True when this call created it."""
    if not row.external_id:
        return False
    link = db.scalar(select(ExternalRecord).where(
        ExternalRecord.studio_id == m.studio_id, ExternalRecord.source == m.source,
        ExternalRecord.entity_type == m.entity_type, ExternalRecord.external_id == row.external_id))
    if link:
        if link.local_id != local_id:
            link.local_id = local_id
            link.migration_id = m.id
            link.created_by_migration = created
        return False
    db.add(ExternalRecord(studio_id=m.studio_id, source=m.source, entity_type=m.entity_type,
                          external_id=row.external_id, local_id=local_id, migration_id=m.id,
                          created_by_migration=created))
    return True


def write_client(db: Session, m: Migration, row: MigrationRow, options: dict) -> tuple[str, uuid.UUID, dict, bool]:
    d = row.data or {}
    if row.decision == "create":
        # Same as a client added by hand (the column default) unless the source says otherwise. In this
        # system False blocks the cancellation notice and the aftercare message (crud/automation.py).
        consent = d.get("marketing_consent")
        c = Client(
            studio_id=m.studio_id, full_name=d["full_name"], phone=d.get("phone"), email=d.get("email"),
            birth_date=from_json("birth_date", d.get("birth_date")), notes=d.get("notes"),
            marketing_consent=True if consent is None else consent,
            is_active=True,
        )
        if d.get("created_at"):
            c.created_at = datetime.fromisoformat(d["created_at"])
        db.add(c)
        db.flush()
        applied = {f: as_json(getattr(c, f)) for f in CLIENT_FIELDS}
        return "created", c.id, applied, _link(db, m, row, c.id, True)

    # merge: fill what the existing client is missing, never overwrite
    c = db.get(Client, row.match_target_id) if row.match_target_id else None
    if c is None or c.studio_id != m.studio_id or not c.is_active:
        raise TargetGone("הלקוח שנמצא ככפילות כבר לא קיים — הרץ שוב את הסריקה")
    changes: dict = {}
    for f in ("phone", "email", "birth_date"):
        new = d.get(f)
        if new and not getattr(c, f):
            changes[f] = {"before": None, "after": new}
            setattr(c, f, from_json(f, new))
    if d.get("notes") and d["notes"] not in (c.notes or ""):
        before = c.notes
        c.notes = (before + "\n\n" if before else "") + f"[{m.code}] {d['notes']}"
        changes["notes"] = {"before": before, "after": c.notes}
    db.flush()
    return ("updated" if changes else "unchanged"), c.id, changes, _link(db, m, row, c.id, False)


def write_service(db: Session, m: Migration, row: MigrationRow, options: dict) -> tuple[str, uuid.UUID, dict, bool]:
    d = row.data or {}
    if row.decision == "create":
        s = Service(
            studio_id=m.studio_id, name=d["name"], duration_minutes=d.get("duration_minutes") or 60,
            price_cents=d.get("price_cents") or 0, category=d.get("category"), description=d.get("description"),
            is_active=bool(d.get("is_active", True)),
        )
        db.add(s)
        db.flush()
        applied = {f: getattr(s, f) for f in SERVICE_FIELDS}
        return "created", s.id, applied, _link(db, m, row, s.id, True)

    s = db.get(Service, row.match_target_id) if row.match_target_id else None
    if s is None or s.studio_id != m.studio_id:
        raise TargetGone("השירות שנמצא ככפילות כבר לא קיים — הרץ שוב את הסריקה")
    changes: dict = {}
    for f in ("category", "description"):
        new = d.get(f)
        if new and not getattr(s, f):
            changes[f] = {"before": None, "after": new}
            setattr(s, f, new)
    db.flush()
    return ("updated" if changes else "unchanged"), s.id, changes, _link(db, m, row, s.id, False)


WRITERS = {"clients": write_client, "services": write_service}
MODELS = {"clients": (Client, CLIENT_FIELDS), "services": (Service, SERVICE_FIELDS)}
