"""Business types (תחומי עסק): one list, in the database, that every signup, screen and import reads."""
import re

import pytest
from sqlalchemy import select, text

from app.data.business_types import BUSINESS_TYPES, PREVIOUS_LABELS
from app.models.module import BusinessTypeTemplate
from app.models.studio import Studio
from app.models.user import User
from app.services.business_types import match_business_type
from tests.conftest import _build_production_schema, register_and_login

SEED = [(t["key"], t["label"], t["aliases"]) for t in BUSINESS_TYPES]

# Every name the older lists used — BizControl's onboarding, BizFind's signup, the old labels.
OLD_NAMES = {
    "קעקועים": "tattoo", "סטודיו קעקועים": "tattoo", "ספרות": "barber", "ספר / ברברשופ": "barber",
    "קוסמטיקה ויופי": "spa", "ספא / קוסמטיקה": "spa", "פדיקור ומניקור": "nails", "ציפורניים": "nails",
    "עיצוב שיער": "hair", "מכון כושר": "gym", "עיסוי ורפלקסולוגיה": "massage", "פילאטיס ויוגה": "pilates",
    "פילאטיס / כושר": "pilates", "קליניקה / בריאות": "medical", "קליניקה / מרפאה": "medical",
    "שיניים": "dental", "מרפאת שיניים": "dental", "פסיכולוגיה / קואצ׳ינג": "psychology",
    "קליניקת לייזר": "laser", "לייזר": "laser", "חנות בגדים": "clothing", "בית מרקחת": "pharmacy",
    "פרחים": "florist", "צילום": "photography", "אחר": "other",
}


@pytest.mark.parametrize("name,key", sorted(OLD_NAMES.items()))
def test_every_old_name_maps_to_its_type(name, key):
    assert match_business_type(name, SEED) == key


def test_matching_ignores_spaces_punctuation_and_case():
    assert match_business_type("  Tattoo ", SEED) == "tattoo"
    assert match_business_type("פסיכולוגיה/קואצ'ינג", SEED) == "psychology"
    assert match_business_type("בניית מערכות דיגיטליות", SEED) is None
    assert match_business_type("", SEED) is None and match_business_type(None, SEED) is None


def test_the_seed_list_is_complete_and_consistent():
    keys = [t["key"] for t in BUSINESS_TYPES]
    assert len(keys) == len(set(keys)) == 17
    for t in BUSINESS_TYPES:
        assert re.fullmatch(r"[a-z][a-z0-9_]+", t["key"]), t
        assert t["label"].strip(), t
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", t["icon"]), t   # a Lucide icon name
        assert re.fullmatch(r"#[0-9a-f]{6}", t["color"]), t
        assert bool(t.get("directory_only")) == (t["services"] == []), t   # a directory listing has no services
    # no name or alias points at two types
    for t in BUSINESS_TYPES:
        for name in [t["label"], *t["aliases"]]:
            assert match_business_type(name, SEED) == t["key"], (name, t["key"])
    assert set(PREVIOUS_LABELS) <= set(keys)
    assert keys[-1] == "other"


def _reseed(db_session):
    db_session.commit()
    _build_production_schema(db_session.connection().connection.dbapi_connection)
    db_session.expire_all()


def test_start_seeds_fills_but_never_overwrites_and_fixes_free_text_types(db_session):
    tattoo = db_session.get(BusinessTypeTemplate, "tattoo")
    assert tattoo.display_name == "קעקועים" and tattoo.icon == "palette" and "סטודיו קעקועים" in tattoo.aliases
    assert db_session.get(BusinessTypeTemplate, "florist").is_directory_only is True

    tattoo.display_name = "קעקועים ופירסינג"            # the superadmin renamed it
    db_session.get(BusinessTypeTemplate, "barber").display_name = "ספר / ברברשופ"   # still the old default
    db_session.add_all([Studio(name="א", slug="free-text", business_type="פדיקור ומניקור"),
                        Studio(name="ב", slug="unknown", business_type="בניית מערכות דיגיטליות")])
    db_session.execute(text("INSERT INTO businesses (id, slug, name, category, claim_status) "
                            "VALUES (gen_random_uuid(), 'b1', 'x', 'קוסמטיקה ויופי', 'unclaimed')"))
    _reseed(db_session)

    assert db_session.get(BusinessTypeTemplate, "tattoo").display_name == "קעקועים ופירסינג"
    assert db_session.get(BusinessTypeTemplate, "barber").display_name == "ספרות וברברשופ"
    by_slug = {s.slug: s.business_type for s in db_session.scalars(select(Studio)).all()}
    assert by_slug["free-text"] == "nails" and by_slug["unknown"] == "other"
    notes = {s.slug: s.business_type_note for s in db_session.scalars(select(Studio)).all()}
    assert notes["unknown"] == "בניית מערכות דיגיטליות" and notes["free-text"] is None   # the owner's words are kept
    assert db_session.execute(text("SELECT category FROM businesses WHERE slug='b1'")).scalar() == "spa"


def test_one_public_list_for_both_signups(client):
    everything = client.get("/api/public/business-types").json()
    assert [t["key"] for t in everything][-1] == "other"
    assert {"clothing", "pharmacy", "florist"} <= {t["key"] for t in everything}
    bizcontrol = client.get("/api/public/business-types?include_directory=false").json()
    assert len(bizcontrol) == len(everything) - 3 and not any(t["directory_only"] for t in bizcontrol)
    assert set(everything[0]) == {"key", "label", "icon", "color", "directory_only"}


def test_the_owner_can_only_pick_a_type_from_the_list(client):
    h = register_and_login(client, slug="bt", email="owner@bt.com")
    options = client.get("/api/studio/upload/business-type-options", headers=h).json()["options"]
    assert {"value": "nails", "label": "מניקור ופדיקור", "icon": "hand"} in options
    assert client.patch("/api/studio/upload/business-type", headers=h, json={"business_type": "nails"}).json() == {"business_type": "nails"}
    assert client.patch("/api/studio/upload/business-type", headers=h, json={"business_type": "פילאטיס / כושר"}).json() == {"business_type": "pilates"}
    assert client.patch("/api/studio/upload/business-type", headers=h, json={"business_type": "משהו אחר לגמרי"}).status_code == 400


def test_the_superadmin_adds_a_type_without_code(client, db_session):
    h = register_and_login(client, slug="sa", email="admin@sa.com")
    db_session.scalar(select(User).where(User.email == "admin@sa.com")).role = "superadmin"
    db_session.commit()
    r = client.post("/api/admin/business-types", headers=h, json={"business_type": "yoga", "display_name": "יוגה"})
    assert r.status_code == 400 and "pilates" in r.text          # "יוגה" already names pilates
    r = client.post("/api/admin/business-types", headers=h, json={
        "business_type": "makeup", "display_name": "איפור", "icon": "sparkles", "color": "#F472B6", "aliases": ["מאפרת"]})
    assert r.status_code == 200, r.text
    assert r.json()["color"] == "#f472b6"
    keys = [t["key"] for t in client.get("/api/public/business-types").json()]
    assert "makeup" in keys and keys[-1] == "other"
    assert client.patch("/api/admin/business-types/other", headers=h, json={"is_active": False}).status_code == 400
    assert client.patch("/api/admin/business-types/makeup", headers=h, json={"icon": "Not An Icon"}).status_code == 400
    assert client.patch("/api/admin/business-types/makeup", headers=h, json={"is_active": False}).status_code == 200
    assert "makeup" not in [t["key"] for t in client.get("/api/public/business-types").json()]

    db_session.add(Studio(name="גלישת חוף", slug="surf", business_type="other", business_type_note="הדרכות גלישה"))
    db_session.commit()
    notes = client.get("/api/admin/business-types/other-notes", headers=h).json()
    assert [(n["name"], n["note"]) for n in notes] == [("גלישת חוף", "הדרכות גלישה")]


def test_signup_forms_keep_the_owners_words_when_no_type_fits(db_session):
    from app.services.business_types import resolve_with_note
    assert resolve_with_note(db_session, "nails") == ("nails", None)
    assert resolve_with_note(db_session, "פדיקור ומניקור") == ("nails", None)            # an older form's name
    assert resolve_with_note(db_session, "other", "הדרכות גלישה") == ("other", "הדרכות גלישה")
    assert resolve_with_note(db_session, "הדרכות גלישה") == ("other", "הדרכות גלישה")    # older form: text as the value
    assert resolve_with_note(db_session, "nails", "טקסט שלא שייך") == ("nails", None)   # a real type needs no note
