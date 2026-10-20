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


def test_the_client_pages_speak_the_businesss_language(client, db_session):
    """The owner, 2026-10-20: the whole system in English, right to left in Hebrew and left to right in English — the
    pages a business's clients open (booking, club, opt-out…) speak the business's language, not the visitor's."""
    from sqlalchemy import select
    from app.core.i18n import say
    from app.models.studio import Studio
    owner = register_and_login(client, "lang-pub", "owner@lang-pub.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "lang-pub"))
    assert client.get(f"/api/public/landing/lang-pub").json()["locale"] == "he"
    client.put("/api/auth/me/locale", headers=owner, json={"locale": "en"})
    assert client.get(f"/api/public/landing/lang-pub").json()["locale"] == "en"
    assert client.get(f"/api/public/studio/{s.id}").json()["locale"] == "en"
    r = client.get("/api/book/no-such-shop/info", headers={"X-Lang": "en"})
    assert (r.status_code, r.json()["detail"]) == (404, "Business not found")
    # a message with a value inside, and the word that fills it
    assert say("הקופון SUMMER הופסק", "en") == "The coupon SUMMER was stopped"
    assert say("ההודעה לא נמצא", "en") == "The message not found"
    assert say("הקופון SUMMER הופסק", "he") == "הקופון SUMMER הופסק"


def test_the_bell_speaks_the_readers_language(client, db_session):
    """Notifications are written in Hebrew where they happen and said in the reader's language — old ones too."""
    from sqlalchemy import select
    from app.models.notification import Notification
    from app.models.studio import Studio
    owner = register_and_login(client, "lang-bell", "owner@lang-bell.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "lang-bell"))
    db_session.add_all([
        Notification(studio_id=s.id, type="message_failed", title="הודעת וואטסאפ נכשלה",
                     body="ההודעה לדנה לא נשלחה. צוות BizControl קיבל התראה ומטפל."),
        Notification(studio_id=s.id, type="plan_3", title="המנוי יפוג בעוד 3 ימים", body="משהו שאין לו תרגום"),
    ])
    db_session.commit()
    en = client.get("/api/notifications", headers={**owner, "X-Lang": "en"}).json()
    assert {n["title"] for n in en} == {"WhatsApp message failed", "The subscription expires in 3 days"}
    assert "The message to דנה wasn't sent. The BizControl team was alerted and is on it." in {n["body"] for n in en}
    assert "משהו שאין לו תרגום" in {n["body"] for n in en}                  # no English yet — as written
    he = client.get("/api/notifications", headers=owner).json()
    assert "הודעת וואטסאפ נכשלה" in {n["title"] for n in he}
