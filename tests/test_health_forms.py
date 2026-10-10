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
        rows = client.get(f"/api/health-declarations?{query}", headers=h).json()
        assert [(x["id"], x["status"], x["flagged"]) for x in rows] == [(d["id"], "signed", [yes_no[4]["text"]])]
    assert client.delete(f"/api/health-declarations/{d['id']}", headers=h).status_code == 400   # a signed one stays

    other = register_and_login(client, slug="other-shop", email="owner@other-shop.com")
    assert client.get(f"/api/health-declarations/{d['id']}", headers=other).status_code == 404
    assert client.get(f"/api/health-declarations?client_id={c.id}", headers=other).json() == []

    # a new one from the client's file, not signed — can be removed
    loose = client.post("/api/health-declarations", headers=h, json={"client_id": str(c.id)}).json()
    assert loose["questions"] == [{"id": loose["questions"][0]["id"], "text": "שאלה חדשה", "kind": "yes_no"}]
    assert client.delete(f"/api/health-declarations/{loose['id']}", headers=h).status_code == 200
