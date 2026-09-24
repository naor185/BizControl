"""The field's words (part B of the business profile): a business sees and sends its own words —
"מניקוריסטית", "מטפל/ת", "מדריך/ה" — never another field's "אמן"."""
from datetime import datetime, timezone
from types import SimpleNamespace

from sqlalchemy import select

from app.data.business_types import BUSINESS_TYPES, GENERIC_TERMS, TERM_LABELS
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.services.business_types import studio_terms
from tests.conftest import register_and_login


def _studio(db, slug, business_type):
    s = Studio(name=slug, slug=slug, business_type=business_type)
    db.add(s)
    db.flush()
    db.add(StudioSettings(studio_id=s.id))
    db.commit()
    return s


def test_every_appointment_field_has_all_its_words_and_no_field_says_artist_but_tattoo():
    for t in BUSINESS_TYPES:
        if t.get("directory_only") or t["key"] == "other":
            assert "terms" not in t, t["key"]           # they use the generic words
            continue
        assert set(t["terms"]) == set(TERM_LABELS), t["key"]
        assert all(w.strip() for w in t["terms"].values()), t["key"]
        if t["key"] != "tattoo":   # (a substring check would trip on "מתאמן", which contains "אמן")
            assert t["terms"]["staff"] != "אמן/ית" and t["terms"]["staff_plural"] != "אמנים", t["key"]
            assert not any("קעקוע" in v for v in t["terms"].values()), t["key"]
    assert set(GENERIC_TERMS) == set(TERM_LABELS)


def test_the_words_come_from_the_field_and_the_owner_changes_win(db_session):
    nails = _studio(db_session, "nails-1", "nails")
    other = _studio(db_session, "other-1", "other")
    assert studio_terms(db_session, nails.id)["staff"] == "מניקוריסטית"
    assert studio_terms(db_session, other.id) == GENERIC_TERMS
    db_session.get(StudioSettings, nails.id).business_terms = {"staff": "טכנאית ציפורניים", "bogus": "x", "place": " "}
    db_session.commit()
    words = studio_terms(db_session, nails.id)
    assert words["staff"] == "טכנאית ציפורניים" and words["place"] == "סטודיו" and "bogus" not in words


def test_the_owner_changes_a_word_and_can_go_back_to_the_fields(client, db_session):
    h = register_and_login(client, slug="words", email="owner@words.com")
    client.patch("/api/studio/upload/business-type", headers=h, json={"business_type": "dental"})
    r = client.get("/api/studio/upload/terms", headers=h).json()
    assert r["terms"]["staff"] == "מטפל/ת" and r["field"]["client"] == "מטופל/ת" and r["own"] == {}
    r = client.patch("/api/studio/upload/terms", headers=h, json={"own": {"staff": "שיננית"}}).json()
    assert r["terms"]["staff"] == "שיננית" and r["own"] == {"staff": "שיננית"}
    r = client.patch("/api/studio/upload/terms", headers=h, json={"own": {"staff": "מטפל/ת"}}).json()   # the field's word
    assert r["own"] == {} and r["terms"]["staff"] == "מטפל/ת"
    assert client.patch("/api/studio/upload/terms", headers=h, json={"own": {"x": "y"}}).status_code == 400
    assert client.patch("/api/studio/upload/terms", headers=h, json={"own": {"staff": "א" * 31}}).status_code == 400


def test_a_booking_request_names_the_staff_in_the_businesss_words(db_session):
    from app.api.public_routes import _notify_booking_request
    studio = _studio(db_session, "clinic", "medical")
    req = SimpleNamespace(client_name="רותם", client_phone="0501234567", service_note=None,
                          requested_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc))
    artist = SimpleNamespace(display_name="דנה", email="d@x.com", phone="0529999999")
    _notify_booking_request(db_session, req, studio, SimpleNamespace(timezone="Asia/Jerusalem"), artist)
    db_session.flush()
    (job,) = db_session.scalars(select(MessageJob).where(MessageJob.studio_id == studio.id)).all()
    assert "מטפל/ת: דנה" in job.body and "אמן" not in job.body


def test_the_ai_is_told_the_businesss_field_and_words(db_session, monkeypatch):
    from app.services.ai.orchestrator import _build_system_prompt, business_context
    studio = _studio(db_session, "gym-1", "gym")
    field, words = business_context(db_session, studio.id)
    prompt = _build_system_prompt("כושר פלוס", "owner", "/dashboard", field, words)
    assert "מכון כושר ואימונים" in prompt and "מאמן/ת" in prompt and "מתאמן/ת" in prompt
    assert "קעקוע" not in prompt

    import app.services.auto_tag_service as tag
    seen = {}

    class _Fake:
        class messages:
            @staticmethod
            def create(**kw):
                seen["prompt"] = kw["messages"][0]["content"]
                return SimpleNamespace(content=[SimpleNamespace(text='{"service_interest": null, "temperature": "warm"}')])

    monkeypatch.setattr(tag, "_get_client", lambda: _Fake)
    tag._classify_sync("כמה עולה אימון אישי?", "מכון כושר ואימונים", ["אימון אישי", "אימון זוגי"])
    assert "מכון כושר ואימונים" in seen["prompt"] and "אימון אישי" in seen["prompt"] and "קעקוע" not in seen["prompt"]

    from app.services.call_ai import _SUMMARY_PROMPT
    rendered = _SUMMARY_PROMPT.replace("{business_field}", "מרפאת שיניים ושיננית").replace("{transcript}", "שלום")
    assert "מרפאת שיניים ושיננית" in rendered and '"intent"' in rendered and "קעקוע" not in rendered
