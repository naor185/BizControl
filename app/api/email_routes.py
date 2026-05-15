from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.studio_settings import StudioSettings
from app.utils.email_utils import send_email

router = APIRouter(prefix="/studio/email", tags=["Email"])


class TestEmailRequest(BaseModel):
    to_email: EmailStr


@router.post("/test", response_model=dict)
async def test_email_configuration(
    payload: TestEmailRequest,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")

    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    if not settings.resend_api_key:
        raise HTTPException(status_code=400, detail="לא הוגדר Resend API Key. אנא שמור את המפתח בהגדרות המייל.")

    from_email = settings.resend_from_email or "onboarding@resend.dev"

    html_content = f"""
    <div dir="rtl" style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 12px; overflow: hidden;">
        <div style="background-color: {settings.theme_primary_color or '#0ea5e9'}; padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">חיבור הדואר הצליח! 🎉</h1>
        </div>
        <div style="padding: 30px; background-color: #fafafa;">
            <p style="font-size: 16px;">שלום,</p>
            <p style="font-size: 16px;">אם קיבלת את המייל הזה — החיבור למערכת הדיוור הוגדר בהצלחה!</p>
            <div style="background-color: #fff; padding: 20px; border-radius: 8px; border-right: 4px solid #0ea5e9; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #666;"><strong>כתובת השולח:</strong> {from_email}</p>
                <p style="margin: 5px 0 0 0; font-size: 14px; color: #666;"><strong>ספק:</strong> Resend API</p>
            </div>
            <p style="font-size: 16px;">המערכת מוכנה לשלוח הודעות אוטומטיות ללקוחות שלך.</p>
        </div>
        <div style="background-color: #f1f1f1; padding: 15px; text-align: center; color: #888; font-size: 12px;">
            נשלח אוטומטית ממערכת BizControl
        </div>
    </div>
    """

    try:
        success = await send_email(
            api_key=settings.resend_api_key,
            from_email=from_email,
            to_email=payload.to_email,
            subject="בדיקת חיבור מערכת הדיוור — BizControl",
            html_content=html_content,
        )
        if success:
            return {"message": "Email sent successfully"}
        raise HTTPException(status_code=500, detail="Failed to send email. Check server logs.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"שגיאה בשליחה: {str(e)}")
