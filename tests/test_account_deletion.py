"""Deleting an account from inside the app (Apple requires it): a team member deletes their own login, the owner
deletes the business (closed now, erased after 30 days, the platform can undo it before that), a BizFind customer
deletes their BizFind account. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from sqlalchemy import select, text

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services import account_deletion
from tests.conftest import register_and_login
from tests.test_classes_bizfind import _customer


def _business(client, db, slug="deleteme"):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    return h, db.scalar(select(Studio).where(Studio.slug == slug))


def test_a_team_member_deletes_their_own_login(client, db_session):
    h, s = _business(client, db_session)
    staff = User(studio_id=s.id, email="dana@deleteme.com", password_hash=PasswordHasher().hash("password123"),
                 role="staff", display_name="דנה", is_active=True)
    db_session.add(staff)
    db_session.commit()
    hs = {"Authorization": f"Bearer {client.post('/api/auth/login', json={'studio_slug': 'deleteme', 'email': 'dana@deleteme.com', 'password': 'password123'}).json()['access_token']}"}
    assert client.post("/api/account/delete", headers=hs, json={"password": "wrong"}).json()["detail"] == "הסיסמה שגויה"
    assert client.post("/api/account/delete", headers=hs, json={"password": "password123"}).json() == {"deleted": "user"}
    db_session.expire_all()
    gone = db_session.get(User, staff.id)
    assert (gone.is_active, gone.email.endswith("@deleted.invalid"), gone.display_name) == (False, True, "משתמש/ת שנמחק/ה")
    assert client.post("/api/auth/login", json={"studio_slug": "deleteme", "email": "dana@deleteme.com", "password": "password123"}).status_code != 200
    assert client.get("/api/clients", headers=h).status_code == 200                  # the business goes on


def test_the_owner_deletes_the_business_closed_now_erased_after_30_days(client, db_session):
    h, s = _business(client, db_session)
    owner = db_session.scalar(select(User).where(User.studio_id == s.id))
    c = Client(studio_id=s.id, full_name="לקוחה", phone="0500000001")
    db_session.add(c)
    db_session.flush()
    db_session.add(Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="תור",
                               starts_at=datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc), ends_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)))
    db_session.get(StudioSettings, s.id).marketplace_visible = True
    db_session.commit()

    wrong = client.post("/api/account/delete", headers=h, json={"password": "password123", "business_name": "משהו אחר"})
    assert wrong.status_code == 400 and wrong.json()["detail"] == "שם העסק שהוקלד לא תואם"
    r = client.post("/api/account/delete", headers=h, json={"password": "password123", "business_name": s.name})
    assert r.status_code == 200 and r.json()["deleted"] == "business"
    locked = client.get("/api/clients", headers=h)
    assert locked.status_code == 402 and locked.json()["detail"] == "STUDIO_DELETED"
    db_session.expire_all()
    assert db_session.get(StudioSettings, s.id).marketplace_visible is False           # off BizFind at once

    # not erased before 30 days; the platform can still undo it
    assert account_deletion.purge_due(db_session) == 0
    account_deletion.cancel_business_deletion(db_session, db_session.get(Studio, s.id))
    db_session.commit()
    assert client.get("/api/clients", headers=h).status_code == 200

    # deleted again, 31 days ago → the daily job erases everything
    st = db_session.get(Studio, s.id)
    account_deletion.request_business_deletion(db_session, st)
    st.deletion_requested_at = datetime.now(timezone.utc) - timedelta(days=31)
    db_session.commit()
    assert account_deletion.purge_due(db_session) == 1
    db_session.expire_all()
    assert db_session.get(Studio, s.id) is None
    assert db_session.execute(text("SELECT count(*) FROM clients WHERE studio_id = :s"), {"s": str(s.id)}).scalar() == 0


def test_a_bizfind_customer_deletes_their_account(client, db_session):
    me = _customer(db_session, "0501234567")
    assert client.get("/api/marketplace/auth/me", headers=me).status_code == 200
    assert client.delete("/api/marketplace/auth/me", headers=me).status_code == 204
    assert client.get("/api/marketplace/auth/me", headers=me).status_code == 404
    assert db_session.execute(text("SELECT count(*) FROM marketplace_customers WHERE phone = '0501234567'")).scalar() == 0


def test_signing_up_by_email_without_a_phone_then_deleting(client, db_session):
    """The e-mail sign-up's phone is optional — it used to fail (500) because the table required a phone."""
    r = client.post("/api/marketplace/auth/register-email", json={"email": "nophone@example.com", "password": "abc12345",
                                                                   "first_name": "בודק", "last_name": "אפל"})
    assert r.status_code == 200, r.text
    me = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/api/marketplace/auth/me", headers=me).json()["phone"] == ""
    assert client.get("/api/marketplace/auth/my-businesses", headers=me).json() == []
    second = client.post("/api/marketplace/auth/register-email", json={"email": "nophone2@example.com", "password": "abc12345",
                                                                         "first_name": "עוד", "last_name": "אחד"})
    assert second.status_code == 200, second.text                                  # two customers without a phone
    assert client.delete("/api/marketplace/auth/me", headers=me).status_code == 204
    assert client.post("/api/marketplace/auth/login-email", json={"email": "nophone@example.com", "password": "abc12345"}).status_code != 200
