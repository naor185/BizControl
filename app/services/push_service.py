from __future__ import annotations

import json
import logging
import os
import time
from uuid import UUID

import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device_token import DeviceToken

log = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"]
_cached_token: str | None = None
_cached_token_expiry: float = 0.0


def _get_fcm_access_token() -> str | None:
    global _cached_token, _cached_token_expiry
    if _cached_token and time.time() < _cached_token_expiry - 60:
        return _cached_token

    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not raw:
        log.warning("FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications disabled")
        return None

    credentials = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=_SCOPES)
    credentials.refresh(GoogleAuthRequest())
    _cached_token = credentials.token
    _cached_token_expiry = credentials.expiry.timestamp() if credentials.expiry else time.time() + 3000
    return _cached_token


def send_push_to_user(db: Session, user_id: UUID, title: str, body: str, deep_link: str | None = None) -> int:
    """Sends a push notification to every active device registered for user_id.
    Returns the number of devices it was successfully delivered to."""
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    access_token = _get_fcm_access_token()
    if not project_id or not access_token:
        log.warning("Push not configured (FIREBASE_PROJECT_ID/FIREBASE_SERVICE_ACCOUNT_JSON missing)")
        return 0

    tokens = db.execute(
        select(DeviceToken).where(DeviceToken.user_id == user_id, DeviceToken.is_active == True)
    ).scalars().all()
    if not tokens:
        return 0

    url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    sent = 0
    for dt in tokens:
        payload = {
            "message": {
                "token": dt.token,
                "notification": {"title": title, "body": body},
                "data": {"deep_link": deep_link or ""},
                "apns": {"payload": {"aps": {"sound": "default"}}},
            }
        }
        try:
            resp = httpx.post(url, headers=headers, json=payload, timeout=10)
            if resp.status_code == 200:
                sent += 1
            elif resp.status_code in (404, 400):
                error_data = resp.json() if resp.content else {}
                status = error_data.get("error", {}).get("status", "")
                if status in ("UNREGISTERED", "NOT_FOUND", "INVALID_ARGUMENT"):
                    dt.is_active = False
                else:
                    log.warning(f"FCM send failed for token {dt.id}: {resp.status_code} {resp.text}")
            else:
                log.warning(f"FCM send failed for token {dt.id}: {resp.status_code} {resp.text}")
        except Exception as e:
            log.warning(f"FCM send exception for token {dt.id}: {e}")

    db.commit()
    return sent
