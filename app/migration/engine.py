"""
Universal Import Engine.

    upload/connect → DISCOVER (columns, suggested mapping)          status draft
    mapping set    → NORMALIZE + VALIDATE + MATCH, row by row       status scanning
                   → PREVIEW: counts + a decision per row           status preview   (nothing written yet)
    confirm        → IMPORT in batches, dependency order            status importing
                   → VERIFY + summary                               status completed | partial | failed
    rollback       → undo what this migration created or filled     status rolled_back

Everything is persisted in migration_rows, so work is resumable: scanning and importing advance in
small batches (a batch = one transaction holding the migration's row lock), triggered right after the
request and by a scheduler tick; a restart mid-import simply continues from the rows still pending.
Re-running an import is idempotent through external_records (studio, source, entity, external_id).
"""
from __future__ import annotations

import hashlib
import logging
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, insert, select, text, update
from sqlalchemy.orm import Session

from app.connectors.base import BaseConnector, ConnectorError, SourceTable
from app.migration.mapping import suggest_mapping, validate_mapping
from app.migration.matcher import INVALID, REASONS, ClientMatcher, Match, ServiceMatcher, default_decision
from app.migration.normalize import NORMALIZERS, name_key
from app.migration.sensitive import sensitive_columns
from app.migration.universal import entity_spec
from app.migration.writers import WRITERS
from app.models.migration import Migration, MigrationEvent, MigrationRow

log = logging.getLogger("bizcontrol.migration")

DEFAULT_OPTIONS = {
    "existing_action": "fill_empty",        # fill_empty | skip
    "date_order": None,                     # DMY | MDY | YMD | None (auto)
}
SCAN_BATCH = 1000
IMPORT_BATCH = 200
RAW_RETENTION_DAYS = 30
DECISIONS = ("create", "merge", "skip")


class MigrationError(Exception):
    """Shown to the business owner as-is."""


# ── helpers ───────────────────────────────────────────────────────────────────

def _jsonable(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _event(db: Session, m: Migration, code: str, message: str = "", level: str = "info",
           user_id=None, data: dict | None = None) -> None:
    db.add(MigrationEvent(migration_id=m.id, studio_id=m.studio_id, user_id=user_id, level=level,
                          code=code, message=message, data=data))


def _new_code(db: Session) -> str:
    n = db.execute(text("SELECT nextval('migration_code_seq')")).scalar()
    return f"MIG-{datetime.now(timezone.utc).year}-{n:05d}"


def _fingerprint(entity: str, data: dict) -> str | None:
    """Stable id for a source row that has no id of its own, so re-importing the same file is idempotent."""
    if entity == "clients":
        basis = "|".join([data.get("phone") or "", data.get("email") or "", name_key(data.get("full_name")) or ""])
    else:
        basis = name_key(data.get("name")) or ""
    return "fp:" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:24] if basis.strip("|") else None


# ── 1. create from a source ──────────────────────────────────────────────────

def create_migration(db: Session, studio_id, user_id, connector: BaseConnector, entity: str,
                     file_name: str | None = None) -> Migration:
    spec = entity_spec(entity)
    if not spec or not spec.importable:
        raise MigrationError("אי אפשר לייבא את סוג הנתונים הזה עדיין")
    if entity not in connector.manifest.supported_entities:
        raise MigrationError(f"{connector.manifest.name} לא מספק {spec.label}")
    try:
        table: SourceTable = connector.read(entity)
    except ConnectorError as e:
        raise MigrationError(str(e))

    # Card data never gets stored, not even in staging.
    dropped = sensitive_columns(table.headers, table.rows)
    keep = [i for i in range(len(table.headers)) if i not in dropped]
    headers = [table.headers[i] for i in keep]
    rows = [[_jsonable(r[i]) for i in keep] for r in table.rows]
    if not headers:
        raise MigrationError("לא נשארו בקובץ עמודות לייבוא")

    columns = [[r[i] for r in rows if i < len(r) and r[i] not in (None, "")][:50] for i in range(len(headers))]
    suggestions = suggest_mapping(spec, headers, columns)
    options = dict(DEFAULT_OPTIONS)
    orders = [c.get("date_order") for c in suggestions if c.get("target") and "date_order" in c]
    if orders and all(o for o in orders) and len(set(orders)) == 1:
        options["date_order"] = orders[0]

    m = Migration(
        studio_id=studio_id, code=_new_code(db), source=connector.manifest.slug,
        connector_version=connector.manifest.version, entity_type=entity, status="draft",
        created_by=user_id, file_name=(file_name or "")[:255] or None,
        settings={
            "headers": headers,
            "suggestions": suggestions,
            "mapping": {str(c["index"]): c["target"] for c in suggestions if c.get("target")},
            "options": options,
            "dropped": [{"column": table.headers[i], "reason": why} for i, why in dropped.items()],
            "source_info": {k: _jsonable(v) if not isinstance(v, list) else v for k, v in table.info.items()},
            "row_count": len(rows),
        },
    )
    db.add(m)
    db.flush()
    for start in range(0, len(rows), 2000):
        db.execute(insert(MigrationRow), [
            {"id": uuid.uuid4(), "migration_id": m.id, "studio_id": studio_id, "row_number": start + i + 2,
             "raw": row, "scanned": False, "status": "pending", "link_created": False}
            for i, row in enumerate(rows[start:start + 2000])
        ])
    _event(db, m, "created", f"{len(rows)} שורות, {len(headers)} עמודות", user_id=user_id,
           data={"dropped_columns": [d["column"] for d in m.settings["dropped"]]})
    if dropped:
        _event(db, m, "sensitive_dropped", "עמודות עם פרטי כרטיס אשראי לא נשמרו", level="warning",
               data={"columns": [table.headers[i] for i in dropped]})
    db.commit()
    return m


# ── 2. mapping → scan ────────────────────────────────────────────────────────

def set_mapping(db: Session, m: Migration, mapping: dict[int, str], options: dict, user_id) -> None:
    if m.status not in ("draft", "preview", "failed") or m.started_at is not None:
        raise MigrationError("אי אפשר לשנות את המיפוי בשלב הזה")
    spec = entity_spec(m.entity_type)
    errors = validate_mapping(spec, mapping, len(m.settings["headers"]))
    if errors:
        raise MigrationError(" · ".join(errors))
    opts = dict(m.settings.get("options") or DEFAULT_OPTIONS)
    if options.get("existing_action") in ("fill_empty", "skip"):
        opts["existing_action"] = options["existing_action"]
    if "date_order" in options and options["date_order"] in ("DMY", "MDY", "YMD", None):
        opts["date_order"] = options["date_order"]
    m.settings = {**m.settings, "mapping": {str(k): v for k, v in mapping.items()}, "options": opts}
    db.execute(update(MigrationRow).where(MigrationRow.migration_id == m.id).values(
        scanned=False, data=None, issues=None, match_status=None, match_target_id=None, match_reason=None,
        decision=None, status="pending", external_id=None, phone_key=None, email_key=None, name_key=None))
    m.status, m.error, m.summary = "scanning", None, None
    _event(db, m, "mapping_set", "", user_id=user_id, data={"mapping": m.settings["mapping"], "options": opts})
    db.commit()


def _scan_step(db: Session, m: Migration) -> bool:
    rows = db.scalars(select(MigrationRow).where(MigrationRow.migration_id == m.id, MigrationRow.scanned == False)  # noqa: E712
                      .order_by(MigrationRow.row_number).limit(SCAN_BATCH)).all()
    if rows:
        headers = m.settings["headers"]
        mapping = {int(k): v for k, v in m.settings["mapping"].items()}
        opts = m.settings.get("options") or DEFAULT_OPTIONS
        normalizer = NORMALIZERS[m.entity_type]
        for r in rows:
            values: dict[str, list] = {}
            for idx, target in mapping.items():
                v = r.raw[idx] if r.raw and idx < len(r.raw) else None
                values.setdefault(target, []).append((headers[idx], v))
            data, issues = normalizer(values, opts)
            r.data, r.issues, r.scanned = data, issues, True
            r.external_id = data.get("external_id") or _fingerprint(m.entity_type, data)
            if m.entity_type == "clients":
                r.phone_key, r.email_key, r.name_key = data.get("phone"), data.get("email"), name_key(data.get("full_name"))
            else:
                r.name_key = name_key(data.get("name"))
        m.heartbeat_at = datetime.now(timezone.utc)
        db.commit()
        return True
    _match_all(db, m)
    m.status = "preview"
    m.heartbeat_at = datetime.now(timezone.utc)
    _event(db, m, "scanned", "", data=counts(db, m))
    db.commit()
    return True


def _match_all(db: Session, m: Migration) -> None:
    opts = m.settings.get("options") or DEFAULT_OPTIONS
    matcher = ClientMatcher(db, m.studio_id, m.source) if m.entity_type == "clients" else ServiceMatcher(db, m.studio_id, m.source)
    offset = 0
    while True:
        rows = db.scalars(select(MigrationRow).where(MigrationRow.migration_id == m.id)
                          .order_by(MigrationRow.row_number).offset(offset).limit(2000)).all()
        if not rows:
            break
        for r in rows:
            if any(i.get("level") == "error" for i in (r.issues or [])):
                res = Match(INVALID, None, "invalid")
            elif m.entity_type == "clients":
                res = matcher.match(r.row_number, r.external_id, r.phone_key, r.email_key, r.name_key)
            else:
                res = matcher.match(r.row_number, r.external_id, r.name_key)
            r.match_status, r.match_target_id = res.status, res.target_id
            r.match_reason = f"{res.reason}:{res.ref_row}" if res.ref_row else res.reason
            r.decision = default_decision(res.status, opts.get("existing_action", "fill_empty"))
        db.flush()
        offset += len(rows)


# ── 3. preview decisions ─────────────────────────────────────────────────────

def set_decisions(db: Session, m: Migration, row_ids: list[uuid.UUID] | None, decision: str,
                  match_status: str | None = None) -> int:
    """Decide for specific rows, or for every row with a given match status."""
    if m.status != "preview":
        raise MigrationError("אפשר לשנות החלטות רק בתצוגה המקדימה")
    if decision not in DECISIONS:
        raise MigrationError("החלטה לא מוכרת")
    q = update(MigrationRow).where(MigrationRow.migration_id == m.id, MigrationRow.match_status != INVALID)
    if row_ids is not None:
        q = q.where(MigrationRow.id.in_(row_ids))
    elif match_status:
        q = q.where(MigrationRow.match_status == match_status)
    else:
        raise MigrationError("לא נבחרו שורות")
    if decision == "merge":
        q = q.where(MigrationRow.match_target_id.isnot(None))   # nothing to merge into otherwise
    n = db.execute(q.values(decision=decision)).rowcount
    db.commit()
    return n


# ── 4. import ────────────────────────────────────────────────────────────────

def confirm(db: Session, m: Migration, user_id) -> None:
    if m.status != "preview":
        raise MigrationError("אפשר לאשר ייבוא רק אחרי התצוגה המקדימה")
    to_import = db.scalar(select(func.count()).where(
        MigrationRow.migration_id == m.id, MigrationRow.decision.in_(("create", "merge"))))
    if not to_import:
        raise MigrationError("אין שורות לייבוא — כל השורות מסומנות לדילוג")
    db.execute(update(MigrationRow).where(
        MigrationRow.migration_id == m.id,
        (MigrationRow.decision.is_(None)) | (MigrationRow.decision == "skip")).values(status="skipped"))
    m.status, m.started_at, m.error = "importing", datetime.now(timezone.utc), None
    _event(db, m, "confirmed", f"{to_import} שורות לייבוא", user_id=user_id)
    db.commit()


def _import_step(db: Session, m: Migration) -> bool:
    rows = db.scalars(select(MigrationRow).where(MigrationRow.migration_id == m.id, MigrationRow.status == "pending")
                      .order_by(MigrationRow.row_number).limit(IMPORT_BATCH)).all()
    if not rows:
        return _finish(db, m)
    writer = WRITERS[m.entity_type]
    opts = m.settings.get("options") or DEFAULT_OPTIONS
    for r in rows:
        try:
            with db.begin_nested():
                action, local_id, applied, link_created = writer(db, m, r, opts)
            r.status, r.action, r.local_id, r.applied, r.link_created, r.error = "imported", action, local_id, applied, link_created, None
        except Exception as e:  # one bad row never stops the import
            r.status, r.error = "failed", str(e)[:500]
            log.warning("migration %s row %s failed: %s", m.code, r.row_number, e)
    m.heartbeat_at = datetime.now(timezone.utc)
    db.commit()
    return True


def _finish(db: Session, m: Migration) -> bool:
    c = counts(db, m)
    failed = c["result"].get("failed", 0)
    m.status = "partial" if failed else "completed"
    m.completed_at = datetime.now(timezone.utc)
    m.summary = c
    _event(db, m, "finished", f"{c['result'].get('created', 0)} נוצרו, {c['result'].get('updated', 0)} עודכנו, {failed} נכשלו",
           level="warning" if failed else "info", data=c["result"])
    db.commit()
    return False


def resume(db: Session, m: Migration, user_id) -> None:
    """A failed run continues from where it stopped."""
    if m.status != "failed":
        raise MigrationError("אפשר להמשיך רק ייבוא שנעצר")
    pending_scan = db.scalar(select(func.count()).where(MigrationRow.migration_id == m.id, MigrationRow.scanned == False))  # noqa: E712
    m.status = "importing" if m.started_at else ("scanning" if pending_scan or not m.summary else "preview")
    m.error = None
    _event(db, m, "resumed", "", user_id=user_id)
    db.commit()


# ── runner ───────────────────────────────────────────────────────────────────

def _step(migration_id) -> bool:
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        m = db.execute(select(Migration).where(Migration.id == migration_id).with_for_update(skip_locked=True)).scalar_one_or_none()
        if m is None:
            return False          # another worker has it right now
        if m.status == "scanning":
            return _scan_step(db, m)
        if m.status == "importing":
            return _import_step(db, m)
        return False
    except Exception as e:
        db.rollback()
        log.exception("migration %s step failed", migration_id)
        m = db.get(Migration, migration_id)
        if m is not None:
            m.status, m.error = "failed", f"שגיאה פנימית: {str(e)[:300]}"
            _event(db, m, "failed", m.error, level="error")
            db.commit()
        return False
    finally:
        db.close()


def process(migration_id, budget_seconds: float = 600.0) -> None:
    deadline = time.monotonic() + budget_seconds
    while time.monotonic() < deadline and _step(migration_id):
        pass


def tick() -> None:
    """Scheduler: advance every migration that is mid-scan or mid-import (resume after a restart)."""
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        ids = [r[0] for r in db.execute(select(Migration.id).where(Migration.status.in_(("scanning", "importing")))).all()]
    finally:
        db.close()
    for mid in ids:
        process(mid, budget_seconds=10.0)


def purge_old_raw(db: Session) -> int:
    """Raw source rows are kept 30 days after the import ends, then deleted (rollback keeps working).
    Imports abandoned before they wrote anything are deleted entirely after 30 days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=RAW_RETENTION_DAYS)
    ended = [r[0] for r in db.execute(select(Migration.id).where(
        Migration.status.in_(("completed", "partial", "rolled_back")), Migration.raw_purged_at.is_(None),
        func.coalesce(Migration.rolled_back_at, Migration.completed_at) < cutoff)).all()]
    for mid in ended:
        db.execute(update(MigrationRow).where(MigrationRow.migration_id == mid).values(raw=None, data=None))
        db.execute(update(Migration).where(Migration.id == mid).values(raw_purged_at=datetime.now(timezone.utc)))
    abandoned = db.execute(text("""
        DELETE FROM migrations WHERE status IN ('draft', 'preview') AND started_at IS NULL AND updated_at < :cutoff
    """), {"cutoff": cutoff}).rowcount
    db.commit()
    return len(ended) + (abandoned or 0)


# ── reading ──────────────────────────────────────────────────────────────────

def counts(db: Session, m: Migration) -> dict:
    total = db.scalar(select(func.count()).where(MigrationRow.migration_id == m.id)) or 0
    scanned = db.scalar(select(func.count()).where(MigrationRow.migration_id == m.id, MigrationRow.scanned == True)) or 0  # noqa: E712
    match = dict(db.execute(select(MigrationRow.match_status, func.count()).where(
        MigrationRow.migration_id == m.id, MigrationRow.match_status.isnot(None)).group_by(MigrationRow.match_status)).all())
    decision = dict(db.execute(select(MigrationRow.decision, func.count()).where(
        MigrationRow.migration_id == m.id, MigrationRow.decision.isnot(None)).group_by(MigrationRow.decision)).all())
    result: dict[str, int] = {}
    for status, action, n in db.execute(select(MigrationRow.status, MigrationRow.action, func.count()).where(
            MigrationRow.migration_id == m.id).group_by(MigrationRow.status, MigrationRow.action)).all():
        key = action if status == "imported" and action else status
        result[key] = result.get(key, 0) + n
    warnings = db.scalar(select(func.count()).where(
        MigrationRow.migration_id == m.id, MigrationRow.issues.contains([{"level": "warning"}]))) or 0
    return {"total": total, "scanned": scanned, "match": match, "decision": decision, "result": result, "warnings": warnings}


def reason_text(reason: str | None) -> str | None:
    if not reason:
        return None
    code, _, ref = reason.partition(":")
    base = REASONS.get(code, code)
    return f"{base} (שורה {ref})" if ref else base
