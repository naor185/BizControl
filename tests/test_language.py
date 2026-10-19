"""The system's language (the owner, 2026-10-19: Hebrew or English; Arabic out): each user's choice kept in the account,
the owner's is the business's — a worker who never chose follows it; the server's messages in the language the request
asks for (X-Lang), from one dictionary (app/core/i18n.py)."""
from tests.conftest import register_and_login


def test_the_choice_is_kept_and_the_owners_is_the_business(client, db_session):
    owner = register_and_login(client, "lang-shop", "owner@lang-shop.com")
    r = client.post("/api/users/artists", headers=owner, json={"email": "eli@lang-shop.com", "password": "secret123",
                                                               "role": "staff", "display_name": "איילי"})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": "eli@lang-shop.com", "password": "secret123"}).json()["access_token"]
    eli = {"Authorization": f"Bearer {t}"}

    assert client.get("/api/auth/me", headers=owner).json()["locale"] == "he"
    assert client.put("/api/auth/me/locale", headers=owner, json={"locale": "en"}).json() == {"locale": "en"}
    assert client.get("/api/auth/me", headers=eli).json()["locale"] == "en"          # never chose — the business's
    client.put("/api/auth/me/locale", headers=eli, json={"locale": "he"})
    assert client.get("/api/auth/me", headers=eli).json()["locale"] == "he"
    assert client.get("/api/auth/me", headers=owner).json()["locale"] == "en"
    assert client.put("/api/auth/me/locale", headers=owner, json={"locale": "ar"}).status_code == 422   # Arabic is out


def test_a_server_message_in_the_requests_language(client, db_session):
    owner = register_and_login(client, "lang-err", "owner@lang-err.com")
    client.post("/api/users/artists", headers=owner, json={"email": "eli@lang-err.com", "password": "secret123",
                                                           "role": "staff", "display_name": "איילי"})
    t = client.post("/api/auth/login-by-email", json={"email": "eli@lang-err.com", "password": "secret123"}).json()["access_token"]
    eli = {"Authorization": f"Bearer {t}"}
    he = client.post("/api/staff/break/start", headers=eli)
    en = client.post("/api/staff/break/start", headers={**eli, "X-Lang": "en"})
    assert he.status_code == en.status_code == 403
    assert he.json()["detail"] == "הפסקה — לעובדים במשמרת"
    assert en.json()["detail"] == "Breaks are for staff on a shift"
    # a phone set to English sends Accept-Language: en — the system's own choice (X-Lang) is what counts
    assert client.post("/api/staff/break/start", headers={**eli, "Accept-Language": "en-US"}).json()["detail"] == "הפסקה — לעובדים במשמרת"
