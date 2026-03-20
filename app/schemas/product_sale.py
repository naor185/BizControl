import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ProductSaleBase(BaseModel):
    product_id: uuid.UUID
    quantity: int = 1
    unit_price_cents: int
    total_price_cents: int


class ProductSaleCreate(ProductSaleBase):
    payment_id: Optional[uuid.UUID] = None
    user_id: Optional[uuid.UUID] = None


class ProductSaleResponse(ProductSaleBase):
    id: uuid.UUID
    studio_id: uuid.UUID
    payment_id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    created_at: datetime
    
    product_name: Optional[str] = None
    sold_by_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
