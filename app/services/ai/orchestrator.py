"""
AI Orchestrator — handles the full chat pipeline:
  1. Security check on user message
  2. Build conversation history
  3. Call Gemini/OpenAI (non-streaming for reliability with tool calls)
  4. Execute tool calls, re-call for final answer
  5. Emit response as SSE (word-by-word for typing feel)
  6. Persist conversation + audit log
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import AsyncGenerator
from uuid import UUID

import logging as _logging

from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from sqlalchemy import select

_logger = _logging.getLogger(__name__)

from app.models.ai_conversation import AIConversation
from app.models.ai_message import AIMessage
from app.models.studio import Studio
from app.services.ai.audit import (
    get_or_create_conversation, log_event, save_message, update_conversation_stats,
)
from app.services.ai.permissions import allowed_tools_for_role, can_use_tool, is_forbidden_message
from app.services.ai.prompts import SECURITY_BLOCKED_RESPONSE, SYSTEM_PROMPT
from app.services.ai.tools import TOOLS_SCHEMA, execute_tool

_MAX_HISTORY = 10
_MAX_TOOL_ROUNDS = 3


def _get_client() -> tuple[AsyncOpenAI, str]:
    """Returns (client, model_name)."""
    groq_key = os.getenv("GROQ_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    _logger.info(
        "AI provider env check — GROQ_API_KEY=%s GEMINI_API_KEY=%s OPENAI_API_KEY=%s",
        "SET" if groq_key else "NOT SET",
        "SET" if gemini_key else "NOT SET",
        "SET" if openai_key else "NOT SET",
    )

    if groq_key:
        _logger.info("AI provider: Groq / llama-3.3-70b-versatile")
        return (
            AsyncOpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1"),
            "llama-3.3-70b-versatile",
        )

    for key in (gemini_key, openai_key):
        if key and key.startswith("AIza"):
            _logger.info("AI provider: Gemini 2.0 Flash (AIza key)")
            return (
                AsyncOpenAI(
                    api_key=key,
                    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                ),
                "gemini-2.0-flash",
            )
    if gemini_key:
        _logger.info("AI provider: Gemini 2.0 Flash (GEMINI_API_KEY)")
        return (
            AsyncOpenAI(
                api_key=gemini_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            ),
            "gemini-2.0-flash",
        )
    if openai_key:
        _logger.info("AI provider: OpenAI gpt-4o-mini")
        return AsyncOpenAI(api_key=openai_key), "gpt-4o-mini"
    raise RuntimeError("לא מוגדר GROQ_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY")


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

    # Validate API key early
    has_key = bool(
        os.getenv("GROQ_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    )
    if not has_key:
        yield f"data: {json.dumps({'type': 'text', 'content': 'לא מוגדר מפתח API. הוסף GROQ_API_KEY או GEMINI_API_KEY ב-Railway Variables.'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # Send conversation ID to client
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
        client, model = _get_client()
    except RuntimeError as e:
        yield f"data: {json.dumps({'type': 'text', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # ── 5. Non-streaming call + tool loop ─────────────────────────────────────
    # Using stream=False for reliability with Gemini tool calls.
    # The final text response is emitted word-by-word to simulate typing.
    full_response = ""
    tools_used: list[str] = []

    try:
        for _round in range(_MAX_TOOL_ROUNDS):
            create_kwargs: dict = {
                "model": model,
                "messages": messages,
                "stream": False,
                "max_tokens": 1024,
                "temperature": 0.4,
            }
            if tools:
                create_kwargs["tools"] = tools
                create_kwargs["tool_choice"] = "auto"

            response = await client.chat.completions.create(**create_kwargs)
            choice = response.choices[0]
            resp_message = choice.message

            # ── No tool calls → final answer ───────────────────────────────
            if not resp_message.tool_calls:
                full_response = resp_message.content or ""
                if full_response:
                    # Emit word-by-word for typing animation
                    words = full_response.split(" ")
                    for word in words:
                        yield f"data: {json.dumps({'type': 'text', 'content': word + ' '})}\n\n"
                break

            # ── Execute tool calls ─────────────────────────────────────────
            assistant_tool_calls = []
            tool_results = []

            for tc in resp_message.tool_calls:
                name = tc.function.name

                if not can_use_tool(user_role, name):
                    log_event(db, "blocked_tool", studio_id, user_id, {"tool": name})
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps({"error": "אין הרשאה להשתמש בכלי זה"}),
                    })
                    continue

                tools_used.append(name)
                log_event(db, "tool_call", studio_id, user_id, {
                    "tool": name,
                    "args": tc.function.arguments[:500],
                })

                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}

                result = execute_tool(name, args, studio_id, db)
                yield f"data: {json.dumps({'type': 'tool', 'name': name})}\n\n"

                assistant_tool_calls.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": name, "arguments": tc.function.arguments or "{}"},
                })
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, ensure_ascii=False),
                })

            messages.append({
                "role": "assistant",
                "content": resp_message.content,
                "tool_calls": assistant_tool_calls,
            })
            messages.extend(tool_results)

    except Exception as e:
        _logger.error("AI chat error (model=%s): %s", model, e, exc_info=True)
        err_msg = str(e)
        if "api_key" in err_msg.lower() or "authentication" in err_msg.lower() or "401" in err_msg:
            user_msg = f"[{model}] שגיאת אימות — מפתח ה-API לא תקין."
        elif "rate" in err_msg.lower() or "429" in err_msg:
            user_msg = f"[{model}] חרגת ממכסת ה-API. נסה שוב בעוד רגע."
        elif "model" in err_msg.lower():
            user_msg = f"[{model}] המודל לא זמין כרגע."
        else:
            user_msg = f"[{model}] שגיאה: {err_msg[:120]}"
        yield f"data: {json.dumps({'type': 'text', 'content': user_msg})}\n\n"
        yield "data: [DONE]\n\n"
        return

    if not full_response:
        fallback = "קיבלתי את הנתונים אך לא הצלחתי לנסח תשובה. נסה לשאול מחדש."
        yield f"data: {json.dumps({'type': 'text', 'content': fallback})}\n\n"
        full_response = fallback

    # ── 6. Persist ────────────────────────────────────────────────────────────
    try:
        save_message(db, conv.id, "user", message)
        save_message(db, conv.id, "assistant", full_response, tools_used=tools_used or None)
        update_conversation_stats(db, conv, added_messages=2, added_tokens=0)
        log_event(db, "message", studio_id, user_id, {
            "question": message[:200],
            "tools": tools_used,
            "chars": len(full_response),
        })
        db.commit()
    except Exception:
        pass

    yield "data: [DONE]\n\n"
