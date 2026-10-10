"""
The health declaration (app/models/health_form.py): the business's form, a client's declaration and its two
signatures. A declaration is opened from an appointment or a client's file, filled and signed by the client on the
studio's device or from a link sent on WhatsApp, and signed after by the one giving the service.
"""
from __future__ import annotations

import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.health_form import HealthDeclaration, HealthForm, HealthFormFile

DEFAULT_TITLE = "הצהרת בריאות"
DEFAULT_INTRO = ("לפני הטיפול נבקש לענות על השאלות הבאות. המידע נשמר אצלנו בלבד, "
                 "ומשמש כדי לשמור על בריאותך ולהתאים את הטיפול אלייך.")
DEFAULT_QUESTIONS = [
    "האם את/ה סובל/ת ממחלת לב או מלחץ דם גבוה או נמוך?",
    "האם את/ה חולה בסוכרת?",
    "האם יש לך הפרעה בקרישת הדם, או שאת/ה נוטל/ת תרופות לדילול דם?",
    "האם את/ה סובל/ת מאפילפסיה או מנטייה להתעלף?",
    "האם יש לך אלרגיה — ללטקס, לצבעים, למתכות, לתרופות, למשחות הרדמה או לכל חומר אחר?",
    "האם את/ה נוטל/ת תרופות באופן קבוע (כולל טיפול באקנה, כמו רואקוטן)?",
    "האם יש לך מחלת עור, פצע, צלקת או שומה באזור הטיפול?",
    "האם יש לך נטייה לצלקות מוגדלות (קלואידים)?",
    "האם את/ה חולה במחלה זיהומית (כמו צהבת) או במחלה שפוגעת במערכת החיסון?",
    "האם את בהריון או מניקה?",
    "האם שתית אלכוהול או השתמשת בסמים ב-24 השעות האחרונות?",
]
DEFAULT_CLOSING = ("אני מצהיר/ה שכל הפרטים שמסרתי נכונים ומלאים, ושאעדכן את העסק לפני הטיפול על כל שינוי "
                   "במצב הבריאות שלי.")

STATUSES = ("waiting_client", "waiting_performer", "signed")
KINDS = ("yes_no", "text")
FILE_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_SIGNATURE_CHARS = 400_000                 # a PNG data URL of a finger signature is a few dozen KB
LINK_DAYS = 14


def _default_questions() -> list[dict]:
    return [{"id": f"q{i + 1}", "text": t, "kind": "yes_no"} for i, t in enumerate(DEFAULT_QUESTIONS)] + [
        {"id": "q_more", "text": "יש מידע רפואי נוסף שחשוב שנדע?", "kind": "text"}]


def form(db: Session, studio_id) -> dict:
    """The business's form — the ready-made one until it saves its own."""
    f = db.scalar(select(HealthForm).where(HealthForm.studio_id == studio_id))
    file = db.get(HealthFormFile, f.file_id) if f and f.file_id else None
    if f is None:
        return {"title": DEFAULT_TITLE, "intro": DEFAULT_INTRO, "questions": _default_questions(),
                "closing": DEFAULT_CLOSING, "ask_id_number": True, "file": None, "saved": False}
    return {"title": f.title, "intro": f.intro, "questions": f.questions, "closing": f.closing,
            "ask_id_number": f.ask_id_number, "saved": True,
            "file": {"id": str(file.id), "filename": file.filename, "content_type": file.content_type} if file else None}


def clean_questions(questions: list[dict]) -> list[dict]:
    """Each question kept with an id of its own, a text and a kind; empty ones dropped."""
    out, seen = [], set()
    for q in questions:
        text = (q.get("text") or "").strip()
        if not text:
            continue
        qid = str(q.get("id") or "").strip()[:20]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", qid or "-") or not qid or qid in seen:
            qid = "q" + secrets.token_hex(4)
        seen.add(qid)
        out.append({"id": qid, "text": text[:500], "kind": q.get("kind") if q.get("kind") in KINDS else "yes_no"})
    return out


def save_form(db: Session, studio_id, *, title: str, intro: str, questions: list[dict], closing: str,
              ask_id_number: bool, file_id: str | None) -> dict:
    questions = clean_questions(questions)
    if not questions and not file_id and not intro.strip():
        raise ValueError("הטופס ריק — כתבו שאלות, טקסט, או צרפו קובץ")
    fid = None
    if file_id:
        fid = uuid.UUID(file_id)
        if db.scalar(select(HealthFormFile.id).where(HealthFormFile.id == fid, HealthFormFile.studio_id == studio_id)) is None:
            raise ValueError("הקובץ לא נמצא")
    f = db.scalar(select(HealthForm).where(HealthForm.studio_id == studio_id))
    if f is None:
        f = HealthForm(studio_id=studio_id)
        db.add(f)
    f.title, f.intro, f.questions, f.closing = title.strip() or DEFAULT_TITLE, intro.strip(), questions, closing.strip()
    f.ask_id_number, f.file_id = ask_id_number, fid
    db.commit()
    return form(db, studio_id)


def add_file(db: Session, studio_id, filename: str, content_type: str, data: bytes) -> dict:
    if content_type not in FILE_TYPES:
        raise ValueError("אפשר לצרף PDF או תמונה (JPG / PNG)")
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("הקובץ גדול מדי — עד 8MB")
    f = HealthFormFile(studio_id=studio_id, filename=(filename or "file")[:200], content_type=content_type, data=data)
    db.add(f)
    db.commit()
    return {"id": str(f.id), "filename": f.filename, "content_type": f.content_type}


def get_file(db: Session, studio_id, file_id) -> HealthFormFile | None:
    return db.scalar(select(HealthFormFile).where(HealthFormFile.id == file_id, HealthFormFile.studio_id == studio_id))


def open_declaration(db: Session, studio_id, client_id, appointment_id, created_by) -> HealthDeclaration:
    """A new declaration on the form as it is now. An appointment's open one is reused, not doubled."""
    from app.models.appointment import Appointment
    from app.models.client import Client

    client = db.get(Client, client_id)
    if client is None or client.studio_id != studio_id:
        raise LookupError("הלקוח לא נמצא")
    if appointment_id is not None:
        appt = db.get(Appointment, appointment_id)
        if appt is None or appt.studio_id != studio_id:
            raise LookupError("התור לא נמצא")
        if appt.client_id != client.id:
            raise ValueError("התור שייך ללקוח אחר")
        existing = db.scalar(select(HealthDeclaration).where(
            HealthDeclaration.appointment_id == appointment_id, HealthDeclaration.status != "signed")
            .order_by(HealthDeclaration.created_at.desc()))
        if existing is not None:
            return existing
    f = form(db, studio_id)
    d = HealthDeclaration(
        studio_id=studio_id, client_id=client.id, appointment_id=appointment_id, status="waiting_client",
        title=f["title"], intro=f["intro"], questions=f["questions"], closing=f["closing"],
        ask_id_number=f["ask_id_number"], file_id=uuid.UUID(f["file"]["id"]) if f["file"] else None,
        token=secrets.token_urlsafe(24), token_expires_at=datetime.now(timezone.utc) + timedelta(days=LINK_DAYS),
        created_by_id=created_by,
    )
    db.add(d)
    db.commit()
    return d


def _check_signature(sig: str) -> str:
    if not sig or not sig.startswith("data:image/png;base64,") or len(sig) > MAX_SIGNATURE_CHARS:
        raise ValueError("חסרה חתימה")
    return sig


def client_signs(db: Session, d: HealthDeclaration, *, answers: dict, id_number: str | None, signature: str,
                 via: str, ip: str | None, device: str | None) -> HealthDeclaration:
    if d.status != "waiting_client":
        raise ValueError("ההצהרה כבר נחתמה")
    clean: dict = {}
    for q in d.questions:
        a = answers.get(q["id"]) or {}
        if q["kind"] == "yes_no":
            if a.get("answer") not in ("yes", "no"):
                raise ValueError(f"לא נענתה השאלה: {q['text']}")
            clean[q["id"]] = {"answer": a["answer"], "details": (a.get("details") or "").strip()[:1000]}
        else:
            clean[q["id"]] = {"text": (a.get("text") or "").strip()[:2000]}
    id_number = re.sub(r"\D", "", id_number or "")
    if d.ask_id_number and not 5 <= len(id_number) <= 9:
        raise ValueError("מספר תעודת זהות לא תקין")
    d.answers, d.id_number = clean, id_number or None
    d.client_signature = _check_signature(signature)
    d.client_signed_at, d.client_signed_via = datetime.now(timezone.utc), via
    d.client_ip, d.client_device = (ip or "")[:64] or None, (device or "")[:300] or None
    d.status, d.token_expires_at = "waiting_performer", datetime.now(timezone.utc)   # the link closes once filled
    db.commit()
    return d


def performer_signs(db: Session, d: HealthDeclaration, user, signature: str) -> HealthDeclaration:
    if d.status == "waiting_client":
        raise ValueError("הלקוח עוד לא מילא וחתם")
    if d.status == "signed":
        raise ValueError("ההצהרה כבר חתומה")
    d.performer_signature = _check_signature(signature)
    d.performer_user_id, d.performer_name = user.id, (user.display_name or user.email)[:120]
    d.performer_signed_at, d.status = datetime.now(timezone.utc), "signed"
    db.commit()
    return d


def get(db: Session, studio_id, declaration_id) -> HealthDeclaration | None:
    return db.scalar(select(HealthDeclaration).where(HealthDeclaration.id == declaration_id,
                                                     HealthDeclaration.studio_id == studio_id))


def listing(db: Session, studio_id, *, client_id=None, appointment_id=None) -> list[dict]:
    from app.models.appointment import Appointment
    q = select(HealthDeclaration, Appointment.starts_at, Appointment.title).outerjoin(
        Appointment, Appointment.id == HealthDeclaration.appointment_id).where(HealthDeclaration.studio_id == studio_id)
    if client_id is not None:
        q = q.where(HealthDeclaration.client_id == client_id)
    if appointment_id is not None:
        q = q.where(HealthDeclaration.appointment_id == appointment_id)
    rows = db.execute(q.order_by(HealthDeclaration.created_at.desc())).all()
    return [summary(d, starts_at, title) for d, starts_at, title in rows]


def summary(d: HealthDeclaration, appt_starts_at=None, appt_title=None) -> dict:
    yes = [q["text"] for q in d.questions if q["kind"] == "yes_no" and ((d.answers or {}).get(q["id"]) or {}).get("answer") == "yes"]
    return {
        "id": str(d.id), "status": d.status, "title": d.title, "appointment_id": str(d.appointment_id) if d.appointment_id else None,
        "appointment_at": appt_starts_at.isoformat() if appt_starts_at else None, "appointment_title": appt_title,
        "client_signed_at": d.client_signed_at.isoformat() if d.client_signed_at else None,
        "client_signed_via": d.client_signed_via, "performer_name": d.performer_name,
        "performer_signed_at": d.performer_signed_at.isoformat() if d.performer_signed_at else None,
        "link_sent_at": d.link_sent_at.isoformat() if d.link_sent_at else None, "link": link(d),
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "flagged": yes,                        # the questions answered "yes" — what the one giving the service should see
    }


def full(db: Session, d: HealthDeclaration) -> dict:
    """Everything, for filling and for the signed document."""
    from app.models.client import Client
    from app.models.studio import Studio
    client = db.get(Client, d.client_id)
    studio = db.get(Studio, d.studio_id)
    file = db.get(HealthFormFile, d.file_id) if d.file_id else None
    return {
        **summary(d), "intro": d.intro, "questions": d.questions, "closing": d.closing, "ask_id_number": d.ask_id_number,
        "answers": d.answers, "id_number": d.id_number, "client_signature": d.client_signature,
        "performer_signature": d.performer_signature, "client_ip": d.client_ip, "client_device": d.client_device,
        "client_id": str(d.client_id), "client_name": client.full_name if client else "",
        "client_phone": client.phone if client else None, "business_name": studio.name if studio else "",
        "file": {"id": str(file.id), "filename": file.filename, "content_type": file.content_type} if file else None,
    }


def link(d: HealthDeclaration) -> str | None:
    """The address the client fills it from — while it waits for them."""
    if d.status != "waiting_client" or not d.token:
        return None
    return f"{os.getenv('FRONTEND_URL', 'https://bizcontrol-seven.vercel.app').rstrip('/')}/health/{d.token}"


def send_link(db: Session, d: HealthDeclaration) -> None:
    """The link to the client on WhatsApp — a service message through the queue, from the business's own number;
    the link is good for LINK_DAYS from now (a resend renews it)."""
    import pytz
    from app.models.appointment import Appointment
    from app.models.client import Client
    from app.models.message_job import MessageJob
    from app.models.studio import Studio

    if d.status != "waiting_client":
        raise ValueError("ההצהרה כבר מולאה")
    client = db.get(Client, d.client_id)
    if client is None or not client.phone:
        raise ValueError("ללקוח אין מספר טלפון")
    studio = db.get(Studio, d.studio_id)
    now = datetime.now(timezone.utc)
    d.token_expires_at, d.link_sent_at = now + timedelta(days=LINK_DAYS), now
    first = (client.full_name or "").split()[0] if (client.full_name or "").strip() else ""
    appt = db.get(Appointment, d.appointment_id) if d.appointment_id else None
    if appt is not None:
        local = appt.starts_at.astimezone(pytz.timezone("Asia/Jerusalem"))
        before = f"לקראת התור שלך ב-{studio.name} ב-{local.strftime('%d/%m')} בשעה {local.strftime('%H:%M')}"
    else:
        before = f"לפני הטיפול ב-{studio.name}"
    body = f"היי {first}, {before} — נבקש למלא הצהרת בריאות קצרה ולחתום. זה לוקח דקה:\n{link(d)}"
    db.add(MessageJob(studio_id=d.studio_id, client_id=d.client_id, appointment_id=d.appointment_id, channel="whatsapp",
                      to_phone=client.phone, body=body.replace("היי , ", "היי, "), reminder_type="health_form",
                      scheduled_at=now, status="pending"))
    db.commit()


def by_token(db: Session, token: str) -> HealthDeclaration:
    d = db.scalar(select(HealthDeclaration).where(HealthDeclaration.token == token)) if token else None
    if d is None:
        raise LookupError("הקישור לא נמצא")
    return d


def link_open(d: HealthDeclaration) -> bool:
    return d.status == "waiting_client" and d.token_expires_at is not None and d.token_expires_at > datetime.now(timezone.utc)


def public_view(db: Session, d: HealthDeclaration) -> dict:
    """What the link shows the client: the form to fill — only while it waits for them; nothing of what was signed."""
    from app.models.appointment import Appointment
    from app.models.client import Client
    from app.models.studio import Studio
    studio = db.get(Studio, d.studio_id)
    business = studio.name if studio else ""
    if d.status != "waiting_client":
        return {"status": "signed", "business_name": business}
    if not link_open(d):
        return {"status": "expired", "business_name": business}
    client = db.get(Client, d.client_id)
    appt = db.get(Appointment, d.appointment_id) if d.appointment_id else None
    file = db.get(HealthFormFile, d.file_id) if d.file_id else None
    return {
        "status": "waiting_client", "business_name": business, "client_name": client.full_name if client else "",
        "title": d.title, "intro": d.intro, "questions": d.questions, "closing": d.closing, "ask_id_number": d.ask_id_number,
        "appointment_at": appt.starts_at.isoformat() if appt else None,
        "file": {"id": str(file.id), "filename": file.filename, "content_type": file.content_type} if file else None,
    }


def cancel(db: Session, d: HealthDeclaration) -> None:
    """Only one nobody signed yet — a signed declaration is a record and stays."""
    if d.status != "waiting_client":
        raise ValueError("אי אפשר למחוק הצהרה שכבר נחתמה")
    db.delete(d)
    db.commit()
