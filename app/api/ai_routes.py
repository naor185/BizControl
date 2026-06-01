"""
AI Assistant API endpoints.

POST /api/ai/chat                — streaming chat (SSE)
GET  /api/ai/history             — conversation list for current user
GET  /api/ai/history/{id}        — messages in a conversation
GET  /api/ai/admin/stats         — superadmin: usage statistics
GET  /api/ai/admin/logs          — superadmin: audit log
"""
from __future__ import annotations

import uuid
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select, func, desc

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.auth_deps import get_current_user
from app.models.ai_audit_log import AIAuditLog
from app.models.ai_conversation import AIConversation
from app.models.ai_message import AIMessage
from app.models.studio import Studio
from app.models.user import User
from app.services.ai.orchestrator import chat_stream
from app.services.ai.prompts import SUGGESTED_QUESTIONS

from app.core.features import require_module
router = APIRouter(prefix="/ai", tags=["AI Assistant"], dependencies=[Depends(require_module("ai_assistant"))])


# ── Env debug (no auth required) ─────────────────────────────────────────────

@router.get("/env-debug")
async def ai_env_debug():
    """Returns which AI env vars are set in the running container."""
    import os
    groq = os.getenv("GROQ_API_KEY", "")
    gemini = os.getenv("GEMINI_API_KEY", "")
    openai = os.getenv("OPENAI_API_KEY", "")
    return {
        "GROQ_API_KEY": f"SET ({groq[:8]}...)" if groq else "NOT SET",
        "GEMINI_API_KEY": f"SET ({gemini[:8]}...)" if gemini else "NOT SET",
        "OPENAI_API_KEY": f"SET ({openai[:8]}...)" if openai else "NOT SET",
    }


# ── Gemini connectivity test (no auth required) ───────────────────────────────

@router.get("/ping")
async def ai_ping():
    """Quick Gemini reachability test — returns model response or error details."""
    import os
    from openai import AsyncOpenAI

    gemini_key = os.getenv("GEMINI_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")

    key = None
    for k in (gemini_key, openai_key):
        if k and k.startswith("AIza"):
            key = k
            break
    if not key:
        key = gemini_key or openai_key

    if not key:
        return {"ok": False, "error": "No API key found", "env_vars": list(os.environ.keys())}

    is_gemini = key.startswith("AIza")
    try:
        client = AsyncOpenAI(
            api_key=key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/" if is_gemini else None,
        )
        response = await client.chat.completions.create(
            model="gemini-2.0-flash" if is_gemini else "gpt-4o-mini",
            messages=[{"role": "user", "content": "Say 'OK' in one word."}],
            max_tokens=10,
        )
        return {
            "ok": True,
            "model": response.model,
            "content": response.choices[0].message.content,
            "key_prefix": key[:8] + "...",
            "using_gemini": is_gemini,
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "key_prefix": key[:8] + "...", "using_gemini": is_gemini}


# ── Schemas ────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    current_page: Optional[str] = None


class ConversationOut(BaseModel):
    id: str
    created_at: str
    message_count: int
    total_tokens: int
    preview: Optional[str] = None


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    tools_used: Optional[list] = None
    created_at: str


class SuggestionsOut(BaseModel):
    suggestions: list[str]


# ── Chat (SSE streaming) ───────────────────────────────────────────────────────

@router.post("/chat")
async def chat(
    body: ChatRequest,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="הודעה ריקה")
    if len(message) > 2000:
        raise HTTPException(status_code=400, detail="ההודעה ארוכה מדי (מקסימום 2000 תווים)")

    conv_id: UUID | None = None
    if body.conversation_id:
        try:
            conv_id = UUID(body.conversation_id)
        except ValueError:
            pass

    generator = chat_stream(
        db=db,
        studio_id=ctx.studio_id,
        user_id=ctx.user_id,
        user_role=ctx.role,
        message=message,
        conversation_id=conv_id,
        current_page=body.current_page or "",
    )

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Suggestions ───────────────────────────────────────────────────────────────

@router.get("/suggestions", response_model=SuggestionsOut)
def get_suggestions(_ctx: AuthContext = Depends(require_studio_ctx)):
    return SuggestionsOut(suggestions=SUGGESTED_QUESTIONS)


# ── Conversation history ───────────────────────────────────────────────────────

@router.get("/history", response_model=list[ConversationOut])
def list_conversations(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    convs = db.scalars(
        select(AIConversation)
        .where(
            AIConversation.studio_id == ctx.studio_id,
            AIConversation.user_id == ctx.user_id,
        )
        .order_by(desc(AIConversation.updated_at))
        .limit(20)
    ).all()

    result = []
    for c in convs:
        first_msg = db.scalar(
            select(AIMessage.content)
            .where(AIMessage.conversation_id == c.id, AIMessage.role == "user")
            .order_by(AIMessage.created_at)
            .limit(1)
        )
        result.append(ConversationOut(
            id=str(c.id),
            created_at=c.created_at.isoformat(),
            message_count=c.message_count,
            total_tokens=c.total_tokens,
            preview=first_msg[:80] if first_msg else None,
        ))

    return result


@router.get("/history/{conversation_id}", response_model=list[MessageOut])
def get_conversation_messages(
    conversation_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    conv = db.get(AIConversation, conversation_id)
    if not conv or conv.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="שיחה לא נמצאה")

    msgs = db.scalars(
        select(AIMessage)
        .where(AIMessage.conversation_id == conversation_id)
        .order_by(AIMessage.created_at)
    ).all()

    return [
        MessageOut(
            id=str(m.id),
            role=m.role,
            content=m.content,
            tools_used=m.tools_used,
            created_at=m.created_at.isoformat(),
        )
        for m in msgs
    ]


# ── SuperAdmin endpoints ───────────────────────────────────────────────────────

def _require_superadmin(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> User:
    if user.role != "superadmin":
        raise HTTPException(status_code=403, detail="SuperAdmin only")
    return user


@router.get("/admin/stats")
def admin_ai_stats(
    _admin: User = Depends(_require_superadmin),
    db: Session = Depends(get_db),
):
    total_conversations = db.scalar(select(func.count(AIConversation.id))) or 0
    total_messages = db.scalar(select(func.count(AIMessage.id))) or 0
    total_tokens = db.scalar(select(func.coalesce(func.sum(AIConversation.total_tokens), 0))) or 0
    blocked_count = db.scalar(
        select(func.count(AIAuditLog.id))
        .where(AIAuditLog.event_type.in_(["blocked", "blocked_tool"]))
    ) or 0
    tool_calls = db.scalar(
        select(func.count(AIAuditLog.id))
        .where(AIAuditLog.event_type == "tool_call")
    ) or 0

    # Active studios
    active_studios = db.scalar(
        select(func.count(func.distinct(AIConversation.studio_id)))
    ) or 0

    return {
        "total_conversations": total_conversations,
        "total_messages": total_messages,
        "total_tokens": total_tokens,
        "estimated_cost_usd": round(total_tokens * 0.00000015, 4),  # gpt-4o-mini rate
        "blocked_attempts": blocked_count,
        "tool_calls": tool_calls,
        "active_studios": active_studios,
    }


@router.get("/admin/logs")
def admin_ai_logs(
    limit: int = 50,
    event_type: Optional[str] = None,
    _admin: User = Depends(_require_superadmin),
    db: Session = Depends(get_db),
):
    q = select(AIAuditLog).order_by(desc(AIAuditLog.created_at)).limit(min(limit, 200))
    if event_type:
        q = q.where(AIAuditLog.event_type == event_type)

    logs = db.scalars(q).all()

    return [
        {
            "id": str(l.id),
            "event_type": l.event_type,
            "studio_id": str(l.studio_id) if l.studio_id else None,
            "user_id": str(l.user_id) if l.user_id else None,
            "details": l.details,
            "created_at": l.created_at.isoformat(),
        }
        for l in logs
    ]


@router.get("/admin/conversations")
def admin_all_conversations(
    limit: int = 50,
    _admin: User = Depends(_require_superadmin),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(
            AIConversation.id,
            AIConversation.studio_id,
            AIConversation.message_count,
            AIConversation.total_tokens,
            AIConversation.created_at,
            Studio.name.label("studio_name"),
        )
        .join(Studio, Studio.id == AIConversation.studio_id, isouter=True)
        .order_by(desc(AIConversation.updated_at))
        .limit(min(limit, 200))
    ).all()

    return [
        {
            "id": str(r.id),
            "studio_id": str(r.studio_id),
            "studio_name": r.studio_name or "—",
            "message_count": r.message_count,
            "total_tokens": r.total_tokens,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
