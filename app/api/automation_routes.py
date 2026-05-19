from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import os
import json
from datetime import date
from google import genai
from dotenv import load_dotenv

load_dotenv()

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.studio_settings import StudioSettings
from app.schemas.automation import AutomationSettingsOut, AutomationSettingsUpdate

router = APIRouter(prefix="/studio/automation", tags=["Automation"])

import json as _json

def _settings_to_out(settings, studio) -> AutomationSettingsOut:
    out = AutomationSettingsOut.model_validate(settings)
    out.studio_slug = studio.slug if studio else None
    return out

@router.get("", response_model=AutomationSettingsOut)
def get_settings(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    from app.models.studio import Studio
    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")
    studio = db.get(Studio, ctx.studio_id)
    return _settings_to_out(settings, studio)

@router.patch("", response_model=AutomationSettingsOut)
def patch_settings(payload: AutomationSettingsUpdate, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")

    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    data = payload.model_dump(exclude_unset=True)
    # Serialize treatment_types list → JSON string before saving
    if "treatment_types" in data and isinstance(data["treatment_types"], list):
        data["treatment_types"] = _json.dumps(data["treatment_types"], ensure_ascii=False)
    for k, v in data.items():
        setattr(settings, k, v)

    db.commit()
    db.refresh(settings)
    from app.models.studio import Studio
    studio = db.get(Studio, ctx.studio_id)
    return _settings_to_out(settings, studio)

class TriggerWelcomeIn(BaseModel):
    client_id: str

@router.post("/trigger-welcome")
def trigger_welcome(payload: TriggerWelcomeIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Manually trigger club welcome (points + WhatsApp) for an existing client."""
    import traceback
    from uuid import UUID
    from app.models.client import Client
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        client_uuid = UUID(payload.client_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid client_id")
    client = db.get(Client, client_uuid)
    if not client or client.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Client not found")
    try:
        from app.crud.client import _handle_new_club_member
        from app.models.studio_settings import StudioSettings
        settings = db.get(StudioSettings, ctx.studio_id)
        if not settings:
            raise HTTPException(status_code=400, detail="Studio settings not found")
        _handle_new_club_member(db, ctx.studio_id, client)
        db.commit()
        db.refresh(client)
        return {"ok": True, "points": int(client.loyalty_points or 0)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}")


@router.post("/retroactive-welcome")
def retroactive_welcome(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Send welcome message + assign points to ALL active club members who have no sent welcome."""
    from sqlalchemy import select
    from app.models.client import Client
    from app.models.client_points_ledger import ClientPointsLedger
    from app.models.message_job import MessageJob
    from app.crud.client import _handle_new_club_member

    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")

    # Skip only clients whose welcome was actually SENT (status=sent)
    already_sent_subq = (
        select(MessageJob.client_id)
        .where(
            MessageJob.studio_id == ctx.studio_id,
            MessageJob.status == "sent",
            MessageJob.body.ilike("%ברוכים הבאים%"),
        )
    )

    # Skip clients who already have signup bonus points
    already_has_bonus_subq = (
        select(ClientPointsLedger.client_id)
        .where(
            ClientPointsLedger.studio_id == ctx.studio_id,
            ClientPointsLedger.reason == "Club signup bonus",
        )
    )

    # All active clients (club member or not) who have no sent welcome
    all_clients = db.scalars(
        select(Client).where(
            Client.studio_id == ctx.studio_id,
            Client.is_active.is_(True),
            Client.id.not_in(already_sent_subq),
            Client.id.not_in(already_has_bonus_subq),
        )
    ).all()

    # Make sure they're club members before sending
    for c in all_clients:
        if not c.is_club_member:
            c.is_club_member = True
    if all_clients:
        db.flush()

    processed = []
    failed = []
    for client in all_clients:
        try:
            _handle_new_club_member(db, ctx.studio_id, client)
            db.commit()
            processed.append({"id": str(client.id), "name": client.full_name})
        except Exception as e:
            db.rollback()
            failed.append({"client_id": str(client.id), "name": client.full_name, "error": str(e)})

    return {
        "processed": len(processed),
        "failed": len(failed),
        "clients": processed,
        "errors": failed,
    }


class TestWhatsappIn(BaseModel):
    phone: str

@router.post("/test-whatsapp")
def test_whatsapp(payload: TestWhatsappIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    from app.services.message_worker import send_whatsapp_message
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings or not settings.whatsapp_provider:
        raise HTTPException(status_code=400, detail="WhatsApp לא מוגדר — יש להגדיר ספק ופרטי חיבור")
    try:
        send_whatsapp_message(payload.phone, "✅ הודעת בדיקה ממערכת BizControl — החיבור תקין!", settings)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AIGenerateRequest(BaseModel):
    description: str

class AIGenerateResponse(BaseModel):
    theme_primary_color: str
    theme_secondary_color: str
    landing_page_title: str
    landing_page_description: str

@router.post("/ai-generate", response_model=AIGenerateResponse)
def generate_theme_with_ai(payload: AIGenerateRequest, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")

    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    today = date.today()
    # Reset limit if new month
    if not settings.ai_generations_reset_date or settings.ai_generations_reset_date.month != today.month or settings.ai_generations_reset_date.year != today.year:
        settings.ai_generations_count = 0
        settings.ai_generations_reset_date = today

    if settings.ai_generations_count >= 3:
        raise HTTPException(status_code=429, detail="הגעת למכסת ה-AI החודשית שלך (3 בחודש). נסה שוב בחודש הבא או צור קשר לשדרוג התוכנית.")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not set in backend")

    try:
        client = genai.Client(api_key=api_key)
        
        prompt = f"""
        You are an expert web designer and copywriter for luxury boutique studios (like tattoo shops, hair salons, etc.).
        The studio owner has provided the following description of their brand vibe:
        "{payload.description}"
        
        Based on this description, generate a complete branding theme for their customer club landing page containing:
        1. A primary theme color in HEX format (e.g. #000000, #ff0000) that is aesthetically matching their vibe.
        2. A secondary theme/background color in HEX format that complements the primary color and fits their vibe.
        3. A catchy, high-converting landing page title (in Hebrew).
        4. A short, persuasive landing page description explaining why customers should join the club and what they might get (in Hebrew, typically around 2-3 sentences max).
        
        Return the response strictly as valid JSON using the exact following keys:
        {{
            "theme_primary_color": "#HEX",
            "theme_secondary_color": "#HEX",
            "landing_page_title": "string",
            "landing_page_description": "string"
        }}
        """
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        
        # Parse JSON from response
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.endswith("```"):
            text = text[:-3]
            
        result = json.loads(text.strip())

        # Increment counter on success
        settings.ai_generations_count += 1
        db.commit()

        return AIGenerateResponse(**result)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Error: {str(e)}")
