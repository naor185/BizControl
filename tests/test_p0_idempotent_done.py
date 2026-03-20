from datetime import datetime, timedelta, timezone
from sqlalchemy import select

from tests.conftest import register_and_login
from app.models.message_job import MessageJob
from app.models.client_points_ledger import ClientPointsLedger
from app.models.user import User
from app.models.studio import Studio

def test_done_is_idempotent(client, db_session):
    h = register_and_login(client, slug="s3", email="owner3@s3.com")

    # נשלוף owner (הוא גם יהיה artist_id)
    studio = db_session.scalar(select(Studio).where(Studio.slug == "s3"))
    owner = db_session.scalar(select(User).where(User.studio_id == studio.id, User.role == "owner"))

    # לקוח עם הסכמה + טלפון (כדי שיווצר MessageJob)
    r = client.post("/api/clients", headers=h, json={
        "full_name": "Client P0",
        "phone": "0502222222",
        "email": "p0@test.com",
        "marketing_consent": True,
        "notes": None,
        "is_active": True
    })
    assert r.status_code == 201, r.text
    client_id = r.json()["id"]

    starts = datetime.now(timezone.utc) + timedelta(hours=1)
    ends = starts + timedelta(hours=2)

    # יצירת תור scheduled
    r = client.post("/api/appointments", headers=h, json={
        "client_id": client_id,
        "artist_id": str(owner.id),
        "title": "Tattoo Session",
        "starts_at": starts.isoformat(),
        "ends_at": ends.isoformat(),
        "notes": None
    })
    assert r.status_code == 201, r.text
    appt_id = r.json()["id"]

    # מסמנים done פעם ראשונה
    r = client.patch(f"/api/appointments/{appt_id}", headers=h, json={"status": "done"})
    assert r.status_code == 200, r.text

    # מסמנים done שוב (לא אמור להכפיל)
    r = client.patch(f"/api/appointments/{appt_id}", headers=h, json={"status": "done"})
    assert r.status_code == 200, r.text

    # בדיקה DB: רק רשומה אחת בלדג'ר + רק job אחד
    ledger_count = db_session.query(ClientPointsLedger).filter(
        ClientPointsLedger.studio_id == studio.id,
        ClientPointsLedger.client_id == client_id,
        ClientPointsLedger.appointment_id == appt_id,
    ).count()

    jobs_count = db_session.query(MessageJob).filter(
        MessageJob.studio_id == studio.id,
        MessageJob.client_id == client_id,
        MessageJob.appointment_id == appt_id,
    ).count()

    assert ledger_count == 1
    assert jobs_count == 1
