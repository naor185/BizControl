from pydantic import BaseModel
from uuid import UUID
from datetime import datetime

class MessageJobOut(BaseModel):
    id: UUID
    studio_id: UUID
    client_id: UUID | None
    appointment_id: UUID | None
    recipient_user_id: UUID | None
    channel: str
    to_phone: str | None
    body: str
    deep_link: str | None
    scheduled_at: datetime
    status: str
    attempts: int
    last_error: str | None
    sent_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
