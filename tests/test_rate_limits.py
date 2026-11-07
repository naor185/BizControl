"""Rate limits before the launch (the owner, 2026-11-07). Behind Railway's proxy every visitor came from the proxy's
address, so a limit was one limit for everyone — 10 sign-ins a minute for the whole platform. The visitor's address is
read from X-Forwarded-For now, from the right (the left can be forged). The public forms — joining the club, booking,
a gift card, signing a business up — had no limit at all: a script could fill a business's CRM with fake clients and
have its WhatsApp message strangers. Local test database; the senders are fakes — nothing is sent."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from starlette.requests import Request

from app.core.limiter import TOO_MANY, client_ip, rate_limit
from app.models.client import Client
from app.models.studio import Studio
from tests.conftest import register_and_login


def _req(forwarded: str | None, host: str = "100.64.0.7") -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    return Request({"type": "http", "headers": headers, "client": (host, 1234)})


def test_the_visitor_is_the_address_the_proxy_added_not_one_the_visitor_wrote():
    assert client_ip(_req("31.154.10.20")) == "31.154.10.20"
    # a visitor who writes an address of their own gets it on the left — the proxy's is on the right
    assert client_ip(_req("1.2.3.4, 31.154.10.20")) == "31.154.10.20"
    # the proxies' own internal addresses are skipped
    assert client_ip(_req("31.154.10.20, 10.0.0.5, 100.64.1.1")) == "31.154.10.20"
    # nothing forwarded — whoever connected
    assert client_ip(_req(None, host="31.154.10.21")) == "31.154.10.21"


def _app(**limits):
    app = FastAPI()

    @app.post("/b/{slug}/go", dependencies=[rate_limit(**limits)])
    def go(slug: str):
        return {"ok": True}

    return TestClient(app)


def test_one_visitor_is_stopped_and_another_still_gets_in():
    c = _app(per_visitor="2/minute")
    me, other = {"X-Forwarded-For": "31.154.10.30"}, {"X-Forwarded-For": "31.154.10.31"}
    assert [c.post("/b/x/go", headers=me).status_code for _ in range(3)] == [200, 200, 429]
    r = c.post("/b/x/go", headers=me)
    assert r.status_code == 429 and r.json()["detail"] == TOO_MANY
    assert c.post("/b/x/go", headers=other).status_code == 200


def test_many_addresses_together_cant_flood_one_business():
    c = _app(per_visitor="5/minute", per_business="3/minute")
    codes = [c.post("/b/flooded/go", headers={"X-Forwarded-For": f"31.154.11.{i}"}).status_code for i in range(1, 5)]
    assert codes == [200, 200, 200, 429]
    # another business's page is counted apart
    assert c.post("/b/quiet/go", headers={"X-Forwarded-For": "31.154.11.9"}).status_code == 200


def test_joining_the_club_from_one_address_stops_after_ten_a_minute(client, db_session):
    register_and_login(client, slug="rl-join", email="owner@rl-join.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "rl-join"))
    s.subscription_plan = "pro"          # the club is in the plan
    db_session.commit()
    me = {"X-Forwarded-For": "31.154.12.1"}
    codes = [client.post(f"/api/public/studio/{s.id}/join", headers=me,
                         json={"full_name": f"לקוח {i}", "phone": f"05011100{i:02d}"}).status_code for i in range(11)]
    assert codes == [200] * 10 + [429]
    assert db_session.scalar(select(func.count(Client.id)).where(Client.studio_id == s.id)) == 10
    # a client joining from another address is not held up by it
    r = client.post(f"/api/public/studio/{s.id}/join", headers={"X-Forwarded-For": "31.154.12.2"},
                    json={"full_name": "לקוחה אמיתית", "phone": "0509998877"})
    assert r.status_code == 200


def test_a_limit_inside_a_module_with_postponed_annotations_still_reads_the_body(client, db_session):
    """booking_routes has `from __future__ import annotations` — slowapi's decorator there made FastAPI read the body
    as a query parameter (422, the BizFind reviews, 2026-09-25); the dependency doesn't."""
    register_and_login(client, slug="rl-wait", email="owner@rl-wait.com")
    r = client.post("/api/book/rl-wait/wait-list", headers={"X-Forwarded-For": "31.154.13.1"},
                    json={"client_name": "נועה", "client_phone": "0504443322"})
    assert r.status_code == 201, r.text


def test_too_many_sign_ins_are_refused_in_words_not_raw_text(client):
    me = {"X-Forwarded-For": "31.154.14.1"}
    for _ in range(10):
        client.post("/api/auth/login-by-email", headers=me, json={"email": "nobody@x.com", "password": "wrong-pass1"})
    r = client.post("/api/auth/login-by-email", headers=me, json={"email": "nobody@x.com", "password": "wrong-pass1"})
    assert r.status_code == 429 and r.json() == {"detail": TOO_MANY}
    r = client.post("/api/auth/login-by-email", headers={**me, "X-Lang": "en"},
                    json={"email": "nobody@x.com", "password": "wrong-pass1"})
    assert r.json() == {"detail": "Too many requests — try again in a few minutes"}
    # someone else signs in as usual
    other = client.post("/api/auth/login-by-email", headers={"X-Forwarded-For": "31.154.14.2"},
                        json={"email": "nobody@x.com", "password": "wrong-pass1"})
    assert other.status_code != 429
