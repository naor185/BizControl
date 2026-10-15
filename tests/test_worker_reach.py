"""The server keeps the workers (artist/staff) to their own reach, not only the screens (owner, 2026-10-13)."""
from sqlalchemy import select

from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from tests.conftest import register_and_login


def _worker(client, h, email, role="staff"):
    r = client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123", "display_name": "דנה", "role": role})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}


def test_a_worker_is_kept_out_of_money_settings_and_secrets(client, db_session):
    owner = register_and_login(client, "reach-shop", "owner@reach-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "reach-shop"))
    st = db_session.get(StudioSettings, s.id)
    st.whatsapp_api_key, st.bank_account, st.google_calendar_refresh_token = "WA-SECRET", "123456", "G-REFRESH"
    db_session.commit()

    for role in ("staff", "artist"):
        w = _worker(client, owner, f"{role}@reach-shop.com", role)
        # every page of "ניהול עסק" is the owner's and the managers' (the owner, 2026-10-15)
        for path in ("/api/expenses", "/api/invoices", "/api/dashboard/stats", "/api/pos/history", "/api/products/",
                     "/api/payments", "/api/obligations", "/api/activity", "/api/dashboard/advanced", "/api/calls",
                     "/api/gift-cards", "/api/wallet-design", "/api/wait-list", "/api/coupons", "/api/classes/settings",
                     "/api/users/artists/manager-permissions"):
            assert client.get(path, headers=w).status_code == 403, (role, path)
        assert client.post("/api/data-export", headers=w, json={"pin": "1234"}).status_code == 403
        assert client.get("/api/services", headers=w).status_code == 200                          # the calendar reads them
        assert client.post("/api/services", headers=w, json={"name": "x"}).status_code == 403          # …doesn't change them
        cfg = client.get("/api/studio/automation", headers=w).json()
        assert cfg["whatsapp_api_key"] is None and cfg["bank_account"] is None and cfg["google_calendar_refresh_token"] is None

    assert client.get("/api/expenses", headers=owner).status_code == 200
    assert client.get("/api/payments", headers=owner).status_code == 200
    assert client.get("/api/studio/automation", headers=owner).json()["whatsapp_api_key"] == "WA-SECRET"
    assert client.post("/api/services", headers=owner, json={"name": "תספורת"}).status_code == 201
