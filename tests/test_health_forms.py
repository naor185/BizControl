"""The health declaration (owner, 2026-10-10): the business writes its form and/or attaches a file; a client fills it
and signs with a finger, the one giving the service signs after; the signed declaration keeps the form as it was
signed, sits on the appointment and in the client's file, and only the business sees it. Local test database;
nothing is sent."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login

SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="


def _business(client, db, slug="ink-health"):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    owner = db.scalar(select(User).where(User.studio_id == s.id))
    c = Client(studio_id=s.id, full_name="נועה כהן", phone="0501234567")
    db.add(c)
    db.flush()
    appt = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="קעקוע",
                       starts_at=datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc),
                       ends_at=datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc))
    db.add(appt)
    db.commit()
    return h, c, appt


def test_the_form_a_file_and_who_may_edit_it(client, db_session):
    h, _, _ = _business(client, db_session)
    f = client.get("/api/health-form", headers=h).json()
    assert (f["title"], f["saved"], f["ask_id_number"]) == ("הצהרת בריאות", False, True)     # the ready-made form
    assert len(f["questions"]) == 12 and f["questions"][-1]["kind"] == "text"

    pdf = b"%PDF-1.4 the studio's own declaration"
    up = client.post("/api/health-form/file", headers=h, files={"file": ("declaration.pdf", pdf, "application/pdf")})
    assert up.status_code == 200, up.text
    assert client.post("/api/health-form/file", headers=h,
                       files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400
    saved = client.put("/api/health-form", headers=h, json={
        "title": "הצהרה לפני קעקוע", "intro": "נא לקרוא את הקובץ ולענות",
        "questions": [{"text": "אלרגיה?", "kind": "yes_no"}, {"text": "  "}, {"text": "הערות", "kind": "text"}],
        "closing": "אני מאשר/ת", "ask_id_number": False, "file_id": up.json()["id"]}).json()
    assert [q["text"] for q in saved["questions"]] == ["אלרגיה?", "הערות"]                  # the empty one dropped
    assert saved["file"]["filename"] == "declaration.pdf" and saved["saved"]
    assert client.get(f"/api/health-form/files/{up.json()['id']}", headers=h).content == pdf

    r = client.post("/api/users/artists", headers=h, json={"email": "artist@ink-health.com", "password": "secret123",
                                                           "display_name": "דור", "role": "artist"})
    assert r.status_code == 201, r.text
    artist = client.post("/api/auth/login", json={"studio_slug": "ink-health", "email": "artist@ink-health.com",
                                                  "password": "secret123"}).json()["access_token"]
    a = {"Authorization": f"Bearer {artist}"}
    assert client.put("/api/health-form", headers=a, json={"questions": [{"text": "x"}]}).status_code == 403
    assert client.get("/api/health-form", headers=a).status_code == 200                  # the staff use it


def test_a_client_signs_then_the_artist_and_it_stays_as_signed(client, db_session):
    h, c, appt = _business(client, db_session)
    d = client.post("/api/health-declarations", headers=h, json={"client_id": str(c.id), "appointment_id": str(appt.id)}).json()
    assert d["status"] == "waiting_client" and d["client_name"] == "נועה כהן"
    again = client.post("/api/health-declarations", headers=h, json={"client_id": str(c.id), "appointment_id": str(appt.id)}).json()
    assert again["id"] == d["id"]                                                           # an open one isn't doubled

    yes_no = [q for q in d["questions"] if q["kind"] == "yes_no"]
    answers = {q["id"]: {"answer": "no"} for q in yes_no}
    answers[yes_no[4]["id"]] = {"answer": "yes", "details": "לטקס"}
    sign = f"/api/health-declarations/{d['id']}/client"
    missing = dict(answers)
    missing.pop(yes_no[0]["id"])
    assert client.post(sign, headers=h, json={"answers": missing, "id_number": "123456782", "signature": SIG}).status_code == 400
    assert client.post(sign, headers=h, json={"answers": answers, "id_number": "12", "signature": SIG}).status_code == 400
    assert client.post(sign, headers=h, json={"answers": answers, "id_number": "123456782", "signature": "x"}).status_code == 400
    assert client.post(f"/api/health-declarations/{d['id']}/performer", headers=h, json={"signature": SIG}).status_code == 400

    r = client.post(sign, headers=h, json={"answers": answers, "id_number": "123-456-782", "signature": SIG})
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["id_number"], r.json()["client_signed_via"]) == ("waiting_performer", "123456782", "studio")
    assert client.post(sign, headers=h, json={"answers": answers, "id_number": "123456782", "signature": SIG}).status_code == 400

    done = client.post(f"/api/health-declarations/{d['id']}/performer", headers=h, json={"signature": SIG}).json()
    assert done["status"] == "signed" and done["performer_signature"] == SIG and done["performer_name"]

    # the business changes its form afterwards — what was signed stays as it was
    client.put("/api/health-form", headers=h, json={"questions": [{"text": "שאלה חדשה"}]})
    kept = client.get(f"/api/health-declarations/{d['id']}", headers=h).json()
    assert kept["questions"] == d["questions"] and kept["answers"][yes_no[4]["id"]] == {"answer": "yes", "details": "לטקס"}

    for query in (f"client_id={c.id}", f"appointment_id={appt.id}"):
        rows = client.get(f"/api/health-declarations?{query}", headers=h).json()["rows"]
        assert [(x["id"], x["status"], x["flagged"]) for x in rows] == [(d["id"], "signed", [yes_no[4]["text"]])]
    assert client.delete(f"/api/health-declarations/{d['id']}", headers=h).status_code == 400   # a signed one stays

    other = register_and_login(client, slug="other-shop", email="owner@other-shop.com")
    assert client.get(f"/api/health-declarations/{d['id']}", headers=other).status_code == 404
    assert client.get(f"/api/health-declarations?client_id={c.id}", headers=other).json()["rows"] == []

    # a new one from the client's file, not signed — can be removed
    loose = client.post("/api/health-declarations", headers=h, json={"client_id": str(c.id)}).json()
    assert loose["questions"] == [{"id": loose["questions"][0]["id"], "text": "שאלה חדשה", "kind": "yes_no"}]
    assert client.delete(f"/api/health-declarations/{loose['id']}", headers=h).status_code == 200


def test_the_client_fills_it_from_a_whatsapp_link_and_the_artist_signs_in_the_studio(client, db_session):
    from datetime import timedelta

    from app.models.health_form import HealthDeclaration
    from app.models.message_job import MessageJob

    h, c, appt = _business(client, db_session)
    d = client.post("/api/health-declarations", headers=h, json={"client_id": str(c.id), "appointment_id": str(appt.id)}).json()
    token = d["link"].rsplit("/", 1)[1]

    sent = client.post(f"/api/health-declarations/{d['id']}/send-link", headers=h)
    assert sent.status_code == 200, sent.text
    job = db_session.scalar(select(MessageJob).where(MessageJob.reminder_type == "health_form"))
    assert (job.channel, job.to_phone, job.client_id, job.appointment_id) == ("whatsapp", "0501234567", c.id, appt.id)
    assert job.body.startswith("היי נועה, לקראת התור שלך ב-Studio ink-health ב-20/10 בשעה 11:00") and job.body.endswith(f"/health/{token}")
    assert sent.json()["link_sent_at"]

    # the link, without signing in: the form, and nothing more
    view = client.get(f"/api/public/health/{token}").json()
    assert (view["status"], view["client_name"], view["title"]) == ("waiting_client", "נועה כהן", "הצהרת בריאות")
    assert "answers" not in view and "client_signature" not in view
    assert client.get("/api/public/health/not-a-real-token").status_code == 404

    answers = {q["id"]: {"answer": "no"} for q in view["questions"] if q["kind"] == "yes_no"}
    signed = client.post(f"/api/public/health/{token}", json={"answers": answers, "id_number": "123456782", "signature": SIG},
                         headers={"x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "iPhone"})
    assert signed.status_code == 200, signed.text
    assert signed.json() == {"status": "signed", "business_name": "Studio ink-health"}           # nothing of what was signed
    assert client.post(f"/api/public/health/{token}", json={"answers": answers, "id_number": "123456782",
                                                            "signature": SIG}).status_code == 410  # closed once filled
    assert client.get(f"/api/public/health/{token}").json()["status"] == "signed"

    row = client.get(f"/api/health-declarations/{d['id']}", headers=h).json()
    assert (row["status"], row["client_signed_via"], row["client_ip"], row["client_device"], row["link"]) == (
        "waiting_performer", "link", "203.0.113.7", "iPhone", None)
    assert client.post(f"/api/health-declarations/{d['id']}/send-link", headers=h).status_code == 400
    assert client.post(f"/api/health-declarations/{d['id']}/performer", headers=h, json={"signature": SIG}).json()["status"] == "signed"

    # a link not filled in time closes; a client without a phone gets no link
    late = client.post("/api/health-declarations", headers=h, json={"client_id": str(c.id)}).json()
    db_session.get(HealthDeclaration, late["id"]).token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()
    late_token = late["link"].rsplit("/", 1)[1]
    assert client.get(f"/api/public/health/{late_token}").json()["status"] == "expired"
    assert client.post(f"/api/public/health/{late_token}", json={"answers": {}, "signature": SIG}).status_code == 410
    c.phone = None
    db_session.commit()
    assert client.post(f"/api/health-declarations/{late['id']}/send-link", headers=h).json()["detail"] == "ללקוח אין מספר טלפון"


def test_the_business_chooses_on_off_sending_by_itself_and_how_long_a_declaration_counts(client, db_session):
    from datetime import timedelta

    from app.models.message_job import MessageJob
    from app.services.health_forms import sweep_links

    h, c, _ = _business(client, db_session)
    s = db_session.get(Studio, c.studio_id)
    owner = db_session.scalar(select(User).where(User.studio_id == s.id))
    now = datetime.now(timezone.utc)

    def appointment(cl, starts_in, created_ago=None):
        a = Appointment(studio_id=s.id, client_id=cl.id, artist_id=owner.id, title="קעקוע",
                        starts_at=now + starts_in, ends_at=now + starts_in + timedelta(hours=1))
        if created_ago is not None:
            a.created_at = now - created_ago
        db_session.add(a)
        db_session.commit()
        return a

    def links():
        return sorted(str(j.appointment_id) for j in db_session.scalars(select(MessageJob).where(MessageJob.reminder_type == "health_form")))

    def choose(**kw):
        form = client.get("/api/health-form", headers=h).json()
        r = client.put("/api/health-form", headers=h, json={**form, "file_id": None, **kw})
        assert r.status_code == 200, r.text
        return r.json()

    f = client.get("/api/health-form", headers=h).json()
    assert (f["enabled"], f["auto_send"], f["validity"]) == (True, "off", "forever")        # nothing goes by itself
    booked_before = appointment(c, timedelta(days=3), created_ago=timedelta(hours=1))
    assert sweep_links(db_session) == 0

    # on booking: only appointments booked from now on, once each
    choose(auto_send="on_booking")
    assert sweep_links(db_session) == 0                                                   # booked before it was on
    first = appointment(c, timedelta(days=5))
    assert sweep_links(db_session) == 1 and links() == [str(first.id)]
    assert sweep_links(db_session) == 0
    second = appointment(c, timedelta(days=6))
    assert sweep_links(db_session) == 0                                                   # a link is already on its way

    # the client fills it from the link → in force for good: their next appointments get nothing
    view = client.get("/api/health-declarations?appointment_id=" + str(first.id), headers=h).json()
    token = view["rows"][0]["link"].rsplit("/", 1)[1]
    form = client.get(f"/api/public/health/{token}").json()
    answers = {q["id"]: {"answer": "no"} for q in form["questions"] if q["kind"] == "yes_no"}
    assert client.post(f"/api/public/health/{token}", json={"answers": answers, "id_number": "123456782", "signature": SIG}).status_code == 200
    third = appointment(c, timedelta(days=7))
    assert sweep_links(db_session) == 0
    on_third = client.get(f"/api/health-declarations?appointment_id={third.id}", headers=h).json()
    assert on_third["rows"] == [] and on_third["in_force"]["id"] == view["rows"][0]["id"]

    # a new declaration for every appointment: the coming ones get their own link
    choose(auto_send="on_booking", validity="every_visit")
    assert sweep_links(db_session) == 2 and links() == sorted([str(first.id), str(second.id), str(third.id)])
    assert str(booked_before.id) not in links()

    # the day before, in the day only — and a client without a phone gets nothing
    choose(auto_send="day_before", validity="forever")
    other = Client(studio_id=s.id, full_name="רון", phone="0507654321")
    no_phone = Client(studio_id=s.id, full_name="בלי טלפון")
    db_session.add_all([other, no_phone])
    db_session.commit()
    at_night = now.replace(hour=22, minute=0, second=0, microsecond=0)                     # 01:00 in Israel
    morning = at_night + timedelta(hours=11)                                               # 09:00–10:00 in Israel
    tomorrow = appointment(other, (morning - now) + timedelta(hours=10))
    later = appointment(other, (morning - now) + timedelta(hours=30))
    appointment(no_phone, (morning - now) + timedelta(hours=5))
    assert sweep_links(db_session, now=at_night) == 0
    assert sweep_links(db_session, now=morning) == 1 and str(tomorrow.id) in links() and str(later.id) not in links()

    # off: nothing by itself, and no new declarations by hand either
    choose(enabled=False, auto_send="on_booking")
    appointment(other, timedelta(days=9))
    assert sweep_links(db_session) == 0
    assert client.post("/api/health-declarations", headers=h, json={"client_id": str(c.id)}).status_code == 400
    assert client.get(f"/api/health-declarations?client_id={c.id}", headers=h).json()["enabled"] is False
