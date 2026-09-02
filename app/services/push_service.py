from __future__ import annotations

import json
import logging
import os
import time
from uuid import UUID

import httpx
import jwt as pyjwt
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device_token import DeviceToken

log = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"]
_cached_token: str | None = None
_cached_token_expiry: float = 0.0

_APNS_HOST = "https://api.push.apple.com"
_cached_apns_jwt: str | None = None
_cached_apns_jwt_issued: float = 0.0


def _get_fcm_access_token() -> str | None:
    global _cached_token, _cached_token_expiry
    if _cached_token and time.time() < _cached_token_expiry - 60:
        return _cached_token

    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not raw:
        log.warning("FIREBASE_SERVICE_ACCOUNT_JSON not set — Android push notifications disabled")
        return None

    credentials = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=_SCOPES)
    credentials.refresh(GoogleAuthRequest())
    _cached_token = credentials.token
    _cached_token_expiry = credentials.expiry.timestamp() if credentials.expiry else time.time() + 3000
    return _cached_token


def _get_apns_jwt() -> str | None:
    """iOS pushes go straight to Apple (APNs), not through FCM. The Capacitor
    push-notifications plugin only hands back a raw APNs device token on
    iOS (no Firebase SDK is integrated in the native app), so routing that
    token through FCM's send API silently accepts the request without ever
    actually delivering it. Reuses the same APNs Auth Key (.p8) uploaded to
    Firebase's Cloud Messaging config — it's a standard Apple key, usable
    directly against APNs too."""
    global _cached_apns_jwt, _cached_apns_jwt_issued
    now = time.time()
    if _cached_apns_jwt and now - _cached_apns_jwt_issued < 1800:
        return _cached_apns_jwt

    key_id = os.environ.get("APNS_KEY_ID")
    team_id = os.environ.get("APNS_TEAM_ID")
    auth_key = os.environ.get("APNS_AUTH_KEY")
    if not (key_id and team_id and auth_key):
        log.warning("APNS_KEY_ID/APNS_TEAM_ID/APNS_AUTH_KEY not set — iOS push notifications disabled")
        return None

    _cached_apns_jwt = pyjwt.encode(
        {"iss": team_id, "iat": int(now)},
        auth_key.replace("\\n", "\n"),
        algorithm="ES256",
        headers={"kid": key_id},
    )
    _cached_apns_jwt_issued = now
    return _cached_apns_jwt


def _send_apns(dt: DeviceToken, title: str, body: str, deep_link: str | None) -> bool:
    jwt_token = _get_apns_jwt()
    if not jwt_token:
        return False
    bundle_id = os.environ.get("APNS_BUNDLE_ID", "com.bizcontrol.app")

    headers = {
        "authorization": f"bearer {jwt_token}",
        "apns-topic": bundle_id,
        "apns-push-type": "alert",
        "apns-priority": "10",
    }
    payload = {
        "aps": {"alert": {"title": title, "body": body}, "sound": "default"},
        "deep_link": deep_link or "",
    }
    try:
        with httpx.Client(http2=True, timeout=10) as client:
            resp = client.post(f"{_APNS_HOST}/3/device/{dt.token}", headers=headers, json=payload)
        if resp.status_code == 200:
            return True
        reason = ""
        try:
            reason = resp.json().get("reason", "") if resp.content else ""
        except Exception:
            pass
        if resp.status_code == 410 or (resp.status_code == 400 and reason == "BadDeviceToken"):
            dt.is_active = False
        else:
            log.warning(f"APNs send failed for token {dt.id}: {resp.status_code} {reason or resp.text}")
    except Exception as e:
        log.warning(f"APNs send exception for token {dt.id}: {e}")
    return False


def send_push_to_user(db: Session, user_id: UUID, title: str, body: str, deep_link: str | None = None) -> int:
    """Sends a push notification to every active device registered for user_id.
    iOS devices are pushed directly via APNs; Android devices go through FCM.
    Returns the number of devices it was successfully delivered to."""
    tokens = db.execute(
        select(DeviceToken).where(DeviceToken.user_id == user_id, DeviceToken.is_active == True)
    ).scalars().all()
    if not tokens:
        return 0

    sent = 0

    for dt in [t for t in tokens if t.platform == "ios"]:
        if _send_apns(dt, title, body, deep_link):
            sent += 1

    android_tokens = [t for t in tokens if t.platform != "ios"]
    if android_tokens:
        project_id = os.environ.get("FIREBASE_PROJECT_ID")
        access_token = _get_fcm_access_token()
        if not project_id or not access_token:
            log.warning("Android push not configured (FIREBASE_PROJECT_ID/FIREBASE_SERVICE_ACCOUNT_JSON missing)")
        else:
            url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
            headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
            for dt in android_tokens:
                payload = {
                    "message": {
                        "token": dt.token,
                        "notification": {"title": title, "body": body},
                        "data": {"deep_link": deep_link or ""},
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
