"""Green API is called on the instance's own host (2026-10-11): the old shared api.green-api.com stopped answering
and every WhatsApp failed with state "unknown" while the phone was connected. Nothing is sent."""
import app.services.message_worker as mw
from app.utils.green_api import instance_url


def test_every_call_goes_to_the_instances_own_host(monkeypatch):
    assert instance_url("7105123456", "sendMessage", "tok") == "https://7105.api.greenapi.com/waInstance7105123456/sendMessage/tok"
    asked = []

    class _Answer:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"stateInstance": "authorized"}'

    monkeypatch.setattr(mw._ur if hasattr(mw, "_ur") else __import__("urllib.request").request, "urlopen",
                        lambda req, timeout=0: asked.append(req.full_url) or _Answer())
    mw._green_state_cache.clear()
    assert mw._check_green_state("7105123456", "tok") == "authorized"
    assert asked == ["https://7105.api.greenapi.com/waInstance7105123456/getStateInstance/tok"]
