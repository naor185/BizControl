from __future__ import annotations
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.core.permissions import Perms
from app.schemas.calendar import CalendarViewOut, CalendarArtistOut, CalendarAppointmentOut
from app.crud.calendar import calendar_view

router = APIRouter(prefix="/calendar", tags=["Calendar"])

@router.get("/view", response_model=CalendarViewOut)
def view(
    start: datetime = Query(...),
    end: datetime = Query(...),
    artist_id: UUID | None = Query(default=None),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role == Perms.ARTIST:
        artist_id = ctx.user_id

    artists, appointments = calendar_view(db, ctx.studio_id, start=start, end=end, artist_id=artist_id)

    return {
        "start": start,
        "end": end,
        "artists": [CalendarArtistOut.model_validate(a) for a in artists],
        "appointments": [CalendarAppointmentOut.model_validate(x) for x in appointments],
    }
