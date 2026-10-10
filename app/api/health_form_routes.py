"""
The health declaration (app/services/health_forms.py):
GET    /api/health-form                         — the business's form (the ready-made one until it saves its own)
PUT    /api/health-form                         — save it (owner / manager)
POST   /api/health-form/file                    — attach a file (PDF / image) (owner / manager)
GET    /api/health-form/files/{file_id}         — a file of the form
GET    /api/health-declarations                 — ?client_id= / ?appointment_id=
POST   /api/health-declarations                 — open one for a client (and an appointment)
GET    /api/health-declarations/{id}            — all of it
POST   /api/health-declarations/{id}/client     — the client fills and signs, on the studio's device
POST   /api/health-declarations/{id}/performer  — the one giving the service signs
DELETE /api/health-declarations/{id}            — one nobody signed yet
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.permissions import require_management
from app.models.user import User
from app.services import health_forms

router = APIRouter(tags=["Health declarations"])


def _uuid(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        raise HTTPException(404, f"{what} לא נמצא")


def _declaration(db: Session, ctx: AuthContext, declaration_id: str):
    d = health_forms.get(db, ctx.studio_id, _uuid(declaration_id, "ההצהרה"))
    if d is None:
        raise HTTPException(404, "ההצהרה לא נמצאה")
    return d


@router.get("/health-form")
def get_form(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return health_forms.form(db, ctx.studio_id)


class Question(BaseModel):
    id: Optional[str] = None
    text: str = Field(max_length=500)
    kind: str = "yes_no"


class FormIn(BaseModel):
    title: str = Field(default="", max_length=120)
    intro: str = Field(default="", max_length=5000)
    questions: list[Question] = Field(default_factory=list, max_length=60)
    closing: str = Field(default="", max_length=2000)
    ask_id_number: bool = True
    file_id: Optional[str] = None


@router.put("/health-form")
def save_form(payload: FormIn, ctx: AuthContext = Depends(require_management("עריכת הצהרת הבריאות")),
              db: Session = Depends(get_db)):
    try:
        return health_forms.save_form(db, ctx.studio_id, title=payload.title, intro=payload.intro,
                                      questions=[q.model_dump() for q in payload.questions], closing=payload.closing,
                                      ask_id_number=payload.ask_id_number, file_id=payload.file_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/health-form/file")
async def add_file(file: UploadFile = File(...), ctx: AuthContext = Depends(require_management("עריכת הצהרת הבריאות")),
                   db: Session = Depends(get_db)):
    data = await file.read(health_forms.MAX_FILE_BYTES + 1)
    try:
        return health_forms.add_file(db, ctx.studio_id, file.filename or "file", file.content_type or "", data)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/health-form/files/{file_id}")
def get_file(file_id: str, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    f = health_forms.get_file(db, ctx.studio_id, _uuid(file_id, "הקובץ"))
    if f is None:
        raise HTTPException(404, "הקובץ לא נמצא")
    return Response(f.data, media_type=f.content_type, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/health-declarations")
def list_declarations(client_id: Optional[str] = None, appointment_id: Optional[str] = None,
                      ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if not client_id and not appointment_id:
        raise HTTPException(400, "חסר לקוח או תור")
    return health_forms.listing(db, ctx.studio_id,
                                client_id=_uuid(client_id, "הלקוח") if client_id else None,
                                appointment_id=_uuid(appointment_id, "התור") if appointment_id else None)


class OpenIn(BaseModel):
    client_id: str
    appointment_id: Optional[str] = None


@router.post("/health-declarations")
def open_declaration(payload: OpenIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        d = health_forms.open_declaration(db, ctx.studio_id, _uuid(payload.client_id, "הלקוח"),
                                          _uuid(payload.appointment_id, "התור") if payload.appointment_id else None,
                                          ctx.user_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return health_forms.full(db, d)


@router.get("/health-declarations/{declaration_id}")
def get_declaration(declaration_id: str, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return health_forms.full(db, _declaration(db, ctx, declaration_id))


class ClientSignIn(BaseModel):
    answers: dict = Field(default_factory=dict)
    id_number: Optional[str] = Field(default=None, max_length=20)
    signature: str


@router.post("/health-declarations/{declaration_id}/client")
def client_signs(declaration_id: str, payload: ClientSignIn, request: Request,
                 ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    d = _declaration(db, ctx, declaration_id)
    try:
        health_forms.client_signs(db, d, answers=payload.answers, id_number=payload.id_number, signature=payload.signature,
                                  via="studio", ip=request.client.host if request.client else None,
                                  device=request.headers.get("user-agent"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return health_forms.full(db, d)


class PerformerSignIn(BaseModel):
    signature: str


@router.post("/health-declarations/{declaration_id}/performer")
def performer_signs(declaration_id: str, payload: PerformerSignIn, ctx: AuthContext = Depends(require_studio_ctx),
                    db: Session = Depends(get_db)):
    d = _declaration(db, ctx, declaration_id)
    try:
        health_forms.performer_signs(db, d, db.get(User, ctx.user_id), payload.signature)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return health_forms.full(db, d)


@router.delete("/health-declarations/{declaration_id}")
def cancel_declaration(declaration_id: str, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        health_forms.cancel(db, _declaration(db, ctx, declaration_id))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"deleted": True}
