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
