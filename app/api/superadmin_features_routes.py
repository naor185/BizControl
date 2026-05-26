"""
Super Admin only — manage feature flags and credentials per studio.
All endpoints require role == superadmin.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.models.studio_feature import StudioFeature, FEATURES
from app.models.studio_credential import StudioCredential
from app.models.webhook_log import WebhookLog
from app.services.credential_service import set_credential, delete_credential, list_credentials_meta

router = APIRouter(prefix="/superadmin/features", tags=["SuperAdmin:Features"])


def _require_superadmin(ctx: AuthContext = Depends(require_studio_ctx)) -> AuthContext:
    raise HTTPException(status_code=403, detail="superadmin only")


def _get_superadmin_ctx(ctx: AuthContext = Depends(require_studio_ctx)) -> AuthContext:
    if getattr(ctx, "role", None) != "superadmin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="superadmin only")
    return ctx


# ── Schemas ────────────────────────────────────────────────────────────────────

class FeatureToggle(BaseModel):
    feature: str
    enabled: bool
    notes: str | None = None


class CredentialIn(BaseModel):
    platform: str
    key_name: str
    value: str
    expires_at: datetime | None = None
    notes: str | None = None


class FeatureOut(BaseModel):
    feature: str
    is_enabled: bool
    enabled_at: str | None
    notes: str | None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/{studio_id}", response_model=list[FeatureOut])
def list_features(
    studio_id: uuid.UUID,
    ctx: AuthContext = Depends(_get_superadmin_ctx),
    db: Session = Depends(get_db),
):
    """Return all features for a studio (enabled + disabled)."""
    rows = db.scalars(
        select(StudioFeature).where(StudioFeature.studio_id == studio_id)
    ).all()
    existing = {r.feature: r for r in rows}

    result = []
    for feat in sorted(FEATURES):
        row = existing.get(feat)
        result.append(FeatureOut(
            feature=feat,
            is_enabled=row.is_enabled if row else False,
            enabled_at=row.enabled_at.isoformat() if row and row.enabled_at else None,
            notes=row.notes if row else None,
        ))
    return result


@router.post("/{studio_id}/toggle")
def toggle_feature(
    studio_id: uuid.UUID,
    payload: FeatureToggle,
    ctx: AuthContext = Depends(_get_superadmin_ctx),
    db: Session = Depends(get_db),
):
    if payload.feature not in FEATURES:
        raise HTTPException(status_code=400, detail=f"Unknown feature: {payload.feature}. Valid: {sorted(FEATURES)}")

    row = db.scalar(
        select(StudioFeature).where(
            StudioFeature.studio_id == studio_id,
            StudioFeature.feature == payload.feature,
        )
    )
    now = datetime.now(timezone.utc)
    if row:
        row.is_enabled = payload.enabled
        row.enabled_by = ctx.user_id if hasattr(ctx, "user_id") else None
        row.enabled_at = now if payload.enabled else None
        row.notes = payload.notes
    else:
        db.add(StudioFeature(
            id=uuid.uuid4(),
            studio_id=studio_id,
            feature=payload.feature,
            is_enabled=payload.enabled,
            enabled_by=ctx.user_id if hasattr(ctx, "user_id") else None,
            enabled_at=now if payload.enabled else None,
            notes=payload.notes,
        ))
    db.commit()
    return {"ok": True, "feature": payload.feature, "enabled": payload.enabled}


@router.post("/{studio_id}/enable-all")
def enable_all_features(
    studio_id: uuid.UUID,
    ctx: AuthContext = Depends(_get_superadmin_ctx),
    db: Session = Depends(get_db),
):
    """Bulk-enable all features for a studio (onboarding shortcut)."""
    now = datetime.now(timezone.utc)
    for feat in FEATURES:
        row = db.scalar(
            select(StudioFeature).where(StudioFeature.studio_id == studio_id, StudioFeature.feature == feat)
        )
        if row:
            row.is_enabled = True
            row.enabled_at = now
        else:
            db.add(StudioFeature(
                id=uuid.uuid4(),
                studio_id=studio_id,
                feature=feat,
                is_enabled=True,
                enabled_at=now,
            ))
    db.commit()
    return {"ok": True, "enabled": sorted(FEATURES)}


# ── Credentials ───────────────────────────────────────────────────────────────

@router.get("/{studio_id}/credentials")
def list_creds(
    studio_id: uuid.UUID,
    ctx: AuthContext = Depends(_get_superadmin_ctx),
    db: Session = Depends(get_db),
):
    """Show credential metadata — NO raw values ever returned."""
    return list_credentials_meta(db, studio_id)


@router.post("/{studio_id}/credentials")
def inject_credential(
    studio_id: uuid.UUID,
    payload: CredentialIn,
    ctx: AuthContext = Depends(_get_superadmin_ctx),
    db: Session = Depends(get_db),
):
    injector_id = getattr(ctx, "user_id", None)
    set_credential(
        db, studio_id,
        platform=payload.platform,
        key_name=payload.key_name,
        value=payload.value,
        injected_by=injector_id,
        expires_at=payload.expires_at,
        notes=payload.notes,
    )
    return {"ok": True, "platform": payload.platform, "key_name": payload.key_name}


@router.delete("/{studio_id}/credentials/{platform}/{key_name}")
def revoke_credential(
    studio_id: uuid.UUID,
    platform: str,
    key_name: str,
    ctx: AuthContext = Depends(_get_superadmin_ctx),
    db: Session = Depends(get_db),
):
    ok = delete_credential(db, studio_id, platform, key_name)
    if not ok:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"ok": True}


# ── Webhook Logs ───────────────────────────────────────────────────────────────

@router.get("/{studio_id}/webhook-logs")
def webhook_logs(
    studio_id: uuid.UUID,
    limit: int = 100,
    ctx: AuthContext = Depends(_get_superadmin_ctx),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(WebhookLog)
        .where(WebhookLog.studio_id == studio_id)
        .order_by(WebhookLog.received_at.desc())
        .limit(min(limit, 500))
    ).all()
    return [
        {
            "id": str(r.id),
            "platform": r.platform,
            "event_type": r.event_type,
            "status": r.status,
            "error": r.error,
            "received_at": r.received_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/webhook-logs/all")
def all_webhook_logs(
    limit: int = 200,
    platform: str | None = None,
    status_filter: str | None = None,
    ctx: AuthContext = Depends(_get_superadmin_ctx),
    db: Session = Depends(get_db),
):
    """Platform-wide webhook log for Super Admin monitoring."""
    q = select(WebhookLog).order_by(WebhookLog.received_at.desc())
    if platform:
        q = q.where(WebhookLog.platform == platform)
    if status_filter:
        q = q.where(WebhookLog.status == status_filter)
    rows = db.scalars(q.limit(min(limit, 1000))).all()
    return [
        {
            "id": str(r.id),
            "studio_id": str(r.studio_id) if r.studio_id else None,
            "platform": r.platform,
            "event_type": r.event_type,
            "status": r.status,
            "error": r.error,
            "received_at": r.received_at.isoformat(),
        }
        for r in rows
    ]
