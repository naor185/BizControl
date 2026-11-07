"""Rate limits — how often one visitor (and one business's public page) may call an endpoint.

Two ways in, one count of visitors: slowapi's decorator (@limiter.limit — the sign-in and the codes) and
rate_limit(), a dependency for the public forms. The decorator can't wrap an endpoint in a module with postponed
annotations (FastAPI then reads the body as a query parameter — the BizFind reviews' 422, 2026-09-25), so the forms
take their limits as a dependency."""
from __future__ import annotations

import ipaddress

from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from limits import parse_many
from limits.storage import MemoryStorage
from limits.strategies import FixedWindowRateLimiter
from slowapi import Limiter

TOO_MANY = "יותר מדי בקשות — נסו שוב בעוד כמה דקות"


def client_ip(request: Request) -> str | None:
    """The visitor's address. The server stands behind Railway's proxy: request.client is the proxy, the same one for
    every visitor (a limit keyed on it was one limit for everyone — found 2026-11-07), and the proxy adds the visitor's
    address to X-Forwarded-For. Read from the right: what's on the left is whatever the visitor sent, and can be
    forged; the proxies' own internal addresses are skipped."""
    for part in reversed(request.headers.get("x-forwarded-for", "").split(",")):
        try:
            if ipaddress.ip_address(part.strip()).is_global:
                return part.strip()
        except ValueError:
            continue
    return request.client.host if request.client else None


def _visitor(request: Request) -> str:
    return client_ip(request) or "unknown"


limiter = Limiter(key_func=_visitor, default_limits=[])
_window = FixedWindowRateLimiter(MemoryStorage())


def rate_limit(per_visitor: str, per_business: str | None = None):
    """A dependency: rate_limit("10/minute;60/hour", per_business="150/hour"). per_business counts every visitor of
    one business's page together (the path's studio_id or slug) — so many addresses can't flood one business either:
    fake clients in its CRM, its WhatsApp messaging strangers (the owner, 2026-11-07, before the launch)."""
    mine = parse_many(per_visitor)
    theirs = parse_many(per_business) if per_business else []

    def dep(request: Request) -> None:
        route = getattr(request.scope.get("route"), "path", request.url.path)
        ok = all(_window.hit(item, route, "visitor", _visitor(request)) for item in mine)
        business = request.path_params.get("studio_id") or request.path_params.get("slug")
        if ok and business:
            ok = all(_window.hit(item, route, "business", str(business)) for item in theirs)
        if not ok:
            raise HTTPException(status_code=429, detail=TOO_MANY)

    return Depends(dep)


def too_many_requests(request: Request, exc) -> JSONResponse:
    """slowapi's refusal, in the shape of every other error ({"detail": …}) and in the user's language — its own
    was {"error": "Rate limit exceeded: 10 per 1 minute"}, which the screens showed as raw text."""
    from app.core.i18n import lang_of, say
    lang = lang_of(request.headers.get("x-lang"))
    return JSONResponse({"detail": TOO_MANY if lang == "he" else say(TOO_MANY, lang)}, status_code=429)


def reset() -> None:
    """Fresh counters (the tests, before each one)."""
    limiter.reset()
    _window.storage.reset()
