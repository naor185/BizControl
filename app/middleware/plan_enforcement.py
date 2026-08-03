"""
Plan enforcement middleware.
Checks studio plan validity on every authenticated API request.
Returns 402 if the studio's subscription status doesn't allow access.

Gates on Subscription.status (app/models/subscription.py) — the Generic
Plans Engine's source of truth — not Studio.is_active/plan_expires_at
directly. Those Studio columns are still dual-written by app/core/billing.py
for other code that reads them for display, but are no longer read here.
"""

import json
import time
from typing import Dict, Tuple

from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.security import decode_token
from app.db.session import SessionLocal
from app.models.studio import Studio
from app.models.subscription import Subscription

# Simple in-memory cache: studio_id → (is_ok: bool, expires_at_cache: float)
_CACHE: Dict[str, Tuple[bool, float]] = {}
_CACHE_TTL = 300  # 5 minutes

# Statuses that keep full access. past_due/grace_period are intentionally
# included — a failed renewal charge degrades to a warning, not an instant
# lockout; the grace_period→suspended transition (handled by the expiry
# sweep cron) is what eventually blocks access if nothing is resolved.
_ACCESS_OK_STATUSES = {"trial", "active", "past_due", "grace_period"}

# Prefixes that bypass plan enforcement completely
_BYPASS_PREFIXES = (
    "/health",
    "/uploads",
    "/api/auth",       # login, refresh, 2fa, me
    "/api/admin",      # superadmin — has its own auth
    "/api/portal",     # client portal — phone-only auth
    "/api/pay",        # public payment links
    "/api/join",       # public studio landing
    "/api/s/",         # short links
    "/api/book",       # self-booking public
    "/api/public",     # public landing page + studio join
    "/api/billing/webhook",  # Stripe webhooks (no auth)
)


def _check_studio(studio_id: str) -> str | None:
    """Return None if OK, or an error code string ('STUDIO_SUSPENDED' / 'plan_expired')."""
    now = time.time()
    cached = _CACHE.get(studio_id)
    if cached is not None:
        code, ts = cached
        if now < ts:
            return code  # None means OK

    db = SessionLocal()
    try:
        studio = db.query(Studio).filter(Studio.id == studio_id).first()
        if not studio:
            result = "STUDIO_SUSPENDED"
        else:
            sub = db.query(Subscription).filter(Subscription.studio_id == studio_id).first()
            if sub is not None:
                result = None if sub.status in _ACCESS_OK_STATUSES else "plan_expired"
            else:
                # No subscriptions row yet (shouldn't happen post-migration —
                # every write path creates one) — fall back to the legacy
                # columns rather than blocking a studio outright on a gap.
                result = None if studio.is_active else "STUDIO_SUSPENDED"
        _CACHE[studio_id] = (result, now + _CACHE_TTL)
        return result
    finally:
        db.close()


def invalidate_studio_cache(studio_id: str) -> None:
    """Call this whenever a studio's plan is updated (e.g. after Stripe webhook)."""
    _CACHE.pop(studio_id, None)


class PlanEnforcementMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Skip public / auth / admin routes
        for prefix in _BYPASS_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)

        # Only check requests that carry a Bearer token
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return await call_next(request)

        token = auth_header[len("Bearer "):]
        try:
            payload = decode_token(token)
        except JWTError:
            # Invalid token → let the route's own auth handle it
            return await call_next(request)

        # Superadmins bypass plan checks
        if payload.get("role") == "superadmin":
            return await call_next(request)

        # Special token types (2fa_pending, client_portal) bypass
        token_type = payload.get("type", "access")
        if token_type != "access":
            return await call_next(request)

        studio_id = payload.get("studio_id")
        if not studio_id:
            return await call_next(request)

        error_code = _check_studio(str(studio_id))
        if error_code:
            body = json.dumps({
                "detail": error_code,
                "message": "תוכנית המנוי של הסטודיו פגה. אנא פנה לחידוש."
            })
            return Response(
                content=body,
                status_code=402,
                media_type="application/json",
            )

        return await call_next(request)
