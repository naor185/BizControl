"""
Super Admin view of the migration engine: which connectors exist, their version, whether they are
switched on, how many imports ran on each and how they ended, and the recent imports across all
studios with their errors. No client data and no credentials are ever returned here.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.superadmin_routes import _audit, require_superadmin
from app.connectors.registry import all_manifests, connector_class, disabled_slugs, set_enabled
from app.core.database import get_db
from app.migration.universal import ENTITIES
from app.models.migration import Migration
from app.models.studio import Studio
from app.models.user import User

router = APIRouter(prefix="/admin/migrations", tags=["SuperAdmin"])


@router.get("/overview")
def overview(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    off = disabled_slugs(db)
    stats: dict[str, dict] = {}
    for source, status, n in db.execute(select(Migration.source, Migration.status, func.count()).group_by(Migration.source, Migration.status)).all():
        stats.setdefault(source, {})[status] = n
    last_errors = {}
    for source, error, at in db.execute(select(Migration.source, Migration.error, Migration.updated_at)
                                        .where(Migration.error.isnot(None)).order_by(Migration.updated_at.desc()).limit(50)).all():
        last_errors.setdefault(source, {"error": error, "at": at.isoformat()})

    connectors = []
    for man in all_manifests():
        by_status = stats.get(man.slug, {})
        connectors.append({
            "slug": man.slug, "name": man.name, "version": man.version, "auth_type": man.auth_type,
            "entities": [ENTITIES[e].label for e in man.supported_entities if e in ENTITIES],
            "enabled": man.slug not in off,
            "total": sum(by_status.values()),
            "completed": by_status.get("completed", 0), "partial": by_status.get("partial", 0),
            "failed": by_status.get("failed", 0), "rolled_back": by_status.get("rolled_back", 0),
            "in_progress": sum(by_status.get(s, 0) for s in ("draft", "scanning", "preview", "importing")),
            "last_error": last_errors.get(man.slug),
        })

    recent = db.execute(select(Migration, Studio.name).join(Studio, Studio.id == Migration.studio_id)
                        .order_by(Migration.created_at.desc()).limit(50)).all()
    return {
        "connectors": connectors,
        "recent": [{
            "id": str(m.id), "code": m.code, "studio": studio_name, "source": m.source,
            "source_name": (connector_class(m.source).manifest.name if connector_class(m.source) else m.source),
            "entity": ENTITIES[m.entity_type].label if m.entity_type in ENTITIES else m.entity_type,
            "status": m.status, "rows": (m.settings or {}).get("row_count", 0),
            "result": (m.summary or {}).get("result"), "error": m.error,
            "created_at": m.created_at.isoformat(),
        } for m, studio_name in recent],
    }


class ConnectorToggleIn(BaseModel):
    enabled: bool


@router.patch("/connectors/{slug}")
def toggle_connector(slug: str, body: ConnectorToggleIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    if not connector_class(slug):
        raise HTTPException(status_code=404, detail="Connector not found")
    set_enabled(db, slug, body.enabled)
    _audit(db, admin, "migration_connector_toggle", None, {"slug": slug, "enabled": body.enabled})
    db.commit()
    return {"slug": slug, "enabled": body.enabled}
