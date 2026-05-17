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

@router.get("", response_model=AutomationSettingsOut)
def get_settings(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    from app.models.studio import Studio
    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")
    studio = db.get(Studio, ctx.studio_id)
    out = AutomationSettingsOut.model_validate(settings)
    out.studio_slug = studio.slug if studio else None
    return out

@router.patch("", response_model=AutomationSettingsOut)
def patch_settings(payload: AutomationSettingsUpdate, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")

    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(settings, k, v)

    db.commit()
    db.refresh(settings)
    from app.models.studio import Studio
    studio = db.get(Studio, ctx.studio_id)
    out = AutomationSettingsOut.model_validate(settings)
    out.studio_slug = studio.slug if studio else None
    return out

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
