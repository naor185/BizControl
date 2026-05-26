"""
Safe AI tools — the only way the AI can access business data.
Every tool enforces studio isolation and returns sanitized data only.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone, timedelta
from uuid import UUID
from typing import Any

from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.payment import Payment
from app.models.user import User


# ── OpenAI tool schemas ────────────────────────────────────────────────────────

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_today_appointments",
            "description": "מחזיר את רשימת התורים להיום בסטודיו — כמה יש, מי הלקוחות, ומה הסטטוס.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_monthly_revenue",
            "description": "מחזיר את סך ההכנסות לחודש מסוים. ברירת מחדל — החודש הנוכחי.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year":  {"type": "integer", "description": "שנה (לדוגמה 2026)"},
                    "month": {"type": "integer", "description": "חודש 1-12"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_client",
            "description": "חיפוש לקוח לפי שם או מספר טלפון — מחזיר נקודות, חברות במועדון, וסטטיסטיקות.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "שם או מספר טלפון לחיפוש"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_stats",
            "description": "מחזיר סטטיסטיקות כלליות של הסטודיו: מספר לקוחות, הכנסה חודשית, תורים היום.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_wallet_status",
            "description": "בודק האם Apple Wallet ו-Google Wallet מוגדרים ומוכנים לשימוש.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_inactive_clients",
            "description": "מחזיר לקוחות שלא ביקרו בסטודיו מזמן — לזיהוי לקוחות לא פעילים.",
            "parameters": {
                "type": "object",
                "properties": {
                    "months": {"type": "integer", "description": "כמה חודשים אחורה לבדוק (ברירת מחדל: 2)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_artists",
            "description": "מחזיר סטטיסטיקות ביצועים לכל עובד/אמן בסטודיו לחודש מסוים.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year":  {"type": "integer", "description": "שנה (ברירת מחדל: שנה נוכחית)"},
                    "month": {"type": "integer", "description": "חודש 1-12 (ברירת מחדל: חודש נוכחי)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_system_help",
            "description": "מסביר כיצד להשתמש בפיצ'ר מסוים במערכת BizControl.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "הנושא לעזרה (לדוגמה: wallet, clients, automation, staff)"},
                },
                "required": ["topic"],
            },
        },
    },
]

# artist/staff get a subset
ARTIST_TOOLS_SCHEMA = [t for t in TOOLS_SCHEMA if t["function"]["name"] in (
    "get_system_help",
)]


# ── Tool implementations ───────────────────────────────────────────────────────

def get_today_appointments(studio_id: UUID, db: Session, **_) -> dict:
    import pytz
    il_tz = pytz.timezone("Asia/Jerusalem")
    today_il = datetime.now(il_tz).date()
    today_start = il_tz.localize(datetime(today_il.year, today_il.month, today_il.day, 0, 0, 0)).astimezone(timezone.utc)
    today_end = today_start + timedelta(days=1)

    rows = db.scalars(
        select(Appointment)
        .where(
            Appointment.studio_id == studio_id,
            Appointment.starts_at >= today_start,
            Appointment.starts_at < today_end,
        )
        .order_by(Appointment.starts_at)
    ).all()

    items = [
        {
            "time": a.starts_at.strftime("%H:%M"),
            "title": a.title,
            "status": a.status,
        }
        for a in rows
    ]

    import pytz
    il_tz = pytz.timezone("Asia/Jerusalem")
    today_label = datetime.now(il_tz).strftime("%d/%m/%Y")
    total = len(rows)
    scheduled = sum(1 for a in rows if a.status == "scheduled")
    done = sum(1 for a in rows if a.status == "done")
    canceled = sum(1 for a in rows if a.status == "canceled")

    if total == 0:
        answer = f"היום ({today_label}) אין אף תור מתוכנן. אין תורים בכלל — זה מידע תקין ומאומת מהמסד."
    else:
        answer = f"היום ({today_label}) יש {total} תורים: {scheduled} מתוכננים, {done} הושלמו, {canceled} בוטלו."

    return {
        "date": today_label,
        "total": total,
        "scheduled": scheduled,
        "done": done,
        "canceled": canceled,
        "appointments": items[:20],
        "answer": answer,
    }


def get_monthly_revenue(studio_id: UUID, db: Session, year: int | None = None, month: int | None = None, **_) -> dict:
    now = datetime.now(timezone.utc)
    year = year or now.year
    month = month or now.month

    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)

    total_cents = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0))
        .where(
            Payment.studio_id == studio_id,
            Payment.status == "paid",
            Payment.type != "refund",
            Payment.created_at >= start,
            Payment.created_at < end,
        )
    ) or 0

    refund_cents = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0))
        .where(
            Payment.studio_id == studio_id,
            Payment.status == "paid",
            Payment.type == "refund",
            Payment.created_at >= start,
            Payment.created_at < end,
        )
    ) or 0

    net_cents = total_cents - refund_cents

    month_label = f"{_month_name(month)} {year}"
    if net_cents == 0:
        answer = f"ב{month_label} אין הכנסות רשומות עדיין."
    else:
        net_ils = round(net_cents / 100, 2)
        answer = f"הכנסות {month_label}: ₪{net_ils:,.2f} נטו."
        if refund_cents:
            answer += f" (כולל החזרים של ₪{round(refund_cents / 100, 2):,.2f})"

    return {
        "year": year,
        "month": month,
        "month_name": _month_name(month),
        "gross_revenue": round(total_cents / 100, 2),
        "refunds": round(refund_cents / 100, 2),
        "net_revenue": round(net_cents / 100, 2),
        "currency": "ILS",
        "answer": answer,
    }


def search_client(studio_id: UUID, db: Session, query: str, **_) -> dict:
    q = f"%{query.strip()}%"
    clients = db.scalars(
        select(Client)
        .where(
            Client.studio_id == studio_id,
            Client.is_active == True,
            (Client.full_name.ilike(q)) | (Client.phone.ilike(q)),
        )
        .limit(5)
    ).all()

    if not clients:
        return {"found": False, "message": f"לא נמצא לקוח התואם ל-'{query}'", "answer": f"לא נמצא לקוח התואם ל'{query}'."}

    items = [
        {
            "name": c.full_name,
            "phone": c.phone or "—",
            "loyalty_points": c.loyalty_points,
            "is_club_member": c.is_club_member,
            "cancellations": c.cancellation_count,
            "no_shows": c.no_show_count,
        }
        for c in clients
    ]
    if len(items) == 1:
        c = items[0]
        answer = f"מצאתי: {c['name']} ({c['phone']}), נקודות: {c['loyalty_points']}, חבר מועדון: {'כן' if c['is_club_member'] else 'לא'}."
    else:
        names = ", ".join(i["name"] for i in items)
        answer = f"נמצאו {len(items)} לקוחות התואמים ל'{query}': {names}."

    return {
        "found": True,
        "count": len(clients),
        "clients": items,
        "answer": answer,
    }


def get_dashboard_stats(studio_id: UUID, db: Session, **_) -> dict:
    total_clients = db.scalar(
        select(func.count(Client.id)).where(Client.studio_id == studio_id, Client.is_active == True)
    ) or 0

    club_members = db.scalar(
        select(func.count(Client.id)).where(Client.studio_id == studio_id, Client.is_club_member == True)
    ) or 0

    rev = get_monthly_revenue(studio_id, db)
    appts = get_today_appointments(studio_id, db)

    return {
        "total_active_clients": total_clients,
        "club_members": club_members,
        "today_appointments": appts["total"],
        "today_scheduled": appts["scheduled"],
        "current_month_revenue": rev["net_revenue"],
        "currency": "ILS",
    }


def get_wallet_status(**_) -> dict:
    apple = all([
        os.getenv("APPLE_WALLET_PASS_TYPE_ID"),
        os.getenv("APPLE_WALLET_TEAM_ID"),
        os.getenv("APPLE_WALLET_CERT_PEM"),
    ])
    google = all([
        os.getenv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"),
        os.getenv("GOOGLE_WALLET_ISSUER_ID"),
    ])
    return {
        "apple_configured": apple,
        "google_configured": google,
        "status": "מוכן" if (apple and google) else "לא מוגדר במלואו",
        "note": "כדי להפעיל את ה-Wallet יש להגדיר את משתני הסביבה בסביבת הייצור." if not (apple and google) else "כפתורי Wallet יופיעו בפורטל הלקוחות.",
    }


def get_inactive_clients(studio_id: UUID, db: Session, months: int | None = None, **_) -> dict:
    months = max(1, min(months or 2, 12))
    cutoff = datetime.now(timezone.utc) - timedelta(days=months * 30)

    # Clients who haven't had a done appointment since cutoff
    active_since = db.scalars(
        select(Appointment.client_id)
        .where(
            Appointment.studio_id == studio_id,
            Appointment.status == "done",
            Appointment.starts_at >= cutoff,
        )
        .distinct()
    ).all()

    inactive = db.scalars(
        select(Client)
        .where(
            Client.studio_id == studio_id,
            Client.is_active == True,
            Client.id.notin_(active_since),
        )
        .order_by(Client.created_at.desc())
        .limit(10)
    ).all()

    items = [
        {"name": c.full_name, "phone": c.phone or "—", "points": c.loyalty_points}
        for c in inactive
    ]
    if not items:
        answer = f"אין לקוחות שלא ביקרו יותר מ-{months} חודשים. כל הלקוחות פעילים!"
    else:
        names = ", ".join(i["name"] for i in items[:5])
        answer = f"נמצאו {len(items)} לקוחות שלא ביקרו ב-{months} חודשים האחרונים: {names}{'...' if len(items) > 5 else ''}."

    return {
        "months_inactive": months,
        "count": len(inactive),
        "clients": items,
        "answer": answer,
    }


def get_top_artists(studio_id: UUID, db: Session, year: int | None = None, month: int | None = None, **_) -> dict:
    now = datetime.now(timezone.utc)
    year = year or now.year
    month = month or now.month

    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc) if month == 12 else datetime(year, month + 1, 1, tzinfo=timezone.utc)

    rows = db.execute(
        select(User.display_name, func.coalesce(func.sum(Payment.amount_cents), 0).label("total_cents"))
        .join(Appointment, Appointment.artist_id == User.id)
        .join(Payment, and_(Payment.appointment_id == Appointment.id, Payment.status == "paid", Payment.type != "refund"))
        .where(
            Appointment.studio_id == studio_id,
            Payment.created_at >= start,
            Payment.created_at < end,
        )
        .group_by(User.id, User.display_name)
        .order_by(func.sum(Payment.amount_cents).desc())
    ).all()

    artists = [
        {"name": r.display_name or "—", "revenue": round(r.total_cents / 100, 2)}
        for r in rows
    ]
    if not artists:
        answer = f"אין נתוני הכנסות לאמנים ב{_month_name(month)} {year}."
    else:
        top = artists[0]
        answer = f"ביצועי אמנים ב{_month_name(month)} {year}: המוביל הוא {top['name']} עם ₪{top['revenue']:,.2f}."
        if len(artists) > 1:
            rest = ", ".join(f"{a['name']} ₪{a['revenue']:,.2f}" for a in artists[1:])
            answer += f" | {rest}"

    return {
        "year": year,
        "month": month,
        "month_name": _month_name(month),
        "artists": artists,
        "answer": answer,
    }


def get_system_help(topic: str, **_) -> dict:
    topic_lower = topic.lower().strip()
    guides: dict[str, str] = {
        "wallet": "כדי לחבר Apple/Google Wallet: 1) עברו לעמוד 'עיצוב כרטיס מועדון'. 2) ראו את הסטטוס של Apple/Google Wallet. 3) אם כתוב 'ממתין להגדרת מערכת' — פנו למנהל המערכת להגדרת משתני הסביבה בסביבת הייצור.",
        "client": "להוספת לקוח חדש: 1) לחצו על 'לקוחות' בתפריט. 2) לחצו על כפתור '+'. 3) מלאו שם, טלפון, ואימייל. 4) שמרו — הלקוח נוצר מיידית.",
        "clients": "להוספת לקוח חדש: 1) לחצו על 'לקוחות' בתפריט. 2) לחצו על כפתור '+'. 3) מלאו שם, טלפון, ואימייל. 4) שמרו — הלקוח נוצר מיידית.",
        "appointment": "לפתיחת תור: 1) פתחו את 'יומן'. 2) לחצו על תאריך ושעה ריקים. 3) בחרו לקוח ועובד. 4) הגדירו מחיר ושמרו.",
        "timetable": "לפתיחת תור: 1) פתחו את 'יומן'. 2) לחצו על תאריך ושעה ריקים. 3) בחרו לקוח ועובד. 4) הגדירו מחיר ושמרו.",
        "automation": "להפעלת אוטומציות: עברו ל'הגדרות > אוטומציה'. שם תוכלו להגדיר הודעות ריגוש אוטומטיות ללקוחות, תזכורות תורים, ועוד.",
        "staff": "להוספת עובד: עברו ל'צוות'. לחצו '+'. הכניסו שם, אימייל, ותפקיד. שלחו הזמנה — העובד יקבל מייל.",
        "gift card": "כרטיסי מתנה מנוהלים תחת 'מוצרים'. הוסיפו מוצר בסוג 'Gift Card' עם הסכום הרצוי.",
        "membership": "רמות חברות מנוהלות תחת 'רמות חברות' (Tiers). ניתן להגדיר שמות, יתרונות, ורף נקודות.",
        "points": "נקודות נצברות אוטומטית מתשלומים. ניתן להגדיר את אחוז הנקודות בהגדרות האוטומציה.",
    }

    for key, guide in guides.items():
        if key in topic_lower:
            return {"topic": topic, "help": guide}

    return {
        "topic": topic,
        "help": f"לא מצאתי מדריך ספציפי עבור '{topic}'. אפשר לחפש בעמוד 'עזרה' במערכת, או לשאול שאלה יותר ספציפית.",
    }


# ── Dispatcher ────────────────────────────────────────────────────────────────

TOOL_MAP: dict[str, Any] = {
    "get_today_appointments": get_today_appointments,
    "get_monthly_revenue": get_monthly_revenue,
    "search_client": search_client,
    "get_dashboard_stats": get_dashboard_stats,
    "get_wallet_status": get_wallet_status,
    "get_inactive_clients": get_inactive_clients,
    "get_top_artists": get_top_artists,
    "get_system_help": get_system_help,
}


def execute_tool(name: str, args: dict, studio_id: UUID, db: Session) -> dict:
    fn = TOOL_MAP.get(name)
    if not fn:
        return {"error": f"כלי '{name}' לא קיים"}
    try:
        return fn(studio_id=studio_id, db=db, **args)
    except Exception as e:
        return {"error": f"שגיאה בביצוע הכלי: {str(e)[:200]}"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _month_name(month: int) -> str:
    names = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
             "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
    return names[month] if 1 <= month <= 12 else str(month)
