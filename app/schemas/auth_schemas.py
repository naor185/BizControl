from pydantic import BaseModel, EmailStr, Field

class LoginRequest(BaseModel):
    studio_slug: str = Field(..., min_length=2)
    email: EmailStr
    password: str = Field(..., min_length=6)

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str
