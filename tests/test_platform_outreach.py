"""The superadmin's CRM, part ב: messages from the company to the businesses' owners — WhatsApp and e-mail through the
queue as the platform's own, templates the superadmin edits, the owner's name / business / plan / days filled in, and
the log of what went to whom. Local test database; the senders are fakes — nothing is sent."""
from sqlalchemy import select

from app.models.studio import Studio
from app.models.user import User
import app.services.email_center as ec
import app.services.message_worker as mw
from app.services.message_worker import process_due_jobs
from tests.conftest import register_and_login


def _superadmin(client, db):
    h = register_and_login(client, slug="platform-sa", email="sa@platform.com")
    db.scalar(select(User).where(User.email == "sa@platform.com")).role = "superadmin"
    db.scalar(select(Studio).where(Studio.slug == "platform-sa")).is_platform = True   # the sender
    db.commit()
    return h


def test_a_message_from_the_company_reaches_the_owners_by_whatsapp_and_email(client, db_session, monkeypatch):
    sa = _superadmin(client, db_session)
    register_and_login(client, slug="shop-a", email="dana@shop-a.com")
    register_and_login(client, slug="shop-b", email="ron@shop-b.com")
    a = db_session.scalar(select(Studio).where(Studio.slug == "shop-a"))
    b = db_session.scalar(select(Studio).where(Studio.slug == "shop-b"))
    a.name, a.subscription_plan = "מספרת דנה", "pro"
    owner_a = db_session.scalar(select(User).where(User.email == "dana@shop-a.com"))
    owner_a.display_name, owner_a.phone = "דנה", "0501234567"
    db_session.commit()

    keys = [t["key"] for t in client.get("/api/admin/crm/templates", headers=sa).json()]
    assert keys == ["welcome", "trial_ending", "payment_reminder", "tip", "win_back"]
    assert client.put("/api/admin/crm/templates/tip", headers=sa,
                      json={"name": "טיפ", "email_subject": "טיפ", "body": "היי {owner_name}"}).status_code == 200

    r = client.post("/api/admin/crm/send", headers=sa, json={
        "studio_ids": [str(a.id), str(b.id)], "channel": "both",
        "body": "היי {owner_name}, {business_name} במסלול {plan}", "subject": "עדכון ל-{business_name}"})
    assert r.status_code == 200, r.text
    assert r.json() == {"queued": 3, "skipped": [{"name": "Studio shop-b", "reason": "אין לבעל העסק טלפון"}]}

    # fake senders (nothing is sent) that keep how each message went out
    went = []
    monkeypatch.setattr(mw, "send_whatsapp_message", lambda to, body, settings=None, **k: went.append(
        ("whatsapp", to, settings, k.get("footer"))))
    monkeypatch.setattr(ec, "send_email", lambda db, **k: went.append(
        ("email", k["to_email"], k["from_name"], k["email_type"], k["html_content"])) or True)
    process_due_jobs(db_session)
    # WhatsApp from BizControl's own number (no business's settings), without the "don't reply" line;
    # e-mail in BizControl's name, its lines kept
    assert ("whatsapp", "0501234567", None, False) in went
    email = next(w for w in went if w[:2] == ("email", "dana@shop-a.com"))
    assert email[2:4] == ("BizControl", "system") and email[4].endswith("היי דנה, מספרת דנה במסלול פרו</div>")
    assert sorted(w[:2] for w in went) == [("email", "dana@shop-a.com"), ("email", "ron@shop-b.com"), ("whatsapp", "0501234567")]
    log = client.get(f"/api/admin/crm/sent?studio_id={a.id}", headers=sa).json()
    assert sorted((m["channel"], m["status"]) for m in log) == [("email", "sent"), ("whatsapp", "sent")]
    assert next(m for m in log if m["channel"] == "whatsapp")["body"] == "היי דנה, מספרת דנה במסלול פרו"
    sent_email = next(m for m in log if m["channel"] == "email")
    assert (sent_email["subject"], sent_email["body"]) == ("עדכון ל-מספרת דנה", "היי דנה, מספרת דנה במסלול פרו")

    owner = register_and_login(client, slug="shop-c", email="c@shop-c.com")
    assert client.post("/api/admin/crm/send", headers=owner, json={"studio_ids": [str(a.id)], "channel": "email",
                                                                    "body": "x"}).status_code == 403
