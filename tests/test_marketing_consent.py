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
    monkeypatch.setattr(marketing, "unsubscribe_link", lambda db, sid, cid, commit=True: f"https://x.test/optout/{str(cid)[:8]}")
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
    assert "/optout/" in jobs["ok_broadcast"].body, "a marketing message goes out with an unsubscribe link"
    for k in ("no_consent_broadcast", "opted_out_broadcast", "no_consent_birthday_email", "no_consent_club_invite"):
        assert jobs[k].status == "canceled", k
        assert jobs[k].last_error.startswith("הודעה שיווקית לא נשלחה"), k
    assert sent == [("whatsapp", ok.phone)]


def test_every_marketing_message_gets_an_unsubscribe_link(sent):
    c = client()
    wa = _job(c, "birthday-2026-09")
    mail = _job(c, "birthday_email-2026-09", channel="email")
    mail.body = "<html><body><p>מזל טוב</p></body></html>"
    placed = _job(c, "club_invite")
    placed.body = "הצטרפו! להסרה: {optout_link}"
    already = _job(c, "broadcast")
    already.body = "מבצע\n\nלהסרה מרשימת התפוצה: https://x.test/optout/abc"
    for j in (wa, mail, placed, already):
        marketing.ensure_unsubscribe_option(None, j)
    assert wa.body.startswith("שלום") and "להסרה מהודעות שיווקיות: https://x.test/optout/" in wa.body
    assert mail.body.index("/optout/") < mail.body.index("</body>")
    assert placed.body.startswith("הצטרפו! להסרה: https://x.test/optout/") and "{optout_link}" not in placed.body
    assert already.body.count("/optout/") == 1
    service = _job(c, "1day")
    message_worker.process_due_jobs(_FakeDB([service], [c]))
    assert service.status == "sent" and "/optout/" not in service.body, "service messages get no unsubscribe footer"


def test_dispatcher_sends_service_messages_whatever_the_marketing_flags(sent):
    no_consent, opted_out = client(consent=False), client(opted_out=True)
    reminder = _job(no_consent, "1day")
    cancel_notice = _job(no_consent, "appointment_cancelled")
    # the owner's decision (2026-09-24): unsubscribing stops marketing only — a reminder is a must
    opted_out_reminder = _job(opted_out, "1day")
    opted_out_confirmation = _job(opted_out, None)   # confirmations are queued without a type
    message_worker.process_due_jobs(_FakeDB([reminder, cancel_notice, opted_out_reminder, opted_out_confirmation],
                                            [no_consent, opted_out]))
    for j in (reminder, cancel_notice, opted_out_reminder, opted_out_confirmation):
        assert j.status == "sent", (j.reminder_type, j.status, j.last_error)
    assert len(sent) == 4


# The two marketing flags may be READ only by the marketing rule — anywhere else they would stop
# service messages again. Declaring and setting them is fine: these are the files that do.
FLAG_ALLOWED = {
    "whatsapp_opted_out": {
        "services/marketing.py",   # the rule
        "models/client.py", "schemas/client.py", "main.py",   # the column itself
        "crud/client.py",          # the client card switch sets it
        "api/invite_routes.py",    # the unsubscribe link sets it
    },
    "marketing_consent": {
        "services/marketing.py",   # the rule
        "models/client.py", "schemas/client.py",   # the column itself
        "api/public_routes.py",    # the club sign-up form sets it
        "api/client_routes.py",    # the walk-in client is created without it
        "migration/normalize.py", "migration/universal.py", "migration/writers.py",   # data import sets it
    },
}


@pytest.mark.parametrize("flag", sorted(FLAG_ALLOWED))
def test_only_the_marketing_rule_reads_the_marketing_flags(flag):
    users = {p.relative_to(APP).as_posix() for p in APP.rglob("*.py") if flag in p.read_text(encoding="utf-8")}
    assert "services/marketing.py" in users
    unexpected = sorted(users - FLAG_ALLOWED[flag])
    assert not unexpected, f"these read {flag} — use app/services/marketing.py instead: {unexpected}"


def test_daily_birthday_sweep_runs_and_only_reaches_clients_who_may_receive_marketing(monkeypatch):
    """Regression: the sweep read client.name (Client has no such field) and crashed on the first
    eligible client from 2026-05-23 until 2026-09-24 — no automatic birthday message went out."""
    import app.crud.birthday_coupon as bc
    import app.services.email_center as ec
    monkeypatch.setattr(bc, "get_or_create_birthday_coupon", lambda db, **kw: SimpleNamespace(code="TAL10"))
    monkeypatch.setattr(ec, "studio_email_allowed", lambda *a, **k: False)
    settings = SimpleNamespace(birthday_automation_enabled=True, birthday_benefit_percent=10, birthday_wa_template=None)
    ok, no_consent = client(), client(consent=False)
    ok.full_name, ok.birth_date = "טל", datetime(1990, 3, 14).date()
    no_consent.birth_date = ok.birth_date
    added = []

    class _DB:
        def execute(self, _stmt):
            return SimpleNamespace(all=lambda: [(ok, settings), (no_consent, settings)])

        def scalar(self, _stmt):
            return None

        def add(self, obj):
            added.append(obj)

        def commit(self):
            pass

    assert message_worker.sweep_birthday_messages(_DB()) == 1
    (job,) = added
    assert job.client_id == ok.id and job.channel == "whatsapp"
    assert job.reminder_type.startswith("birthday-") and is_marketing(job.reminder_type)
    assert "טל" in job.body and "TAL10" in job.body


def test_marketing_module_is_the_only_definition():
    """The enqueue-side checks all go through app/services/marketing.py."""
    for rel, needle in (("crud/automation.py", "may_receive_marketing(client)"),
                        ("services/message_worker.py", "may_receive_marketing(client)"),
                        ("crud/client.py", "may_receive_marketing(client)"),
                        ("api/customer_club_routes.py", "refusal_reason(client)")):
        assert needle in (APP / rel).read_text(encoding="utf-8"), rel
    assert marketing.MARKETING_PREFIXES == ("birthday-", "birthday_email-")
