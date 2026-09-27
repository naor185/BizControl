"""
Deleting my account from inside the app (Apple: an app where an account can be opened lets it be deleted).
The owner deletes the whole business (closed now, erased after 30 days); anyone else on the team deletes their own
login. The password is asked again; the owner also types the business's name. app/services/account_deletion.py.
"""
from __future__ import annotations

from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth_deps import get_current_user
from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.studio import Studio
from app.models.user import User
from app.services import account_deletion as deletion

router = APIRouter(prefix="/account", tags=["Account"])
_ph = PasswordHasher()


class DeleteIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    business_name: Optional[str] = Field(None, max_length=200)     # the owner types it — deleting the business


@router.post("/delete")
def delete_account(body: DeleteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        _ph.verify(user.password_hash, body.password)
    except VerifyMismatchError:
        raise HTTPException(400, "הסיסמה שגויה")
    if user.role == "superadmin":
        raise HTTPException(400, "חשבון מנהל הפלטפורמה לא נמחק מכאן")
    studio = db.get(Studio, user.studio_id)
    if user.role == "owner":
        if (body.business_name or "").strip() != (studio.name or "").strip():
            raise HTTPException(400, "שם העסק שהוקלד לא תואם")
        erase_on = deletion.request_business_deletion(db, studio)
        # the platform's log (the admin's studios screen) — who asked, and when it is erased
        db.add(AuditLog(admin_id=str(user.id), admin_email=user.email, action="business_deletion_requested",
                        studio_id=str(studio.id), studio_name=studio.name, details={"erase_on": erase_on.isoformat()}))
        db.commit()
        return {"deleted": "business", "erase_on": erase_on.date().isoformat()}
    deletion.delete_my_user(db, user)
    db.commit()
    return {"deleted": "user"}
