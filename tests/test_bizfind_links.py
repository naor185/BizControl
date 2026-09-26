"""Every link the server sends to BizFind is built from one address (app/core/sites.py). Before, three messages
fell back to find-biz.com — an address that does not answer — when the server had no BIZFIND_URL. Local test
database; nothing is sent."""
import importlib

from sqlalchemy import select

from app.core import sites
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.studio import Studio
from tests.conftest import register_and_login


def test_the_address_until_a_new_domain_is_set(monkeypatch):
    monkeypatch.delenv("BIZFIND_URL", raising=False)
    assert importlib.reload(sites).BIZFIND_URL == "https://find.biz-control.com"
    monkeypatch.setenv("BIZFIND_URL", "https://new-domain.co.il/")
    assert importlib.reload(sites).BIZFIND_URL == "https://new-domain.co.il"
    monkeypatch.delenv("BIZFIND_URL")
    importlib.reload(sites)


def test_a_place_opened_links_to_bizfind(client, db_session):
    h = register_and_login(client, slug="waitlink", email="owner@waitlink.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "waitlink"))
    db_session.add(StudioModule(studio_id=s.id, module_id="wait_list", is_enabled=True))
    db_session.commit()
    entry = client.post("/api/wait-list", headers=h, json={"client_name": "דנה", "client_phone": "0550000001"}).json()
    assert client.post(f"/api/wait-list/{entry['id']}/notify", headers=h).status_code == 200
    body = db_session.scalar(select(MessageJob).where(MessageJob.studio_id == s.id, MessageJob.reminder_type == "waitlist_notify")).body
    assert f"{sites.BIZFIND_URL}/b/waitlink/book" in body and "find-biz.com" not in body


def test_the_logo_the_owner_uploaded_shows_on_bizfind(client, db_session):
    """A logo saved on this server (not the cloud) is only in studio_settings.logo_filename — BizFind used to read
    studios.logo_url alone and showed the business-type icon instead (Nctattoo)."""
    from app.models.studio_settings import StudioSettings
    register_and_login(client, slug="logoshop", email="owner@logoshop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "logoshop"))
    settings = db_session.get(StudioSettings, s.id)
    settings.marketplace_visible = True
    settings.logo_filename = "logo_shop.jpg"
    db_session.commit()
    assert client.get("/api/marketplace/logoshop").json()["logo_url"] == "/uploads/logo_shop.jpg"
    listed = {x["slug"]: x for x in client.get("/api/marketplace").json()["studios"]}          # the search cards
    assert listed["logoshop"]["logo_url"] == "/uploads/logo_shop.jpg"
    assert sites.logo_address("https://cloud/x.png", "https://cloud/x.png") == "https://cloud/x.png"
    assert sites.logo_address("https://cloud/old.png", None) == "https://cloud/old.png"
