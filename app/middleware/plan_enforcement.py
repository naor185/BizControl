"""
Plan enforcement middleware.
Checks studio plan validity on every authenticated API request.
Returns 402 if the studio is inactive or its plan has expired.
"""

import json
import time
from datetime import datetime, timezone
from typing import Dict, Tuple

from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.security import decode_token
from app.db.session import SessionLocal
from app.models.studio import Studio

# Simple in-memory cache: studio_id → (is_ok: bool, expires_at_cache: float)
_CACHE: Dict[str, Tuple[bool, float]] = {}
_CACHE_TTL = 300  # 5 minutes

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
        elif not studio.is_active:
            result = "STUDIO_SUSPENDED"
        elif studio.plan_expires_at is not None:
            expires = studio.plan_expires_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            result = None if expires > datetime.now(timezone.utc) else "plan_expired"
        else:
            result = None  # no expiry → unlimited
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
