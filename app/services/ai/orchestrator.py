"""
AI Orchestrator — handles the full chat pipeline:
  1. Security check on user message
  2. Build conversation history
  3. Call OpenAI with tools (streaming)
  4. Execute tool calls, re-call OpenAI for final answer
  5. Stream response as SSE
  6. Persist conversation + audit log
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator
from uuid import UUID

from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.ai_conversation import AIConversation
from app.models.ai_message import AIMessage
from app.models.studio import Studio
from app.models.user import User
from app.services.ai.audit import (
    get_or_create_conversation, log_event, save_message, update_conversation_stats,
)
from app.services.ai.permissions import allowed_tools_for_role, is_forbidden_message
from app.services.ai.prompts import SECURITY_BLOCKED_RESPONSE, SYSTEM_PROMPT
from app.services.ai.tools import ARTIST_TOOLS_SCHEMA, TOOLS_SCHEMA, execute_tool

_MODEL = "gemini-2.0-flash"
_MAX_HISTORY = 10  # messages to include in context
_MAX_TOOL_ROUNDS = 3


def _get_client() -> AsyncOpenAI:
    # Gemini via OpenAI-compatible endpoint (free tier: 1500 req/day)
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        return AsyncOpenAI(
            api_key=gemini_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
    # Fallback to OpenAI
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        return AsyncOpenAI(api_key=openai_key)
    raise RuntimeError("לא מוגדר GEMINI_API_KEY או OPENAI_API_KEY")


def _build_system_prompt(studio_name: str, user_role: str, current_page: str) -> str:
    return SYSTEM_PROMPT.format(
        studio_name=studio_name,
        user_role=user_role,
        current_page=current_page or "לא ידוע",
        current_datetime=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M"),
    )


def _tools_for_role(role: str) -> list:
    allowed = allowed_tools_for_role(role)
    if role in ("owner", "admin", "superadmin"):
        return TOOLS_SCHEMA
    return [t for t in TOOLS_SCHEMA if t["function"]["name"] in allowed]


def _load_history(db: Session, conv: AIConversation) -> list[dict]:
    rows = db.scalars(
        select(AIMessage)
        .where(AIMessage.conversation_id == conv.id)
        .order_by(AIMessage.created_at.desc())
        .limit(_MAX_HISTORY)
    ).all()
    return [{"role": r.role, "content": r.content} for r in reversed(rows)]


async def chat_stream(
    db: Session,
    studio_id: UUID,
    user_id: UUID,
    user_role: str,
    message: str,
    conversation_id: UUID | None,
    current_page: str,
) -> AsyncGenerator[str, None]:
    """
    Yields SSE-formatted strings: `data: {...}\n\n`
    Final message: `data: [DONE]\n\n`
    """

    # ── 1. Security check ────────────────────────────────────────────────────
    if is_forbidden_message(message):
        log_event(db, "blocked", studio_id, user_id, {"message": message[:200]})
        db.commit()
        yield f"data: {json.dumps({'type': 'text', 'content': SECURITY_BLOCKED_RESPONSE})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # ── 2. Studio info ────────────────────────────────────────────────────────
    studio = db.get(Studio, studio_id)
    studio_name = studio.name if studio else "הסטודיו"

    # ── 3. Conversation ───────────────────────────────────────────────────────
    conv = get_or_create_conversation(db, studio_id, user_id, conversation_id)
    history = _load_history(db, conv)

    # Validate API key early — fail fast before yielding conversation_id
    has_key = bool(os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY"))
    if not has_key:
        yield f"data: {json.dumps({'type': 'text', 'content': 'לא מוגדר GEMINI_API_KEY ב-Railway Variables. הוסף אותו כדי להפעיל את ויקי.'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # Send conversation ID to client so it can maintain continuity
    yield f"data: {json.dumps({'type': 'conversation_id', 'id': str(conv.id)})}\n\n"

    # ── 4. Build messages ─────────────────────────────────────────────────────
    system_prompt = _build_system_prompt(studio_name, user_role, current_page)
    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        *history,
        {"role": "user", "content": message},
    ]

    tools = _tools_for_role(user_role)
    try:
        client = _get_client()
    except RuntimeError as e:
        yield f"data: {json.dumps({'type': 'text', 'content': f'שגיאה: {e}'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # ── 5. Streaming call + tool loop ─────────────────────────────────────────
    full_response = ""
    tools_used: list[str] = []
    total_tokens = 0

    try:
        for _round in range(_MAX_TOOL_ROUNDS):
            accumulated_text = ""
            tool_calls_raw: dict[int, dict] = {}
            finish_reason = None

            create_kwargs: dict = {
                "model": _MODEL,
                "messages": messages,
                "stream": True,
                "max_tokens": 800,
                "temperature": 0.4,
            }
            if tools:
                create_kwargs["tools"] = tools
                create_kwargs["tool_choice"] = "auto"

            stream = await client.chat.completions.create(**create_kwargs)

            async for chunk in stream:
                choice = chunk.choices[0] if chunk.choices else None
                if not choice:
                    continue

                delta = choice.delta
                finish_reason = choice.finish_reason

                if delta.content:
                    accumulated_text += delta.content
                    yield f"data: {json.dumps({'type': 'text', 'content': delta.content})}\n\n"

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_raw:
                            tool_calls_raw[idx] = {
                                "id": tc.id or str(uuid.uuid4()),
                                "name": tc.function.name if tc.function else "",
                                "args": "",
                            }
                        if tc.id:
                            tool_calls_raw[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            tool_calls_raw[idx]["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            tool_calls_raw[idx]["args"] += tc.function.arguments

            full_response += accumulated_text

            if not tool_calls_raw or finish_reason == "stop":
                break

            # ── Execute tools ──────────────────────────────────────────────
            from app.services.ai.permissions import can_use_tool
            assistant_tool_calls = []
            tool_results = []

            for idx, tc in tool_calls_raw.items():
                name = tc["name"]

                if not can_use_tool(user_role, name):
                    log_event(db, "blocked_tool", studio_id, user_id, {"tool": name})
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps({"error": "אין הרשאה להשתמש בכלי זה"}),
                    })
                    continue

                tools_used.append(name)
                log_event(db, "tool_call", studio_id, user_id, {"tool": name, "args": tc["args"][:500]})

                try:
                    args = json.loads(tc["args"] or "{}")
                except json.JSONDecodeError:
                    args = {}

                result = execute_tool(name, args, studio_id, db)
                yield f"data: {json.dumps({'type': 'tool', 'name': name})}\n\n"

                assistant_tool_calls.append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": name, "arguments": tc["args"] or "{}"},
                })
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result, ensure_ascii=False),
                })

            messages.append({"role": "assistant", "content": accumulated_text or None, "tool_calls": assistant_tool_calls})
            messages.extend(tool_results)

    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"AI chat error: {e}", exc_info=True)
        err_msg = str(e)
        if "api_key" in err_msg.lower() or "authentication" in err_msg.lower():
            user_msg = "שגיאת אימות OpenAI — OPENAI_API_KEY לא תקין."
        elif "rate" in err_msg.lower():
            user_msg = "חרגת ממכסת ה-API. נסה שוב בעוד רגע."
        elif "model" in err_msg.lower():
            user_msg = "המודל לא זמין כרגע. נסה שוב."
        else:
            user_msg = "שגיאה זמנית. נסה שוב."
        yield f"data: {json.dumps({'type': 'text', 'content': user_msg})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # ── 6. Persist ────────────────────────────────────────────────────────────
    try:
        save_message(db, conv.id, "user", message)
        save_message(db, conv.id, "assistant", full_response, tools_used=tools_used or None)
        update_conversation_stats(db, conv, added_messages=2, added_tokens=total_tokens)
        log_event(db, "message", studio_id, user_id, {
            "question": message[:200],
            "tools": tools_used,
            "chars": len(full_response),
        })
        db.commit()
    except Exception:
        pass  # persistence failures must not crash streaming

    yield "data: [DONE]\n\n"
