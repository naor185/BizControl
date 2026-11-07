import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import jwt   # PyJWT — python-jose was left unmaintained with open advisories (the pre-launch review, 2026-11-07)
from fastapi import HTTPException

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = os.getenv("JWT_ALG", "HS256")

_env = os.getenv("ENVIRONMENT", "development").lower()
if _env == "production" and JWT_SECRET == "dev-secret-change-me":
    raise RuntimeError("FATAL: JWT_SECRET env var must be set in production")

# a token that is forged, expired or malformed — what decode_token raises
TokenError = jwt.PyJWTError

ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "10080"))  # 7 days — mobile-friendly
REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "60"))  # 60 days — stay logged in

# Every token says when it was issued (iat, to the microsecond — a whole second would let a login from the same second
# as the new password survive it), so a new password ends the logins from before it (issued_before below)

def create_access_token(data: Dict[str, Any]) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    to_encode.update({"exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES), "iat": now.timestamp(), "type": "access"})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALG)

def create_refresh_token(data: Dict[str, Any]) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    to_encode.update({"exp": now + timedelta(days=REFRESH_TOKEN_DAYS), "iat": now.timestamp(), "type": "refresh", "jti": uuid.uuid4().hex})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALG)

def issued_before(payload: Dict[str, Any], moment: Optional[datetime]) -> bool:
    """A token issued before `moment` — the user's password change (users.password_changed_at, the pre-launch review
    2026-11-07): that login has ended. A token without iat is from before every token had one, so before too."""
    if moment is None:
        return False
    iat = payload.get("iat")
    return iat is None or float(iat) < moment.timestamp()

def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])

def create_set_password_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user_id, "exp": now + timedelta(hours=72), "iat": now.timestamp(), "type": "set_password"},
                      JWT_SECRET, algorithm=JWT_ALG)

def validate_password_strength(password: str) -> None:
    """Raise HTTPException if password is too weak (min 8 chars, letter + digit)."""
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise HTTPException(
            status_code=400,
            detail="הסיסמה חייבת להכיל לפחות 8 תווים, אות אחת וספרה אחת",
        )
