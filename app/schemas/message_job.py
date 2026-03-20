from pydantic import BaseModel
from uuid import UUID
from datetime import datetime

class MessageJobOut(BaseModel):
    id: UUID
    studio_id: UUID
    client_id: UUID | None
    appointment_id: UUID | None
    channel: str
    to_phone: str
    body: str
    scheduled_at: datetime
    status: str
    attempts: int
    last_error: str | None
    sent_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
