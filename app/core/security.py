import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from jose import jwt
from fastapi import HTTPException

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = os.getenv("JWT_ALG", "HS256")

_env = os.getenv("ENVIRONMENT", "development").lower()
if _env == "production" and JWT_SECRET == "dev-secret-change-me":
    raise RuntimeError("FATAL: JWT_SECRET env var must be set in production")

ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "10080"))  # 7 days — mobile-friendly
REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "60"))  # 60 days — stay logged in

def create_access_token(data: Dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALG)

def create_refresh_token(data: Dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)
    to_encode.update({"exp": expire, "type": "refresh", "jti": uuid.uuid4().hex})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALG)

def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])

def create_set_password_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=72)
    return jwt.encode({"sub": user_id, "exp": expire, "type": "set_password"}, JWT_SECRET, algorithm=JWT_ALG)

BUSINESS_UNLOCK_MINUTES = 30

def create_business_unlock_token(user_id: str, studio_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=BUSINESS_UNLOCK_MINUTES)
    return jwt.encode({
        "user_id": user_id,
        "studio_id": studio_id,
        "exp": expire,
        "type": "business_unlock",
    }, JWT_SECRET, algorithm=JWT_ALG)

def validate_password_strength(password: str) -> None:
    """Raise HTTPException if password is too weak (min 8 chars, letter + digit)."""
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise HTTPException(
            status_code=400,
            detail="הסיסמה חייבת להכיל לפחות 8 תווים, אות אחת וספרה אחת",
        )
