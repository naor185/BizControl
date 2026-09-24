"""The "learning" (part D): what owners rename surfaces to the superadmin, who can make it the field's
default in one click; the superadmin can edit a field's words and default texts without code."""
from sqlalchemy import select

from app.data.business_types import GENERIC_MESSAGES
from app.models.module import BusinessTypeTemplate
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services.business_types import message_default, studio_terms
from tests.conftest import register_and_login


def _superadmin(client, db_session):
    h = register_and_login(client, slug="learn-sa", email="sa@learn.com")
    db_session.scalar(select(User).where(User.email == "sa@learn.com")).role = "superadmin"
    db_session.commit()
    return h


def _nails(db, slug, own=None):
    s = Studio(name=slug, slug=slug, business_type="nails")
    db.add(s)
    db.flush()
    db.add(StudioSettings(studio_id=s.id, business_terms=own or {}))
    db.commit()
    return s


def test_owners_changes_surface_and_one_click_makes_them_the_fields(client, db_session):
    h = _superadmin(client, db_session)
    a = _nails(db_session, "nails-a", {"staff": "טכנאית ציפורניים"})
    b = _nails(db_session, "nails-b", {"staff": "טכנאית ציפורניים", "place": "סלון"})
    c = _nails(db_session, "nails-c", {"staff": "מעצבת ציפורניים"})

    changes = client.get("/api/admin/business-types/word-changes", headers=h).json()["changes"]
    top = changes[0]
    assert (top["business_type"], top["term"], top["field_word"], top["owner_word"], top["count"]) == \
        ("nails", "staff", "מניקוריסטית", "טכנאית ציפורניים", 2)
    assert top["studios"] == ["nails-a", "nails-b"]

    r = client.patch("/api/admin/business-types/nails", headers=h, json={"terms": {"staff": "טכנאית ציפורניים"}})
    assert r.status_code == 200 and r.json()["terms"]["staff"] == "טכנאית ציפורניים"
    db_session.expire_all()
    assert db_session.get(StudioSettings, a.id).business_terms == {}                     # now the field's word
    assert db_session.get(StudioSettings, b.id).business_terms == {"place": "סלון"}       # other change kept
    assert db_session.get(StudioSettings, c.id).business_terms == {"staff": "מעצבת ציפורניים"}
    assert studio_terms(db_session, a.id)["staff"] == "טכנאית ציפורניים"
    assert studio_terms(db_session, c.id)["staff"] == "מעצבת ציפורניים"


def test_the_superadmin_edits_a_fields_words_and_aftercare_text(client, db_session):
    h = _superadmin(client, db_session)
    s = _nails(db_session, "nails-d")
    assert client.patch("/api/admin/business-types/nails", headers=h, json={"terms": {"bogus": "x"}}).status_code == 400
    assert client.patch("/api/admin/business-types/nails", headers=h, json={"terms": {"staff": "א" * 31}}).status_code == 400
    assert client.patch("/api/admin/business-types/nails", headers=h, json={"message_defaults": {"sms": "x"}}).status_code == 400

    text = "היי {client_name}! לא להרטיב את הלק 24 שעות 💅"
    assert client.patch("/api/admin/business-types/nails", headers=h, json={"message_defaults": {"aftercare": text}}).status_code == 200
    db_session.expire_all()
    assert message_default(db_session, s.id, "aftercare") == text
    client.patch("/api/admin/business-types/nails", headers=h, json={"message_defaults": {"aftercare": ""}})
    db_session.expire_all()
    assert message_default(db_session, s.id, "aftercare") == GENERIC_MESSAGES["aftercare"]

    client.patch("/api/admin/business-types/nails", headers=h, json={"terms": {"place": ""}})   # back to generic
    db_session.expire_all()
    assert "place" not in db_session.get(BusinessTypeTemplate, "nails").terms
    assert studio_terms(db_session, s.id)["place"] == "עסק"
