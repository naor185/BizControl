"""
Duplicate detection — one engine for every source. For each incoming record:

  1. source + external_id already linked      → EXISTING
  2. phone, 3. email                          → the candidate client(s)
  4/5. phone + name / email + name            → EXISTING when the names agree (or one is missing),
                                                POSSIBLE_DUPLICATE when they differ (a parent and child
                                                often share a phone), CONFLICT when the phone and the
                                                email point at two different clients
  … and the same checks against earlier rows of the same import (a file listing someone twice).

Nothing is merged or skipped silently: every non-NEW result carries the reason and the record it
matched, and the business owner decides in the preview.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.migration.normalize import name_key, names_similar, normalize_email
from app.models.client import Client
from app.models.migration import ExternalRecord
from app.models.service import Service
from app.utils.phone import normalize_phone

NEW, EXISTING, POSSIBLE_DUPLICATE, CONFLICT, INVALID = "new", "existing", "possible_duplicate", "conflict", "invalid"

REASONS = {
    "source_id": "כבר יובא בעבר מאותה מערכת",
    "phone": "אותו טלפון",
    "email": "אותו אימייל",
    "phone_name": "אותו טלפון ואותו שם",
    "email_name": "אותו אימייל ואותו שם",
    "phone_other_name": "אותו טלפון, שם אחר",
    "email_other_name": "אותו אימייל, שם אחר",
    "phone_email_split": "הטלפון שייך ללקוח אחד והאימייל ללקוח אחר",
    "several_matches": "יש כמה לקוחות עם אותו טלפון או אימייל",
    "in_file": "מופיע יותר מפעם אחת בקובץ",
    "name": "שירות עם אותו שם כבר קיים",
    "invalid": "חסרים נתונים חובה",
}


@dataclass
class Match:
    status: str
    target_id: uuid.UUID | None = None
    reason: str | None = None
    ref_row: int | None = None   # for in_file: the earlier row


def default_decision(status: str, existing_action: str) -> str:
    if status == NEW:
        return "create"
    if status == EXISTING:
        return "merge" if existing_action == "fill_empty" else "skip"
    return "skip"   # possible duplicates, conflicts and invalid rows wait for the owner (or are skipped)


class _Linked:
    def __init__(self, db: Session, studio_id, source: str, entity: str, live_ids: set):
        rows = db.execute(select(ExternalRecord.external_id, ExternalRecord.local_id).where(
            ExternalRecord.studio_id == studio_id, ExternalRecord.source == source,
            ExternalRecord.entity_type == entity)).all()
        self.by_ext = {e: l for e, l in rows if l in live_ids}


class ClientMatcher:
    def __init__(self, db: Session, studio_id, source: str):
        self.clients: dict[uuid.UUID, tuple[str | None, str]] = {}
        self.by_phone: dict[str, list[uuid.UUID]] = {}
        self.by_email: dict[str, list[uuid.UUID]] = {}
        for cid, full_name, phone, email in db.execute(select(Client.id, Client.full_name, Client.phone, Client.email).where(
                Client.studio_id == studio_id, Client.is_active == True)).all():  # noqa: E712
            self.clients[cid] = (name_key(full_name), full_name)
            p = normalize_phone(phone)
            if p:
                self.by_phone.setdefault(p, []).append(cid)
            e = normalize_email(email)
            if e:
                self.by_email.setdefault(e, []).append(cid)
        self.linked = _Linked(db, studio_id, source, "clients", set(self.clients)).by_ext
        # earlier rows of this import: key → (row_number, name_key)
        self.seen_phone: dict[str, tuple[int, str | None]] = {}
        self.seen_email: dict[str, tuple[int, str | None]] = {}

    def match(self, row_number: int, external_id: str | None, phone: str | None, email: str | None, nkey: str | None) -> Match:
        result = self._match_existing(external_id, phone, email, nkey)
        if result.status == NEW:
            earlier = (self.seen_phone.get(phone) if phone else None) or (self.seen_email.get(email) if email else None)
            if earlier:
                result = Match(POSSIBLE_DUPLICATE, None, "in_file", earlier[0])
        if phone:
            self.seen_phone.setdefault(phone, (row_number, nkey))
        if email:
            self.seen_email.setdefault(email, (row_number, nkey))
        return result

    def _match_existing(self, external_id, phone, email, nkey) -> Match:
        if external_id and external_id in self.linked:
            return Match(EXISTING, self.linked[external_id], "source_id")
        by_phone = self.by_phone.get(phone, []) if phone else []
        by_email = self.by_email.get(email, []) if email else []
        if by_phone and by_email and not set(by_phone) & set(by_email):
            return Match(CONFLICT, by_phone[0], "phone_email_split")
        candidates = [c for c in by_phone if c in by_email] if by_phone and by_email else (by_phone or by_email)
        if not candidates:
            return Match(NEW)
        via = "phone" if by_phone else "email"
        same_name = [c for c in candidates if not nkey or not self.clients[c][0] or names_similar(nkey, self.clients[c][0])]
        if len(same_name) == 1:
            named = bool(nkey and self.clients[same_name[0]][0])
            return Match(EXISTING, same_name[0], f"{via}_name" if named else via)
        if len(same_name) > 1:
            return Match(POSSIBLE_DUPLICATE, same_name[0], "several_matches")
        return Match(POSSIBLE_DUPLICATE, candidates[0], f"{via}_other_name")

    def label(self, client_id) -> str | None:
        c = self.clients.get(client_id)
        return c[1] if c else None


class ServiceMatcher:
    def __init__(self, db: Session, studio_id, source: str):
        self.services: dict[uuid.UUID, str] = {}
        self.by_name: dict[str, uuid.UUID] = {}
        for sid, name in db.execute(select(Service.id, Service.name).where(Service.studio_id == studio_id)).all():
            self.services[sid] = name
            k = name_key(name)
            if k:
                self.by_name.setdefault(k, sid)
        self.linked = _Linked(db, studio_id, source, "services", set(self.services)).by_ext
        self.seen: dict[str, int] = {}

    def match(self, row_number: int, external_id: str | None, nkey: str | None) -> Match:
        if external_id and external_id in self.linked:
            result = Match(EXISTING, self.linked[external_id], "source_id")
        elif nkey and nkey in self.by_name:
            result = Match(EXISTING, self.by_name[nkey], "name")
        elif nkey and nkey in self.seen:
            result = Match(POSSIBLE_DUPLICATE, None, "in_file", self.seen[nkey])
        else:
            result = Match(NEW)
        if nkey:
            self.seen.setdefault(nkey, row_number)
        return result

    def label(self, service_id) -> str | None:
        return self.services.get(service_id)
