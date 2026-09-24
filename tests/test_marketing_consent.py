"""Marketing only reaches clients who may receive it; service messages are unaffected. No database, nothing sent."""
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from app.models.client import Client
from app.models.message_job import MessageJob
from app.services import marketing, message_worker
from app.services.marketing import (
    MARKETING_TYPES, SERVICE_TYPES, broadcast_recipients_query, is_classified, is_marketing, may_receive_marketing,
    refusal_reason,
)

APP = Path(__file__).resolve().parents[1] / "app"


def client(consent=True, opted_out=False, active=True):
    return Client(id=uuid.uuid4(), studio_id=uuid.uuid4(), full_name="בדיקה", phone="0501234567",
                  marketing_consent=consent, whatsapp_opted_out=opted_out, is_active=active)


def test_who_may_receive_marketing():
    assert may_receive_marketing(client())
    assert refusal_reason(client(consent=False)) == "הלקוח לא אישר קבלת הודעות שיווקיות"
    assert refusal_reason(client(opted_out=True)) == "הלקוח הסיר את עצמו מהודעות שיווקיות"
    assert refusal_reason(client(active=False)) == "הלקוח לא פעיל"
    assert not may_receive_marketing(None)


def test_classification():
    for t in ("broadcast", "club_invite", "club_invite_email", "birthday_manual", "birthday-2026-09", "birthday_email-2026-09"):
        assert is_marketing(t), t
    for t in ("1day", "same_day", "appointment_cancelled", "aftercare", "post_payment", "pos_receipt",
              "waitlist_notify", "club_welcome", "manual", None):
        assert not is_marketing(t), t
    assert not MARKETING_TYPES & SERVICE_TYPES


def test_every_message_type_in_the_code_is_classified():
    """A new reminder_type must be put in MARKETING_TYPES or SERVICE_TYPES on purpose."""
    literals, prefixes = set(), set()
    for path in APP.rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        literals |= set(re.findall(r'reminder_type\s*=\s*"([^"{}]+)"', src))
        prefixes |= set(re.findall(r'reminder_type\w*\s*=\s*f"([a-z_\-]+)\{', src))
    assert literals, "found no reminder types — the scan is broken"
    unclassified = sorted(t for t in literals if not is_classified(t))
    assert not unclassified, f"classify these in app/services/marketing.py: {unclassified}"
    unclassified_prefixes = sorted(p for p in prefixes if not is_classified(p + "x"))
    assert not unclassified_prefixes, f"classify these prefixes in app/services/marketing.py: {unclassified_prefixes}"


# Messages queued WITHOUT a reminder_type are treated as service messages by the dispatcher. These are
# the only places allowed to do that — all of them service (the client's own booking, payment, club
# sign-up, or a message to staff). A new one must either set a classified reminder_type or be added
# here on purpose.
UNTYPED_SERVICE_SITES = {
    ("api/booking_request_routes.py", "approve_request"),
    ("api/booking_request_routes.py", "reject_request"),
    ("api/client_routes.py", "send_points_balance"),
    ("api/public_routes.py", "_notify_booking_request"),
    ("crud/automation.py", "enqueue_confirmation_message"),
    ("crud/automation.py", "enqueue_deposit_approved_message"),
    ("crud/automation.py", "enqueue_reschedule_message"),
    ("crud/automation.py", "enqueue_cancel_message"),
    ("crud/automation.py", "enqueue_aftercare_if_needed"),
    ("crud/client.py", "_handle_new_club_member"),   # the club welcome e-mail
}


def test_messages_without_a_type_are_only_known_service_messages():
    found = set()
    for path in APP.rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        for m in re.finditer(r"MessageJob\(", src):
            i, depth = m.end(), 1
            while depth and i < len(src):
                depth += {"(": 1, ")": -1}.get(src[i], 0)
                i += 1
            call = src[m.start():i]
            if "=" not in call or "reminder_type" in call:
                continue   # a query, or a typed message (covered by the registry test above)
            fns = re.findall(r"^\s*def (\w+)", src[:m.start()], re.M)
            found.add((path.relative_to(APP).as_posix(), fns[-1] if fns else "?"))
    assert found, "found no untyped messages — the scan is broken"
    unexpected = sorted(found - UNTYPED_SERVICE_SITES)
    assert not unexpected, f"these queue a message without reminder_type — give it a classified type: {unexpected}"


def test_broadcast_audience_requires_consent_and_no_opt_out():
    sql = str(broadcast_recipients_query(uuid.uuid4(), "all").compile(dialect=postgresql.dialect()))
    assert "clients.marketing_consent IS true" in sql
    assert "clients.whatsapp_opted_out IS false" in sql
    assert "clients.is_active IS true" in sql
    assert "clients.phone IS NOT NULL" in sql
    club = str(broadcast_recipients_query(uuid.uuid4(), "club").compile(dialect=postgresql.dialect()))
    assert "clients.is_club_member IS true" in club and "clients.marketing_consent IS true" in club


def test_both_broadcast_paths_use_the_shared_audience():
    """The count shown when scheduling and the actual send must be the same query."""
    for rel in ("api/broadcast_routes.py", "main.py"):
        src = (APP / rel).read_text(encoding="utf-8")
        assert "broadcast_recipients_query(" in src, rel
        assert "whatsapp_opted_out == False" not in src, f"{rel} filters recipients on its own again"


class _FakeDB:
    """Just enough of a Session for process_due_jobs: the due jobs, clients by id, commits ignored."""
    def __init__(self, jobs, clients):
        self.jobs, self.clients = jobs, {c.id: c for c in clients}

    def scalars(self, _stmt):
        return SimpleNamespace(all=lambda: list(self.jobs))

    def get(self, model, key):
        return self.clients.get(key) if model is Client else None

    def commit(self):
        pass


def _job(c, reminder_type, channel="whatsapp"):
    return MessageJob(id=uuid.uuid4(), studio_id=c.studio_id, client_id=c.id, channel=channel,
                      to_phone=c.phone if channel == "whatsapp" else "x@example.com", body="שלום",
                      scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=1), status="pending",
                      reminder_type=reminder_type, attempts=0)


@pytest.fixture
def sent(monkeypatch):
    """Record instead of sending — nothing leaves the machine."""
    out = []
    monkeypatch.setattr(message_worker, "send_whatsapp_message", lambda to, body, *a, **k: out.append(("whatsapp", to)))
    import app.services.email_center as ec
    monkeypatch.setattr(ec, "send_email", lambda db, **kw: out.append(("email", kw["to_email"])) or True)
    return out


def test_dispatcher_blocks_marketing_to_clients_who_may_not_receive_it(sent):
    ok, no_consent, opted_out = client(), client(consent=False), client(opted_out=True)
    jobs = {
        "ok_broadcast": _job(ok, "broadcast"),
        "no_consent_broadcast": _job(no_consent, "broadcast"),
        "opted_out_broadcast": _job(opted_out, "broadcast"),
        "no_consent_birthday_email": _job(no_consent, "birthday_email-2026-09", channel="email"),
        "no_consent_club_invite": _job(no_consent, "club_invite"),
    }
    message_worker.process_due_jobs(_FakeDB(jobs.values(), [ok, no_consent, opted_out]))
    assert jobs["ok_broadcast"].status == "sent"
    for k in ("no_consent_broadcast", "opted_out_broadcast", "no_consent_birthday_email", "no_consent_club_invite"):
        assert jobs[k].status == "canceled", k
        assert jobs[k].last_error.startswith("הודעה שיווקית לא נשלחה"), k
    assert sent == [("whatsapp", ok.phone)]


def test_dispatcher_leaves_service_messages_as_they_were(sent):
    no_consent, opted_out = client(consent=False), client(opted_out=True)
    reminder = _job(no_consent, "1day")
    cancel_notice = _job(no_consent, "appointment_cancelled")
    opted_out_reminder = _job(opted_out, "1day")
    message_worker.process_due_jobs(_FakeDB([reminder, cancel_notice, opted_out_reminder], [no_consent, opted_out]))
    assert reminder.status == "sent" and cancel_notice.status == "sent"
    # existing rule, unchanged: an opted-out client gets no WhatsApp at all
    assert opted_out_reminder.status == "canceled" and opted_out_reminder.last_error == "Client opted out of WhatsApp"


def test_marketing_module_is_the_only_definition():
    """The enqueue-side checks all go through app/services/marketing.py."""
    for rel, needle in (("crud/automation.py", "may_receive_marketing(client)"),
                        ("services/message_worker.py", "may_receive_marketing(client)"),
                        ("crud/client.py", "may_receive_marketing(client)"),
                        ("api/customer_club_routes.py", "refusal_reason(client)")):
        assert needle in (APP / rel).read_text(encoding="utf-8"), rel
    assert marketing.MARKETING_PREFIXES == ("birthday-", "birthday_email-")
