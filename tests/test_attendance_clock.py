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

    # the superadmin turned the barcode on anyway: his card says the plan doesn't have it, and nobody clocks
    on = client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=sa, json={"on": True}).json()
    assert on["on"] is True and on["included"] is False
    code = on["link"].rsplit("/", 1)[1]
    assert client.post("/api/nfc/tap", headers=w, json={"code": code}).status_code == 403
    assert client.get("/api/nfc/status", headers=owner).json().items() >= {"included": False, "on": False}.items()
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
    assert client.get("/api/nfc/status", headers=owner).json().items() >= {"included": True, "on": False}.items()

    link = client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=sa, json={"on": True}).json()["link"]
    assert client.get("/api/nfc/status", headers=owner).json().items() >= {"included": True, "on": True, "link": link,
                                                                           "name": "Studio att-code"}.items()
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


def test_a_clock_in_before_the_opening_counts_from_it(client, db_session):
    """The owner, 2026-10-19: a worker due at the opening (8) who clocks in at 7 is paid from 8 — the clock-in stays 7;
    a switch turns it off; a time fixed by hand counts as it is."""
    from datetime import datetime, timedelta
    import pytz
    from app.repositories.staff_repository import StaffRepository, price_shift
    from app.services import nfc_clock

    owner = register_and_login(client, "att-open", "owner@att-open.com")
    _plan(db_session, "att-open", "pro")
    _member(client, owner, "dana@att-open.com", role="staff", pay_type="hourly")
    worker = db_session.scalar(select(User).where(User.email == "dana@att-open.com"))
    worker.hourly_rate = 50
    db_session.commit()
    IL = pytz.timezone("Asia/Jerusalem")
    day = datetime.now(IL).date() - timedelta(days=1)                       # yesterday — never "in the future"
    at = lambda h: IL.localize(datetime(day.year, day.month, day.day, h, 0))

    assert nfc_clock.paid_from(db_session, worker.studio_id, at(7)) == at(8)
    assert nfc_clock.paid_from(db_session, worker.studio_id, at(9)) is None
    assert nfc_clock.paid_from(db_session, worker.studio_id, at(2)) is None          # a night's work, not early for 8
    s = WorkSession(studio_id=worker.studio_id, user_id=worker.id, start_time=at(7), paid_from=at(8), end_time=at(10))
    price_shift(s, worker)
    assert float(s.session_pay) == 100.0                                    # 2 h × ₪50, not 3
    db_session.add(s)
    db_session.commit()
    row = next(r for r in StaffRepository(db_session).get_user_payroll_summary(worker.studio_id, at(0), at(23))
               if r["user_id"] == worker.id)
    assert row["total_hours"] == 2.0
    shifts = client.get("/api/staff/shifts", headers=owner, params={"user_id": str(worker.id),
                        "start_date": f"{day}T00:00:00", "end_date": f"{day}T23:59:00"}).json()
    assert shifts[0]["hours"] == 2.0 and shifts[0]["paid_from"] is not None

    fixed = client.patch(f"/api/staff/shifts/{s.id}", headers=owner, json={"start_time": f"{day}T07:00", "end_time": f"{day}T10:00"}).json()
    assert fixed["hours"] == 3.0 and fixed["paid_from"] is None             # fixed by hand: as it is

    assert client.post("/api/nfc/from-opening", headers=owner, json={"on": False}).json()["from_opening"] is False
    db_session.expire_all()
    assert nfc_clock.paid_from(db_session, worker.studio_id, at(7)) is None
