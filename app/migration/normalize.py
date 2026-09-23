"""
Normalizer: raw source values → clean universal values, with a list of issues for anything that
could not be used as-is. Shared by every connector. A value that cannot be parsed is never guessed:
it is reported, and for clients it is kept in the notes so nothing the source had is lost.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta

import pytz

from app.utils.phone import normalize_phone

IL_TZ = pytz.timezone("Asia/Jerusalem")

_EMPTY = {"", "nan", "none", "null", "-", "--", "n/a", "#n/a", "undefined"}
_BIDI = re.compile(r"[\u200e\u200f\u202a-\u202e\ufeff]")
_NIKUD = re.compile(r"[\u0591-\u05c7]")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def issue(field: str, code: str, level: str, message: str) -> dict:
    return {"field": field, "code": code, "level": level, "message": message}


# ── Single values ─────────────────────────────────────────────────────────────

def clean_text(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return "כן" if v else "לא"
    if isinstance(v, float):
        if v != v:
            return None
        if v.is_integer():
            v = int(v)
    if isinstance(v, datetime):
        return v.isoformat(sep=" ", timespec="minutes")
    if isinstance(v, date):
        return v.isoformat()
    s = _BIDI.sub("", str(v)).strip()
    s = re.sub(r"\s+", " ", s)
    return None if s.lower() in _EMPTY else s


def name_key(name: str | None) -> str | None:
    """Comparable form of a person's or service's name: no nikud, punctuation or case."""
    if not name:
        return None
    s = _NIKUD.sub("", name).lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def names_similar(a: str | None, b: str | None) -> bool:
    """Same person as far as a name can tell: equal, or one name's words are all in the other
    ("יעל" / "יעל כהן", "כהן יעל" / "יעל כהן")."""
    if not a or not b:
        return False
    if a == b:
        return True
    ta, tb = set(a.split()), set(b.split())
    return bool(ta) and bool(tb) and (ta <= tb or tb <= ta)


def normalize_email(v) -> str | None:
    s = clean_text(v)
    if not s:
        return None
    s = s.lower().removeprefix("mailto:").strip()
    return s if _EMAIL.match(s) else None


def _two_digit_year(y: int) -> int:
    this = date.today().year % 100
    return 2000 + y if y <= this else 1900 + y


def _date_parts(s: str) -> tuple[int, int, int, bool] | None:
    """(a, b, c, year_first) from 12/03/1990, 12.3.90, 1990-03-12, 12-03-1990 12:00…"""
    s = s.strip().split("T")[0].split(" ")[0]
    parts = re.split(r"[/.\-]", s)
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    if len(parts[0]) == 4:
        return int(parts[0]), int(parts[1]), int(parts[2]), True
    return int(parts[0]), int(parts[1]), int(parts[2]), False


def detect_date_order(values) -> str | None:
    """'DMY', 'MDY' or 'YMD' when the values themselves show it; None when every value would read
    the same either way (e.g. 05/06/1990) — then the business owner has to say which it is."""
    dmy = mdy = ymd = 0
    for v in values:
        if isinstance(v, (date, datetime)):
            ymd += 1
            continue
        p = _date_parts(str(v)) if v is not None else None
        if not p:
            continue
        a, b, _, year_first = p
        if year_first:
            ymd += 1
        elif a > 12 >= b:
            dmy += 1
        elif b > 12 >= a:
            mdy += 1
    if dmy and not mdy:
        return "DMY"
    if mdy and not dmy:
        return "MDY"
    if ymd and not dmy and not mdy:
        return "YMD"
    return None


def parse_date(v, order: str = "DMY") -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        # Excel date serial (days since 1899-12-30)
        if 1 < v < 80000:
            return date(1899, 12, 30) + timedelta(days=int(v))
        return None
    p = _date_parts(str(v))
    if not p:
        return None
    a, b, c, year_first = p
    try:
        if year_first:
            return date(a, b, c)
        y = c if c >= 100 else _two_digit_year(c)
        return date(y, b, a) if order != "MDY" else date(y, a, b)
    except ValueError:
        return None


def parse_datetime(v, order: str = "DMY") -> datetime | None:
    """Timezone-aware. A value without a time is taken as noon Israel time so it stays on the same
    calendar day in every timezone."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else IL_TZ.localize(v)
    if isinstance(v, date):
        return IL_TZ.localize(datetime.combine(v, time(12, 0)))
    s = clean_text(v)
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else IL_TZ.localize(dt)
    except ValueError:
        pass
    d = parse_date(s, order)
    if not d:
        return None
    m = re.search(r"(\d{1,2}):(\d{2})", s.split(" ", 1)[1]) if " " in s else None
    t = time(int(m.group(1)), int(m.group(2))) if m and int(m.group(1)) < 24 and int(m.group(2)) < 60 else time(12, 0)
    return IL_TZ.localize(datetime.combine(d, t))


def parse_money(v) -> int | None:
    """Agorot (cents). None if not a non-negative amount."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return round(v * 100) if v == v and v >= 0 else None
    s = clean_text(v)
    if not s:
        return None
    s = re.sub(r"(₪|\$|€|ils|nis|ש\"ח|ש״ח|שח|שקלים|שקל)", "", s, flags=re.I).replace(" ", "")
    if not s or s.startswith("-"):
        return None
    if "," in s and "." in s:
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    elif "," in s:
        if re.fullmatch(r"\d{1,3}(,\d{3})+", s):
            s = s.replace(",", "")
        elif re.fullmatch(r"\d+,\d{1,2}", s):
            s = s.replace(",", ".")
        else:
            return None
    try:
        amount = float(s)
    except ValueError:
        return None
    return round(amount * 100) if amount >= 0 else None


def parse_duration(v) -> int | None:
    """Minutes. Accepts 60, "60 דק׳", "1:30", "1.5 שעות", "שעה", "שעתיים", "חצי שעה"."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        n = round(v)
        return n if 0 < n <= 1440 else None
    s = clean_text(v)
    if not s:
        return None
    s = s.lower()
    words = {"חצי שעה": 30, "רבע שעה": 15, "שעה וחצי": 90, "שעתיים": 120, "שעה": 60}
    for w, n in words.items():
        if s == w:
            return n
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", s)
    if m:
        n = int(m.group(1)) * 60 + int(m.group(2))
        return n if 0 < n <= 1440 else None
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(דקות|דק׳|דק'|דק|minutes|minute|mins|min|m|שעות|שעה|hours|hour|hrs|hr|h)?", s)
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2) or ""
    if unit in ("שעות", "שעה", "hours", "hour", "hrs", "hr", "h"):
        n *= 60
    n = round(n)
    return n if 0 < n <= 1440 else None


def parse_int(v) -> int | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if v == v and float(v).is_integer() else None
    s = clean_text(v)
    return int(s) if s and re.fullmatch(r"-?\d+", s) else None


_TRUE = {"1", "true", "yes", "y", "v", "✓", "✔", "כן", "פעיל", "פעילה", "מאשר", "מאשרת", "מאושר", "active", "on",
         "enabled", "subscribed", "opted in", "optin", "אישר"}
_FALSE = {"0", "false", "no", "n", "לא", "לא פעיל", "לא פעילה", "לא מאשר", "לא מאשרת", "לא מאושר", "inactive", "off",
          "disabled", "unsubscribed", "opted out", "optout", "הוסר", "הסיר", "ביטל", "מבוטל"}


def parse_bool(v) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    s = clean_text(v)
    if not s:
        return None
    s = s.lower()
    if s in _TRUE:
        return True
    if s in _FALSE:
        return False
    return None


# Used by the mapping screen to judge whether a column's values fit a field.
def value_fits(kind: str, v) -> bool:
    if kind == "phone":
        return normalize_phone(v) is not None
    if kind == "email":
        return normalize_email(v) is not None
    if kind in ("date", "datetime"):
        return parse_date(v) is not None or (kind == "datetime" and parse_datetime(v) is not None)
    if kind == "money":
        return parse_money(v) is not None
    if kind == "duration":
        return parse_duration(v) is not None
    if kind == "int":
        return parse_int(v) is not None
    if kind == "bool":
        return parse_bool(v) is not None
    if kind == "name":
        s = clean_text(v)
        return bool(s) and not any(ch.isdigit() for ch in s) and "@" not in s
    return clean_text(v) is not None


# ── Whole records ─────────────────────────────────────────────────────────────

def _join(values: list[tuple[str, object]], labelled: bool) -> str | None:
    parts = []
    for header, v in values:
        s = clean_text(v)
        if s:
            parts.append(f"{header}: {s}" if labelled else s)
    return "\n".join(parts) if parts else None


def normalize_client(values: dict[str, list[tuple[str, object]]], options: dict) -> tuple[dict, list[dict]]:
    """values: target field → [(source column, raw value), …]. Returns (universal client, issues)."""
    issues: list[dict] = []
    order = options.get("date_order") or "DMY"
    first = lambda key: next((v for _, v in values.get(key, []) if clean_text(v) is not None), None)  # noqa: E731
    notes_extra: list[str] = []

    full = clean_text(first("full_name"))
    if not full:
        full = " ".join(p for p in (clean_text(first("first_name")), clean_text(first("last_name"))) if p) or None
    if full:
        full = full[:160]
    else:
        issues.append(issue("full_name", "missing_name", "error", "חסר שם — שורה בלי שם לא תיובא"))

    raw_phone = first("phone")
    phone = normalize_phone(raw_phone) if raw_phone is not None else None
    if raw_phone is not None and clean_text(raw_phone) and not phone:
        issues.append(issue("phone", "invalid_phone", "warning", f"טלפון לא תקין ({clean_text(raw_phone)}) — נשמר בהערות"))
        notes_extra.append(f"טלפון מהמערכת הקודמת (לא תקין): {clean_text(raw_phone)}")

    raw_email = first("email")
    email = normalize_email(raw_email)
    if raw_email is not None and clean_text(raw_email) and not email:
        issues.append(issue("email", "invalid_email", "warning", f"אימייל לא תקין ({clean_text(raw_email)}) — נשמר בהערות"))
        notes_extra.append(f"אימייל מהמערכת הקודמת (לא תקין): {clean_text(raw_email)}")

    if not phone and not email:
        issues.append(issue("phone", "no_contact", "warning", "אין טלפון ואין אימייל — לא יהיה אפשר לזהות כפילות או לשלוח הודעות"))

    birth = None
    raw_birth = first("birth_date")
    if raw_birth is not None and clean_text(raw_birth):
        birth = parse_date(raw_birth, order)
        if birth and not (date(1900, 1, 1) <= birth <= date.today()):
            birth = None
        if not birth:
            issues.append(issue("birth_date", "invalid_date", "warning", f"תאריך לידה לא מובן ({clean_text(raw_birth)}) — נשמר בהערות"))
            notes_extra.append(f"תאריך לידה מהמערכת הקודמת: {clean_text(raw_birth)}")

    created = None
    raw_created = first("created_at")
    if raw_created is not None and clean_text(raw_created):
        created = parse_datetime(raw_created, order)
        if created and created > datetime.now(IL_TZ) + timedelta(days=1):
            created = None
        if not created:
            issues.append(issue("created_at", "invalid_date", "warning", f"תאריך הצטרפות לא מובן ({clean_text(raw_created)}) — יירשם תאריך הייבוא"))

    consent = None
    raw_consent = first("marketing_consent")
    if raw_consent is not None and clean_text(raw_consent):
        consent = parse_bool(raw_consent)
        if consent is None:
            issues.append(issue("marketing_consent", "invalid_bool", "warning", f"ערך דיוור לא מובן ({clean_text(raw_consent)}) — יישמר כמו לקוח חדש רגיל (מאשר)"))

    notes_parts = []
    notes = _join(values.get("notes", []), labelled=len(values.get("notes", [])) > 1)
    if notes:
        notes_parts.append(notes)
    gender = clean_text(first("gender"))
    if gender:
        notes_parts.append(f"מגדר: {gender}")
    tags = _join(values.get("tags", []), labelled=False)
    if tags:
        notes_parts.append("תגיות: " + tags.replace("\n", ", "))
    notes_parts.extend(notes_extra)

    data = {
        "external_id": (clean_text(first("external_id")) or "")[:128] or None,
        "full_name": full,
        "phone": phone,
        "email": email,
        "birth_date": birth.isoformat() if birth else None,
        "notes": "\n".join(notes_parts) or None,
        "created_at": created.isoformat() if created else None,
        "marketing_consent": consent,
    }
    return data, issues


def normalize_service(values: dict[str, list[tuple[str, object]]], options: dict) -> tuple[dict, list[dict]]:
    issues: list[dict] = []
    first = lambda key: next((v for _, v in values.get(key, []) if clean_text(v) is not None), None)  # noqa: E731

    name = clean_text(first("name"))
    if name:
        name = name[:128]
    else:
        issues.append(issue("name", "missing_name", "error", "חסר שם שירות — השורה לא תיובא"))

    raw_duration = first("duration_minutes")
    duration = parse_duration(raw_duration) if raw_duration is not None else None
    if duration is None:
        if raw_duration is not None and clean_text(raw_duration):
            issues.append(issue("duration_minutes", "invalid_duration", "warning", f"משך לא מובן ({clean_text(raw_duration)}) — נקבע 60 דקות, אפשר לשנות אחרי הייבוא"))
        else:
            issues.append(issue("duration_minutes", "duration_default", "info", "לא צוין משך — נקבע 60 דקות, אפשר לשנות אחרי הייבוא"))
        duration = 60

    raw_price = first("price")
    price = parse_money(raw_price) if raw_price is not None else None
    if price is None and raw_price is not None and clean_text(raw_price):
        issues.append(issue("price", "invalid_price", "warning", f"מחיר לא מובן ({clean_text(raw_price)}) — נקבע 0"))

    active = None
    raw_active = first("is_active")
    if raw_active is not None and clean_text(raw_active):
        active = parse_bool(raw_active)
        if active is None:
            issues.append(issue("is_active", "invalid_bool", "warning", f"ערך 'פעיל' לא מובן ({clean_text(raw_active)}) — השירות ייובא כפעיל"))

    data = {
        "external_id": (clean_text(first("external_id")) or "")[:128] or None,
        "name": name,
        "duration_minutes": duration,
        "price_cents": price or 0,
        "category": (clean_text(first("category")) or "")[:64] or None,
        "description": _join(values.get("description", []), labelled=len(values.get("description", [])) > 1),
        "is_active": True if active is None else active,
    }
    return data, issues


NORMALIZERS = {"clients": normalize_client, "services": normalize_service}
