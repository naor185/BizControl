"""
Data import (migration) API for the business owner: pick a source, upload/connect, map fields,
review the preview, confirm, follow progress, roll back. Engine: app/migration/engine.py.
Credentials are never returned by any endpoint here.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.connectors.registry import all_manifests, connector_class, disabled_slugs
from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.features import require_module
from app.migration import engine
from app.migration.engine import MigrationError
from app.migration.rollback import rollback as run_rollback
from app.migration.universal import ENTITIES, entity_spec
from app.models.client import Client
from app.models.migration import Migration, MigrationEvent, MigrationRow
from app.models.service import Service

router = APIRouter(prefix="/migrations", tags=["Migration"], dependencies=[Depends(require_module("migration"))])

ALLOWED_ROLES = ("owner", "admin")


def _ctx(ctx: AuthContext = Depends(require_studio_ctx)) -> AuthContext:
    if ctx.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="רק בעל העסק או מנהל מערכת יכולים לייבא נתונים")
    return ctx


def _get(db: Session, ctx: AuthContext, migration_id: UUID) -> Migration:
    m = db.scalar(select(Migration).where(Migration.id == migration_id, Migration.studio_id == ctx.studio_id))
    if not m:
        raise HTTPException(status_code=404, detail="הייבוא לא נמצא")
    return m


def _manifest_out(man) -> dict:
    return {
        "slug": man.slug, "name": man.name, "icon": man.icon, "version": man.version,
        "auth_type": man.auth_type, "description": man.description, "requires_mapping": man.requires_mapping,
        "entities": [{"key": e, "label": ENTITIES[e].label, "importable": ENTITIES[e].importable}
                     for e in man.supported_entities if e in ENTITIES],
        "capabilities": list(man.capabilities), "unsupported": list(man.unsupported),
    }


def _summary_out(db: Session, m: Migration) -> dict:
    cls = connector_class(m.source)
    spec = entity_spec(m.entity_type)
    return {
        "id": str(m.id), "code": m.code, "source": m.source,
        "source_name": cls.manifest.name if cls else m.source,
        "entity_type": m.entity_type, "entity_label": spec.label if spec else m.entity_type,
        "status": m.status, "file_name": m.file_name, "error": m.error,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "started_at": m.started_at.isoformat() if m.started_at else None,
        "completed_at": m.completed_at.isoformat() if m.completed_at else None,
        "rolled_back_at": m.rolled_back_at.isoformat() if m.rolled_back_at else None,
        "row_count": (m.settings or {}).get("row_count", 0),
        "summary": m.summary,
    }


def _detail_out(db: Session, m: Migration) -> dict:
    spec = entity_spec(m.entity_type)
    s = m.settings or {}
    return {
        **_summary_out(db, m),
        "headers": s.get("headers", []),
        "suggestions": s.get("suggestions", []),
        "mapping": s.get("mapping", {}),
        "options": s.get("options", {}),
        "dropped": s.get("dropped", []),
        "source_info": s.get("source_info", {}),
        "fields": [{"key": f.key, "label": f.label, "kind": f.kind, "required": f.required, "multi": f.multi, "help": f.help}
                   for f in spec.fields] if spec else [],
        "counts": engine.counts(db, m),
        "raw_purged": m.raw_purged_at is not None,
    }


# ── sources ──────────────────────────────────────────────────────────────────

@router.get("/connectors")
def list_connectors(ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    off = disabled_slugs(db)
    return [_manifest_out(m) for m in all_manifests() if m.slug not in off]


@router.get("")
def list_migrations(ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    ms = db.scalars(select(Migration).where(Migration.studio_id == ctx.studio_id).order_by(Migration.created_at.desc()).limit(100)).all()
    return [_summary_out(db, m) for m in ms]


@router.post("")
def create_migration(
    source: str = Form(...),
    entity: str = Form(...),
    sheet: str | None = Form(None),
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(_ctx),
    db: Session = Depends(get_db),
):
    cls = connector_class(source)
    if not cls or source in disabled_slugs(db):
        raise HTTPException(status_code=400, detail="מקור הנתונים הזה לא זמין")
    if cls.manifest.auth_type != "file":
        raise HTTPException(status_code=400, detail="המקור הזה לא מתחבר דרך העלאת קובץ")
    from app.connectors.csv_excel import MAX_FILE_BYTES
    content = file.file.read(MAX_FILE_BYTES + 1)   # sync endpoint: parsing runs in the threadpool, not the event loop
    try:
        m = engine.create_migration(db, ctx.studio_id, ctx.user_id, cls(file.filename or "", content, sheet), entity, file.filename)
    except MigrationError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return _detail_out(db, m)


@router.get("/{migration_id}")
def get_migration(migration_id: UUID, ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    return _detail_out(db, _get(db, ctx, migration_id))


class MappingIn(BaseModel):
    mapping: dict[int, str]
    options: dict = {}


@router.put("/{migration_id}/mapping")
def set_mapping(migration_id: UUID, body: MappingIn, background_tasks: BackgroundTasks,
                ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    m = _get(db, ctx, migration_id)
    try:
        engine.set_mapping(db, m, {k: v for k, v in body.mapping.items() if v}, body.options, ctx.user_id)
    except MigrationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    background_tasks.add_task(engine.process, m.id)
    return _detail_out(db, m)


@router.get("/{migration_id}/rows")
def list_rows(
    migration_id: UUID,
    match_status: str | None = Query(None),
    status: str | None = Query(None),
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    ctx: AuthContext = Depends(_ctx),
    db: Session = Depends(get_db),
):
    m = _get(db, ctx, migration_id)
    cond = [MigrationRow.migration_id == m.id]
    if match_status:
        cond.append(MigrationRow.match_status == match_status)
    if status:
        cond.append(MigrationRow.status == status)
    if q:
        like = f"%{q.strip().lower()}%"
        cond.append(or_(MigrationRow.name_key.like(like), MigrationRow.phone_key.like(like), MigrationRow.email_key.like(like)))
    total = db.scalar(select(func.count()).where(*cond)) or 0
    rows = db.scalars(select(MigrationRow).where(*cond).order_by(MigrationRow.row_number)
                      .offset((page - 1) * page_size).limit(page_size)).all()

    target_ids = {r.match_target_id for r in rows if r.match_target_id} | {r.local_id for r in rows if r.local_id}
    targets: dict = {}
    if target_ids:
        if m.entity_type == "clients":
            for c in db.scalars(select(Client).where(Client.id.in_(target_ids), Client.studio_id == ctx.studio_id)).all():
                targets[c.id] = {"id": str(c.id), "name": c.full_name, "phone": c.phone, "email": c.email}
        else:
            for sv in db.scalars(select(Service).where(Service.id.in_(target_ids), Service.studio_id == ctx.studio_id)).all():
                targets[sv.id] = {"id": str(sv.id), "name": sv.name, "duration_minutes": sv.duration_minutes, "price_cents": sv.price_cents}
    return {
        "total": total, "page": page, "page_size": page_size,
        "rows": [{
            "id": str(r.id), "row_number": r.row_number, "data": r.data, "issues": r.issues or [],
            "match_status": r.match_status, "match_reason": engine.reason_text(r.match_reason),
            "decision": r.decision, "status": r.status, "action": r.action, "error": r.error,
            "target": targets.get(r.match_target_id) if r.match_target_id else None,
            "local": targets.get(r.local_id) if r.local_id else None,
        } for r in rows],
    }


class DecisionsIn(BaseModel):
    decision: str
    row_ids: list[UUID] | None = None
    match_status: str | None = None


@router.post("/{migration_id}/decisions")
def set_decisions(migration_id: UUID, body: DecisionsIn, ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    m = _get(db, ctx, migration_id)
    try:
        n = engine.set_decisions(db, m, body.row_ids, body.decision, body.match_status)
    except MigrationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"updated": n, "counts": engine.counts(db, m)}


@router.post("/{migration_id}/confirm")
def confirm(migration_id: UUID, background_tasks: BackgroundTasks, ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    m = _get(db, ctx, migration_id)
    try:
        engine.confirm(db, m, ctx.user_id)
    except MigrationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    background_tasks.add_task(engine.process, m.id)
    return _detail_out(db, m)


@router.post("/{migration_id}/resume")
def resume(migration_id: UUID, background_tasks: BackgroundTasks, ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    m = _get(db, ctx, migration_id)
    try:
        engine.resume(db, m, ctx.user_id)
    except MigrationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    background_tasks.add_task(engine.process, m.id)
    return _detail_out(db, m)


@router.post("/{migration_id}/rollback")
def rollback(migration_id: UUID, ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    m = _get(db, ctx, migration_id)
    try:
        stats = run_rollback(db, m, ctx.user_id)
    except MigrationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"stats": stats, "migration": _detail_out(db, m)}


@router.delete("/{migration_id}", status_code=204)
def discard(migration_id: UUID, ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    m = _get(db, ctx, migration_id)
    if m.started_at is not None:
        raise HTTPException(status_code=400, detail="ייבוא שכבר רץ לא נמחק — אפשר לבטל אותו (גלגול אחורה)")
    if m.status == "scanning":
        raise HTTPException(status_code=400, detail="הסריקה עדיין רצה — נסה שוב בעוד רגע")
    db.delete(m)
    db.commit()


@router.get("/{migration_id}/events")
def events(migration_id: UUID, ctx: AuthContext = Depends(_ctx), db: Session = Depends(get_db)):
    m = _get(db, ctx, migration_id)
    evs = db.scalars(select(MigrationEvent).where(MigrationEvent.migration_id == m.id).order_by(MigrationEvent.created_at)).all()
    return [{"code": e.code, "level": e.level, "message": e.message, "created_at": e.created_at.isoformat()} for e in evs]
