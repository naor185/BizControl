"""The business's clients and appointments in Excel — the owner only, with his PIN (app/services/data_export.py)."""
from __future__ import annotations

import base64
import io
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx

router = APIRouter(prefix="/data-export", tags=["Data export"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ExportIn(BaseModel):
    pin: str
    deliver: Literal["download", "email"] = "download"     # e-mail: to the owner's own address — works in the apps too


@router.post("")
def export_business_data(body: ExportIn, request: Request, ctx: AuthContext = Depends(require_studio_ctx),
                         db: Session = Depends(get_db)):
    """The whole client list leaves the system here — so only the owner, only with his PIN (wrong ones lock it like
    every PIN), and the activity log says who and when."""
    from app.api.security_routes import _check_pin, _get_ip, _get_or_none
    from app.models.studio import Studio
    from app.models.user import User
    from app.services import activity_log, data_export

    if ctx.role != "owner":
        raise HTTPException(status_code=403, detail="ייצוא הלקוחות פתוח לבעל העסק בלבד")
    pin = _get_or_none(db, ctx.user_id)
    if pin is None:
        raise HTTPException(status_code=404, detail="קודם מגדירים קוד PIN — בהגדרות › החשבון שלי")
    _check_pin(db, pin, body.pin, ctx.studio_id, ctx.user_id, _get_ip(request))

    data, n_clients, n_appts = data_export.build(db, ctx.studio_id)
    studio = db.get(Studio, ctx.studio_id)
    filename = f"BizControl_{(studio.slug if studio else 'export')}_{datetime.now().strftime('%Y-%m-%d')}.xlsx"
    what = f"{n_clients} לקוחות ו-{n_appts} תורים"

    if body.deliver == "email":
        owner = db.get(User, ctx.user_id)
        if not owner or not owner.email:
            raise HTTPException(status_code=400, detail="לבעל העסק אין כתובת מייל")
        from app.services.email_center import send_email
        sent = send_email(db, to_email=owner.email, subject=f"הלקוחות והתורים של {studio.name if studio else 'העסק'} — קובץ אקסל",
                          html_content=f"<div dir='rtl'>מצורף קובץ אקסל עם {what}, כמו שביקשת.<br>"
                                       f"הקובץ כולל פרטים אישיים של לקוחות — שמרו אותו במקום בטוח.</div>",
                          studio_id=str(ctx.studio_id), template_key="data_export",
                          attachments=[{"filename": filename, "content_base64": base64.b64encode(data).decode()}])
        if not sent:
            raise HTTPException(status_code=502, detail="שליחת המייל נכשלה — נסו את ההורדה מהמחשב")
        activity_log.record(db, ctx, "clients", f"ייצוא לאקסל: {what} — נשלח למייל")
        return {"ok": True, "email": owner.email}

    activity_log.record(db, ctx, "clients", f"ייצוא לאקסל: {what} — הורדה")
    return StreamingResponse(io.BytesIO(data), media_type=XLSX,
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
