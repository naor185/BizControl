"""
AI permission layer — blocks forbidden topics and enforces role-based tool access.
"""
from __future__ import annotations

import re
from uuid import UUID

# Keywords that should never be answered — security-sensitive topics
_FORBIDDEN_PATTERNS = [
    r"\benv\b", r"environment.?variable", r"api.?key", r"\bsecret\b", r"\bjwt\b",
    r"jwt.?secret", r"database.?url", r"db.?url", r"\bredis\b", r"smtp",
    r"private.?key", r"certificate", r"service.?account", r"openai.?key",
    r"apple.?cert", r"wwdr", r"resend.?key", r"sendgrid", r"passphrase",
    r"raw.?sql", r"drop.?table", r"select.?\*", r"union.?select",
    r"\.env", r"railway\.app.*secret", r"render\.com.*secret",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in _FORBIDDEN_PATTERNS]

# Tools accessible per role
_ROLE_TOOLS: dict[str, set[str]] = {
    "artist": {
        "get_my_today_appointments",
        "get_system_help",
    },
    "staff": {
        "get_my_today_appointments",
        "get_system_help",
    },
    "admin": {
        "get_today_appointments",
        "get_monthly_revenue",
        "search_client",
        "get_dashboard_stats",
        "get_wallet_status",
        "get_inactive_clients",
        "get_top_artists",
        "get_system_help",
    },
    "owner": {
        "get_today_appointments",
        "get_monthly_revenue",
        "search_client",
        "get_dashboard_stats",
        "get_wallet_status",
        "get_inactive_clients",
        "get_top_artists",
        "get_system_help",
    },
    "superadmin": {
        "get_today_appointments",
        "get_monthly_revenue",
        "search_client",
        "get_dashboard_stats",
        "get_wallet_status",
        "get_inactive_clients",
        "get_top_artists",
        "get_system_help",
    },
}


def is_forbidden_message(text: str) -> bool:
    """Return True if the message contains security-sensitive content."""
    for pattern in _COMPILED:
        if pattern.search(text):
            return True
    return False


def allowed_tools_for_role(role: str) -> set[str]:
    """Return the set of tool names this role may call."""
    return _ROLE_TOOLS.get(role, _ROLE_TOOLS["artist"])


def can_use_tool(role: str, tool_name: str) -> bool:
    return tool_name in allowed_tools_for_role(role)
