"""The attendance clock as part of the plan (owner, 2026-10-16): in pro, enterprise and the free month — not in עסק קטן;
every worker and manager clocks, whatever their pay (the pay doesn't change, the hours are kept), the owner doesn't; the
owner — and a manager allowed the team — sees the barcode on ניהול צוות and can replace it."""
import uuid

from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.studio import Studio
from app.models.user import User
from app.models.work_session import WorkSession
from tests.conftest import register_and_login
from tests.test_nfc_clock import _studio_id, _superadmin


def _plan(db, slug, plan):
    db.scalar(select(Studio).where(Studio.slug == slug)).subscription_plan = plan
    db.commit()


def _member(client, owner, email, role="artist", pay_type="commission"):
    r = client.post("/api/users/artists", headers=owner, json={"email": email, "password": "secret123", "role": role,
                                                               "display_name": email.split("@")[0], "pay_type": pay_type,
                                                               "commission_rate": 40})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}


def test_a_small_business_plan_has_no_clock(client, db_session):
    import app.services.message_worker as mw
    sa = _superadmin(client, db_session)
    owner = register_and_login(client, "att-small", "owner@att-small.com")
    _plan(db_session, "att-small", "starter")
    w = _member(client, owner, "dana@att-small.com", role="staff", pay_type="hourly")
    sid = _studio_id(client, owner)

    assert client.get("/api/staff/clock-status", headers=w).json()["available"] is False
    assert client.post("/api/staff/clock-in", headers=w).status_code == 403
    assert client.get("/api/tutorial/checks", headers=w).json()["checks"]["clock_in"]["applies"] is False

    # the superadmin turned the barcode on anyway: his card says the plan doesn't have it, and nobody clocks
    on = client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=sa, json={"on": True}).json()
    assert on["on"] is True and on["included"] is False
    code = on["link"].rsplit("/", 1)[1]
    assert client.post("/api/nfc/tap", headers=w, json={"code": code}).status_code == 403
    assert client.get("/api/nfc/status", headers=owner).json() == {"included": False, "on": False}
    worker = db_session.scalar(select(User).where(User.email == "dana@att-small.com"))
    assert mw.clock_in_needed(db_session, worker.studio_id, worker.id, worker.role) is False


def test_every_worker_and_manager_clocks_whatever_their_pay_not_the_owner(client, db_session):
    owner = register_and_login(client, "att-pro", "owner@att-pro.com")
    _plan(db_session, "att-pro", "pro")
    artist = _member(client, owner, "dana@att-pro.com")                                  # paid by commission
    manager = _member(client, owner, "ron@att-pro.com", role="admin", pay_type="none")

    for h in (artist, manager):
        assert client.get("/api/staff/clock-status", headers=h).json()["available"] is True
    assert client.get("/api/staff/clock-status", headers=owner).json()["available"] is False
    assert client.post("/api/staff/clock-in", headers=owner).status_code == 403
    assert client.get("/api/tutorial/checks", headers=artist).json()["checks"]["clock_in"]["applies"] is True

    shift = client.post("/api/staff/clock-in", headers=artist).json()
    assert client.post("/api/staff/clock-out", headers=artist).status_code == 200
    db_session.expire_all()
    s = db_session.get(WorkSession, shift["id"])
    assert s.end_time is not None and float(s.session_pay) == 0.0                        # hours kept, the pay as before
    assert client.post("/api/staff/clock-in", headers=manager).status_code == 200


def test_the_owner_sees_the_barcode_and_replaces_it(client, db_session):
    sa = _superadmin(client, db_session)
    owner = register_and_login(client, "att-code", "owner@att-code.com")
    _plan(db_session, "att-code", "trial")
    w = _member(client, owner, "dana@att-code.com")
    manager = _member(client, owner, "ron@att-code.com", role="admin", pay_type="none")
    sid = _studio_id(client, owner)
    assert client.get("/api/nfc/status", headers=owner).json() == {"included": True, "on": False}

    link = client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=sa, json={"on": True}).json()["link"]
    assert client.get("/api/nfc/status", headers=owner).json() == {"included": True, "on": True, "link": link,
                                                                   "name": "Studio att-code"}
    assert "link" not in client.get("/api/nfc/status", headers=w).json()               # a worker never gets it
    assert "link" not in client.get("/api/nfc/status", headers=manager).json()         # nor a manager not allowed the team

    # the owner scans it to check it works — nothing is clocked
    old = link.rsplit("/", 1)[1]
    check = client.post("/api/nfc/tap", headers=owner, json={"code": old}).json()
    assert check["action"] == "check"
    assert db_session.scalars(select(WorkSession).where(WorkSession.studio_id == uuid.UUID(sid))).all() == []

    assert client.post("/api/nfc/new-code", headers=w).status_code == 403
    new = client.post("/api/nfc/new-code", headers=owner).json()
    assert new["on"] is True and new["link"] != link
    assert client.post("/api/nfc/tap", headers=w, json={"code": old}).status_code == 404
    assert client.post("/api/nfc/tap", headers=w, json={"code": new["link"].rsplit("/", 1)[1]}).json()["action"] == "in"
    logged = db_session.scalars(select(AuditLog).where(AuditLog.studio_id == sid, AuditLog.action == "attendance")).all()
    assert [a.details["text"] for a in logged] == ["ברקוד חדש לשעון הנוכחות — הקודם הפסיק לעבוד"]
