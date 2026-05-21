"""
Google Wallet pass generation.

Requirements (environment variables):
  GOOGLE_WALLET_SERVICE_ACCOUNT_JSON – base64(service account JSON from Google Cloud)
  GOOGLE_WALLET_ISSUER_ID            – Issuer ID from Google Pay & Wallet Console

How to set up:
  1. Enable the Google Wallet API in Google Cloud Console
  2. Create a service account and grant "Google Wallet Object Issuer" role
  3. Download the service account JSON key
  4. Register as an issuer at https://pay.google.com/business/console
  5. Base64-encode the JSON and set GOOGLE_WALLET_SERVICE_ACCOUNT_JSON
  6. Set GOOGLE_WALLET_ISSUER_ID from the Wallet console

Documentation:
  https://developers.google.com/wallet/generic/web/integration-guide
"""
from __future__ import annotations

import base64
import json
import os
import time
import uuid

from app.utils.logger import get_logger

log = get_logger(__name__)

_NOT_CONFIGURED_MSG = (
    "Google Wallet not configured. Set GOOGLE_WALLET_SERVICE_ACCOUNT_JSON "
    "and GOOGLE_WALLET_ISSUER_ID."
)


def is_configured() -> bool:
    return bool(
        os.getenv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON")
        and os.getenv("GOOGLE_WALLET_ISSUER_ID")
    )


def _load_sa() -> dict:
    raw = os.getenv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON", "")
    if not raw:
        raise RuntimeError(_NOT_CONFIGURED_MSG)
    return json.loads(base64.b64decode(raw))


def generate_save_url(
    *,
    client_id: str,
    client_name: str,
    loyalty_points: int,
    qr_token: str,
    studio_name: str,
    studio_id: str,
    background_color: str = "#1a1a2e",
    logo_url: str | None = None,
    card_title: str | None = None,
) -> str:
    """
    Returns a Google Wallet "Add to Google Wallet" URL, or raises RuntimeError
    if Google Wallet is not configured.

    The URL format:
      https://pay.google.com/gp/v/save/{jwt}
    """
    if not is_configured():
        raise RuntimeError(_NOT_CONFIGURED_MSG)

    issuer_id = os.getenv("GOOGLE_WALLET_ISSUER_ID")
    sa = _load_sa()

    class_suffix = f"club_card_{studio_id.replace('-', '')}"
    object_suffix = f"client_{client_id.replace('-', '')}"
    class_id = f"{issuer_id}.{class_suffix}"
    object_id = f"{issuer_id}.{object_suffix}"
    display_name = card_title or studio_name

    loyalty_class = {
        "id": class_id,
        "issuerName": studio_name,
        "programName": display_name,
        "programLogo": {
            "sourceUri": {"uri": logo_url or "https://via.placeholder.com/150"},
            "contentDescription": {"defaultValue": {"language": "he", "value": display_name}},
        },
        "heroImage": None,
        "backgroundColor": background_color,
        "reviewStatus": "UNDER_REVIEW",
        "hexBackgroundColor": background_color,
    }

    loyalty_object = {
        "id": object_id,
        "classId": class_id,
        "state": "ACTIVE",
        "accountId": client_id,
        "accountName": client_name,
        "loyaltyPoints": {
            "balance": {"int": loyalty_points},
            "label": "נקודות",
        },
        "barcode": {
            "type": "QR_CODE",
            "value": qr_token,
            "alternateText": client_name,
        },
    }

    payload = {
        "iss": sa["client_email"],
        "aud": "google",
        "typ": "savetowallet",
        "iat": int(time.time()),
        "payload": {
            "loyaltyClasses": [loyalty_class],
            "loyaltyObjects": [loyalty_object],
        },
    }

    # Sign JWT with the service account private key
    import google.auth.crypt
    import google.auth.jwt

    signer = google.auth.crypt.RSASigner.from_service_account_info(sa)
    token = google.auth.jwt.encode(signer, payload).decode("utf-8")

    return f"https://pay.google.com/gp/v/save/{token}"
