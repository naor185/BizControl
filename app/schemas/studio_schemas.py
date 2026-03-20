from pydantic import BaseModel, EmailStr, Field

class StudioRegisterRequest(BaseModel):
    name: str = Field(..., min_length=2)
    slug: str = Field(..., min_length=2)
    email: EmailStr
    password: str = Field(..., min_length=6)

class StudioRegisterResponse(BaseModel):
    message: str
