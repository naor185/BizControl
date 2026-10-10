"""
The AI provider — Groq / Gemini / OpenAI, told apart by the API key's prefix whichever variable holds it
(GROQ_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY). Shared by lead tagging (auto_tag_service) and call
analysis (call_ai). The ויקי chat assistant that first used it was removed (owner, 2026-10-10).
"""
from __future__ import annotations

import json
import logging
import os

from openai import AsyncOpenAI

log = logging.getLogger(__name__)


def provider_client() -> tuple[AsyncOpenAI, str]:
    """(client, model). Groq (gsk_) → Gemini (AIza) → OpenAI. RuntimeError when no key is set."""
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    for key in (groq_key, openai_key, gemini_key):
        if key and key.startswith("gsk_"):
            return AsyncOpenAI(api_key=key, base_url="https://api.groq.com/openai/v1"), "llama-3.3-70b-versatile"
    for key in (gemini_key, openai_key):
        if key and key.startswith("AIza"):
            return (AsyncOpenAI(api_key=key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/"),
                    "gemini-2.0-flash")
    if openai_key:
        return AsyncOpenAI(api_key=openai_key), "gpt-4o-mini"
    raise RuntimeError("לא מוגדר GROQ_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY")


def complete_json(prompt: str, max_tokens: int = 600) -> dict | None:
    """One synchronous JSON answer from the provider. None when none is configured or the call fails."""
    try:
        client, model = provider_client()
    except RuntimeError:
        return None
    try:
        import openai
        sync_client = openai.OpenAI(api_key=client.api_key, base_url=str(client.base_url))
        resp = sync_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        return json.loads(resp.choices[0].message.content or "{}")
    except Exception as e:
        log.warning("[ai] json completion failed: %s", e)
        return None
