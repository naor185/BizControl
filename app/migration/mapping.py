"""
Smart field mapping: which source column goes to which universal field.

A suggestion is made from the column's name (against each field's synonyms, in Hebrew and English)
and checked against the column's values. Only a confident suggestion is applied automatically;
a plausible one is shown as "needs review"; a weak one is not suggested at all. The business owner
can change every one of them.
"""
from __future__ import annotations

import re

from app.migration.normalize import clean_text, detect_date_order, value_fits
from app.migration.universal import EntitySpec

AUTO = 0.9      # applied automatically
REVIEW = 0.6    # suggested, marked "needs review"

_HEADER_JUNK = re.compile(r"[\s_\-\.'\"״׳`/\\()\[\]:#*]")


def header_key(header: str) -> str:
    return _HEADER_JUNK.sub("", (header or "").lower())


def _content_ratio(kind: str, values: list) -> float | None:
    if not values:
        return None
    return sum(1 for v in values if value_fits(kind, v)) / len(values)


def suggest_mapping(spec: EntitySpec, headers: list[str], columns: list[list]) -> list[dict]:
    """columns[i] = non-empty sample values of column i. One suggestion per column."""
    fields = {f.key: f for f in spec.fields}
    synonym_index: dict[str, str] = {}
    for f in spec.fields:
        synonym_index.setdefault(header_key(f.key), f.key)
        synonym_index.setdefault(header_key(f.label), f.key)
        for syn in f.synonyms:
            synonym_index.setdefault(header_key(syn), f.key)

    out = []
    for i, header in enumerate(headers):
        values = columns[i] if i < len(columns) else []
        hk = header_key(header)
        target, conf, reason = None, 0.0, ""
        if not values:
            out.append({"index": i, "column": header, "samples": [], "target": None, "confidence": 0.0,
                        "status": "empty", "reason": "העמודה ריקה"})
            continue

        by_name = synonym_index.get(hk)
        if not by_name and hk:
            # "טלפון נייד 2", "Email Address (work)": a synonym contained in the header
            for syn_key, fkey in sorted(synonym_index.items(), key=lambda kv: -len(kv[0])):
                if len(syn_key) >= 4 and syn_key in hk:
                    by_name = fkey
                    conf = 0.7
                    break
        if by_name:
            target = by_name
            # An exact name match on a free-text field is as sure as it gets (its values cannot be checked).
            conf = conf or (0.9 if fields[target].kind in ("text", "id") else 0.85)
            reason = "לפי שם העמודה"
            ratio = _content_ratio(fields[target].kind, values)
            if ratio is not None and fields[target].kind not in ("text", "id"):
                if ratio >= 0.8:
                    conf = min(1.0, conf + 0.15)
                    reason = "לפי שם העמודה והערכים שבה"
                elif ratio < 0.5 and len(values) >= 3:
                    conf = 0.5
                    reason = "שם העמודה מתאים, אבל רוב הערכים לא נראים כמו " + fields[target].label
        else:
            # No name match: only unmistakable content is suggested, and never automatically.
            for kind, fkey in (("email", "email"), ("phone", "phone")):
                if fkey in fields and (_content_ratio(kind, values) or 0) >= 0.9:
                    target, conf, reason = fkey, 0.7, "לפי הערכים שבעמודה"
                    break

        status = "auto" if conf >= AUTO else "review" if conf >= REVIEW else "none"
        out.append({
            "index": i, "column": header, "samples": [clean_text(v) for v in values[:3]],
            "target": target if status != "none" else None,
            "suggested": target, "confidence": round(conf, 2), "status": status, "reason": reason,
        })

    # A field that takes one column: keep the most confident column, un-map the others.
    for f in spec.fields:
        if f.multi:
            continue
        claims = [c for c in out if c["target"] == f.key]
        if len(claims) > 1:
            claims.sort(key=lambda c: -c["confidence"])
            for c in claims[1:]:
                c["target"], c["status"] = None, "none"
                c["reason"] = f"השדה {f.label} כבר ממופה מהעמודה \"{claims[0]['column']}\""

    # Date columns: which order are the dates written in?
    for c in out:
        f = fields.get(c["target"] or "")
        if f and f.kind in ("date", "datetime"):
            order = detect_date_order(columns[c["index"]])
            c["date_order"] = order
            if order is None and c["status"] == "auto":
                c["status"] = "review"
                c["reason"] = "לא ברור אם התאריכים הם יום/חודש או חודש/יום — בחר למטה"
    return out


def validate_mapping(spec: EntitySpec, mapping: dict[int, str], column_count: int) -> list[str]:
    """Problems that block scanning with this mapping (empty list = OK)."""
    errors = []
    targets = {}
    for idx, target in mapping.items():
        if not (0 <= idx < column_count):
            errors.append(f"עמודה {idx} לא קיימת בקובץ")
            continue
        f = spec.field(target)
        if not f:
            errors.append(f"שדה לא מוכר: {target}")
            continue
        if not f.multi and target in targets:
            errors.append(f"השדה \"{f.label}\" ממופה משתי עמודות — בחר אחת")
        targets[target] = idx
    if spec.key == "clients" and not ({"full_name", "first_name", "last_name"} & set(targets)):
        errors.append("צריך למפות לפחות עמודה אחת של שם (שם מלא, שם פרטי או שם משפחה)")
    for f in spec.fields:
        if f.required and f.key not in targets:
            errors.append(f"צריך למפות עמודה לשדה \"{f.label}\"")
    return errors
