"""
Rollback: undo exactly what one migration did, and nothing that existed before it.

- A record the migration CREATED is deleted — unless it has been used since (anything in the
  database references it: an appointment, a payment, a message, a club card…) or edited since
  (its fields no longer equal what the import wrote). Those are kept and listed with the reason.
- Fields the migration FILLED on an existing record are put back to their previous value, only
  where the field still holds what the import wrote.
- The (source, external_id) links the migration created are removed.

"Used since" is read from the database's own foreign keys, so a table added later that points at
clients or services is covered automatically.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.migration.engine import MigrationError, _event, counts
from app.migration.writers import MODELS, as_json, from_json
from app.models.migration import ExternalRecord, Migration, MigrationRow

_TABLE = {"clients": "clients", "services": "services"}


def _referenced_ids(db: Session, table: str, ids: list) -> set:
    if not ids:
        return set()
    fks = db.execute(text("""
        SELECT kcu.table_name, kcu.column_name
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = rc.unique_constraint_name AND ccu.constraint_schema = rc.unique_constraint_schema
        WHERE ccu.table_name = :t AND ccu.column_name = 'id' AND kcu.table_schema = 'public'
    """), {"t": table}).all()
    found = set()
    str_ids = [str(i) for i in ids]
    for tname, col in fks:
        q = text(f'SELECT DISTINCT "{col}"::text FROM "{tname}" WHERE "{col}" = ANY(CAST(:ids AS uuid[]))')
        found |= {r[0] for r in db.execute(q, {"ids": str_ids}).all()}
    return found


def rollback(db: Session, m: Migration, user_id) -> dict:
    if m.status not in ("completed", "partial", "failed") or m.started_at is None:
        raise MigrationError("אפשר לבטל רק ייבוא שכבר רץ")
    model, fields = MODELS[m.entity_type]
    rows = db.scalars(select(MigrationRow).where(MigrationRow.migration_id == m.id, MigrationRow.status == "imported")
                      .order_by(MigrationRow.row_number)).all()
    created = [r for r in rows if r.action == "created"]
    referenced = _referenced_ids(db, _TABLE[m.entity_type], [r.local_id for r in created])
    stats = {"deleted": 0, "restored_fields": 0, "kept_used": 0, "kept_edited": 0, "kept_fields": 0}

    for r in created:
        obj = db.get(model, r.local_id)
        if obj is None:
            r.status = "rolled_back"
            continue
        if str(r.local_id) in referenced:
            r.status, r.error = "kept", "לא נמחק: יש לו פעילות במערכת מאז הייבוא (תורים, תשלומים, הודעות וכו׳)"
            stats["kept_used"] += 1
            continue
        if any(as_json(getattr(obj, f)) != (r.applied or {}).get(f) for f in fields):
            r.status, r.error = "kept", "לא נמחק: הפרטים שלו נערכו אחרי הייבוא"
            stats["kept_edited"] += 1
            continue
        # the record is gone, so every link to it goes too (a later re-import may have added one)
        db.execute(delete(ExternalRecord).where(ExternalRecord.studio_id == m.studio_id, ExternalRecord.local_id == r.local_id))
        db.delete(obj)
        r.status = "rolled_back"
        stats["deleted"] += 1

    for r in rows:
        if r.action == "created":
            continue
        obj = db.get(model, r.local_id)
        kept = []
        for f, ch in (r.applied or {}).items():
            if obj is None:
                break
            if as_json(getattr(obj, f)) == ch.get("after"):
                setattr(obj, f, from_json(f, ch.get("before")))
                stats["restored_fields"] += 1
            else:
                kept.append(f)
                stats["kept_fields"] += 1
        if r.link_created:
            db.execute(delete(ExternalRecord).where(
                ExternalRecord.studio_id == m.studio_id, ExternalRecord.source == m.source,
                ExternalRecord.entity_type == m.entity_type, ExternalRecord.external_id == r.external_id,
                ExternalRecord.migration_id == m.id))
        r.status = "rolled_back"
        if kept:
            r.error = "שדות שנערכו אחרי הייבוא לא הוחזרו: " + ", ".join(kept)

    m.status, m.rolled_back_at = "rolled_back", datetime.now(timezone.utc)
    db.flush()   # the session does not autoflush; counts() must see the row statuses set above
    m.summary = {**(m.summary or {}), "rollback": stats, "after_rollback": counts(db, m)}
    _event(db, m, "rolled_back", f"{stats['deleted']} נמחקו, {stats['kept_used'] + stats['kept_edited']} נשארו", user_id=user_id, data=stats)
    db.commit()
    return stats
