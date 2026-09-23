"""
Connector Registry: every package under app/connectors/ that exposes CONNECTOR is available.
A superadmin can switch a connector off platform-wide (platform_config key
"migration_connector_disabled:<slug>" = "1"); a switched-off connector is not offered to studios
and cannot start new imports.
"""
from __future__ import annotations

import importlib
import pkgutil

from sqlalchemy import text
from sqlalchemy.orm import Session

import app.connectors as _pkg
from app.connectors.base import BaseConnector, ConnectorManifest

_REGISTRY: dict[str, type[BaseConnector]] | None = None


def _load() -> dict[str, type[BaseConnector]]:
    global _REGISTRY
    if _REGISTRY is None:
        found: dict[str, type[BaseConnector]] = {}
        for mod in pkgutil.iter_modules(_pkg.__path__):
            if not mod.ispkg:
                continue
            module = importlib.import_module(f"app.connectors.{mod.name}")
            cls = getattr(module, "CONNECTOR", None)
            if cls is not None:
                found[cls.manifest.slug] = cls
        _REGISTRY = found
    return _REGISTRY


def all_manifests() -> list[ConnectorManifest]:
    return [cls.manifest for cls in _load().values()]


def connector_class(slug: str) -> type[BaseConnector] | None:
    return _load().get(slug)


def disabled_slugs(db: Session) -> set[str]:
    rows = db.execute(text("SELECT key FROM platform_config WHERE key LIKE 'migration_connector_disabled:%' AND value = '1'")).fetchall()
    return {r[0].split(":", 1)[1] for r in rows}


def set_enabled(db: Session, slug: str, enabled: bool) -> None:
    key = f"migration_connector_disabled:{slug}"
    if enabled:
        db.execute(text("DELETE FROM platform_config WHERE key = :k"), {"k": key})
    else:
        db.execute(text("""
            INSERT INTO platform_config (key, value, updated_at) VALUES (:k, '1', NOW())
            ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW()
        """), {"k": key})
    db.commit()
