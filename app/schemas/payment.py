from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field
from typing import Optional

class ClientMinimal(BaseModel):
    id: UUID
    full_name: str | None
    is_walk_in: bool

    model_config = {"from_attributes": True}

class ProductItemCreate(BaseModel):
    product_id: UUID
    quantity: int = Field(ge=1)
    price_cents: Optional[int] = None

class PaymentCreate(BaseModel):
    appointment_id: UUID
    client_id: UUID
    amount_cents: int = Field(ge=0)
    currency: str = Field(default="ILS", min_length=3, max_length=3)

    type: str = Field(pattern="^(deposit|payment|refund)$")
    status: str = Field(default="paid", pattern="^(pending|paid|void)$")
    method: str = Field(default="cash", pattern="^(cash|bit|credit|paypal|bank|paybox|installment|other)$")

    points_redeemed: int = Field(default=0, ge=0)

    external_ref: str | None = None
    notes: str | None = None
    
    # Optional list of products sold
    product_items: Optional[list[ProductItemCreate]] = None

class PaymentOut(BaseModel):
    id: UUID
    studio_id: UUID
    appointment_id: UUID
    client_id: UUID
    amount_cents: int
    currency: str
    type: str
    status: str
    method: str
    external_ref: str | None
    notes: str | None
    created_at: datetime
    client: ClientMinimal | None = None

    model_config = {"from_attributes": True}

class AppointmentBalanceOut(BaseModel):
    appointment_id: UUID
    currency: str
    total_paid_cents: int
    total_refund_cents: int
    net_paid_cents: int
