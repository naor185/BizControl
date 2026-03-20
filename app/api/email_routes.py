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
async def test_smtp_configuration(
    payload: TestEmailRequest,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")

    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    # Ensure all SMTP credentials are set
    if not all([settings.smtp_host, settings.smtp_port, settings.smtp_user, settings.smtp_pass, settings.smtp_from_email]):
        raise HTTPException(status_code=400, detail="Missing SMTP configuration. Please save your email settings first.")

    html_content = f"""
    <div dir="rtl" style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 12px; overflow: hidden;">
        <div style="background-color: {settings.theme_primary_color}; padding: 30px; text-align: center;">
            <h1 style="color: {settings.theme_secondary_color}; margin: 0; font-size: 24px;">חיבור הדואר הצליח! 🎉</h1>
        </div>
        <div style="padding: 30px; background-color: #fafafa;">
            <p style="font-size: 16px;">שלום,</p>
            <p style="font-size: 16px;">אם קיבלת את המייל הזה, זה אומר שהחיבור לשרת ה-SMTP של המערכת הוגדר בהצלחה!</p>
            <br>
            <div style="background-color: #fff; padding: 20px; border-radius: 8px; border-right: 4px solid {settings.theme_primary_color};">
                <p style="margin: 0; font-size: 14px; color: #666;"><strong>כתובת השולח:</strong> {settings.smtp_from_email}</p>
                <p style="margin: 5px 0 0 0; font-size: 14px; color: #666;"><strong>שרת יוצא:</strong> {settings.smtp_host}</p>
            </div>
            <br>
            <p style="font-size: 16px;">כעת המערכת מוכנה לשלוח הודעות אוטומטיות ללקוחות שלך (כמו תזכורות והוראות טיפול).</p>
        </div>
        <div style="background-color: #f1f1f1; padding: 15px; text-align: center; color: #888; font-size: 12px;">
            נשלח אוטומטית ממערכת BizControl
        </div>
    </div>
    """

    try:
        success = await send_email(
            host=settings.smtp_host,
            port=settings.smtp_port,
            user=settings.smtp_user,
            password=settings.smtp_pass,
            from_email=settings.smtp_from_email,
            to_email=payload.to_email,
            subject="בדיקת חיבור מערכת הדיוור - BizControl",
            html_content=html_content
        )
        if success:
            return {"message": "Email sent successfully"}
        raise HTTPException(status_code=500, detail="Failed to send email. Check server logs.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"שגיאה בהתחברות לשרת או בשליחה: {str(e)}")
