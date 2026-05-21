"""
Apple Wallet .pkpass generation.

Requirements (environment variables):
  APPLE_WALLET_PASS_TYPE_ID  – e.g. "pass.com.mystudio.club"
  APPLE_WALLET_TEAM_ID       – 10-char Apple Team ID, e.g. "ABCDE12345"
  APPLE_WALLET_CERT_PEM      – base64(PEM certificate from Apple Developer portal)
  APPLE_WALLET_CERT_KEY_PEM  – base64(PEM private key matching the certificate)
  APPLE_WALLET_WWDR_PEM      – base64(Apple WWDR intermediate CA PEM)
  APPLE_WALLET_WEB_SERVICE_URL – public URL for push updates (optional)

How to obtain the certificate:
  1. Create a Pass Type ID in Apple Developer portal
  2. Download and convert the certificate to PEM:
     openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out cert.pem
     openssl pkcs12 -in Certificates.p12 -nocerts -nodes -out key.pem
  3. Download WWDR from https://www.apple.com/certificateauthority/
     (AppleWWDRCAG4.cer, convert to PEM)
  4. Base64-encode each file and set as environment variables
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import zipfile

from app.utils.logger import get_logger

log = get_logger(__name__)

_NOT_CONFIGURED_MSG = (
    "Apple Wallet not configured. Set APPLE_WALLET_PASS_TYPE_ID, "
    "APPLE_WALLET_TEAM_ID, APPLE_WALLET_CERT_PEM, "
    "APPLE_WALLET_CERT_KEY_PEM, APPLE_WALLET_WWDR_PEM."
)


def _load_env() -> dict | None:
    needed = ["APPLE_WALLET_PASS_TYPE_ID", "APPLE_WALLET_TEAM_ID",
              "APPLE_WALLET_CERT_PEM", "APPLE_WALLET_CERT_KEY_PEM", "APPLE_WALLET_WWDR_PEM"]
    cfg = {k: os.getenv(k, "") for k in needed}
    if not all(cfg.values()):
        return None
    return cfg


def is_configured() -> bool:
    return _load_env() is not None


def _sign_manifest(manifest_json: bytes, cert_pem: bytes, key_pem: bytes, wwdr_pem: bytes) -> bytes:
    """Returns PKCS7 detached signature (DER) of manifest_json."""
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    from cryptography.hazmat.primitives import hashes
    from cryptography.x509 import load_pem_x509_certificate
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend
    from cryptography import x509
    import cryptography.hazmat.primitives.serialization.pkcs7 as pkcs7_mod

    cert = load_pem_x509_certificate(cert_pem, default_backend())
    key = load_pem_private_key(key_pem, password=None, backend=default_backend())
    wwdr = load_pem_x509_certificate(wwdr_pem, default_backend())

    signed = (
        pkcs7_mod.PKCS7SignatureBuilder()
        .set_data(manifest_json)
        .add_signer(cert, key, hashes.SHA256())
        .add_certificate(wwdr)
        .sign(pkcs7_mod.PKCS7Options.DetachedSignature)
    )
    return signed


def generate_pkpass(
    *,
    serial_number: str,
    client_name: str,
    loyalty_points: int,
    qr_token: str,
    studio_name: str,
    background_color: str = "#1a1a2e",
    text_color: str = "#ffffff",
    label_color: str = "#a5b4fc",
    strip_color: str = "#6366f1",
    logo_url: str | None = None,
    card_title: str | None = None,
) -> bytes:
    """
    Returns raw .pkpass bytes, or raises RuntimeError if Apple Wallet is not configured.
    """
    cfg = _load_env()
    if not cfg:
        raise RuntimeError(_NOT_CONFIGURED_MSG)

    cert_pem = base64.b64decode(cfg["APPLE_WALLET_CERT_PEM"])
    key_pem = base64.b64decode(cfg["APPLE_WALLET_CERT_KEY_PEM"])
    wwdr_pem = base64.b64decode(cfg["APPLE_WALLET_WWDR_PEM"])
    web_url = os.getenv("APPLE_WALLET_WEB_SERVICE_URL", "")

    display_name = card_title or studio_name

    def _hex_to_rgb(h: str) -> str:
        h = h.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return f"rgb({r},{g},{b})"

    pass_dict: dict = {
        "formatVersion": 1,
        "passTypeIdentifier": cfg["APPLE_WALLET_PASS_TYPE_ID"],
        "serialNumber": serial_number,
        "teamIdentifier": cfg["APPLE_WALLET_TEAM_ID"],
        "organizationName": studio_name,
        "description": f"כרטיס מועדון — {display_name}",
        "foregroundColor": _hex_to_rgb(text_color),
        "backgroundColor": _hex_to_rgb(background_color),
        "labelColor": _hex_to_rgb(label_color),
        "logoText": display_name,
        "storeCard": {
            "primaryFields": [
                {
                    "key": "points",
                    "label": "נקודות",
                    "value": loyalty_points,
                    "changeMessage": "הנקודות עודכנו ל-%@",
                }
            ],
            "secondaryFields": [
                {
                    "key": "member_name",
                    "label": "שם חבר/ה",
                    "value": client_name,
                }
            ],
            "auxiliaryFields": [
                {
                    "key": "club",
                    "label": "סטטוס",
                    "value": "חבר/ת מועדון ⭐",
                }
            ],
            "backFields": [
                {
                    "key": "info",
                    "label": "פרטים",
                    "value": "כרטיס מועדון דיגיטלי. סרוק כדי לצבור / לממש נקודות.",
                }
            ],
        },
        "barcode": {
            "message": qr_token,
            "format": "PKBarcodeFormatQR",
            "messageEncoding": "iso-8859-1",
            "altText": client_name,
        },
        "barcodes": [
            {
                "message": qr_token,
                "format": "PKBarcodeFormatQR",
                "messageEncoding": "iso-8859-1",
                "altText": client_name,
            }
        ],
    }

    if web_url:
        pass_dict["webServiceURL"] = web_url
        pass_dict["authenticationToken"] = serial_number

    pass_json = json.dumps(pass_dict, ensure_ascii=False).encode("utf-8")

    # Minimal valid 1×1 white PNG for icon/logo (replaced with real assets when available)
    _BLANK_PNG = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    )

    files: dict[str, bytes] = {
        "pass.json": pass_json,
        "icon.png": _BLANK_PNG,
        "icon@2x.png": _BLANK_PNG,
        "logo.png": _BLANK_PNG,
        "logo@2x.png": _BLANK_PNG,
    }

    # Build manifest (SHA1 per Apple spec)
    manifest: dict[str, str] = {
        name: hashlib.sha1(data).hexdigest()  # noqa: S324 — Apple requires SHA-1
        for name, data in files.items()
    }
    manifest_json = json.dumps(manifest, ensure_ascii=False).encode("utf-8")

    # Sign the manifest
    signature = _sign_manifest(manifest_json, cert_pem, key_pem, wwdr_pem)

    # Package as ZIP
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
        zf.writestr("manifest.json", manifest_json)
        zf.writestr("signature", signature)

    return buf.getvalue()
