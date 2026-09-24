"""
Test setup. The database tests run ONLY against a local Postgres — docker compose's `db` service
(localhost:5433) — never against production:

    docker compose up -d db
    C:\\Users\\naor1\\.bizcontrol\\venv\\Scripts\\python -m pytest

- The tests use their own database, bizcontrol_test (created on first run), not the dev database
  in .env. A non-local TEST_DATABASE_URL is refused before anything connects.
- Each test gets a fresh schema, built the way production builds it (the ORM models + start.py's
  raw SQL), and dropped afterwards.
- Nothing can be sent: the e-mail and WhatsApp senders are replaced by a recorder, and a test that
  tried to send anything fails.
"""
import contextlib
import io
import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://bizcontrol:bizcontrol@localhost:5433/bizcontrol_test")
_host = urlparse(TEST_DATABASE_URL).hostname
if _host not in ("localhost", "127.0.0.1", "::1"):
    raise SystemExit(f"Tests run only against a local database — refusing {_host!r}.")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL   # set before the app is imported; .env never overrides it
os.environ["DISABLE_SCHEDULER"] = "1"            # no background jobs during tests
os.environ["ENVIRONMENT"] = "development"
os.environ.setdefault("JWT_SECRET", "test-secret")

import psycopg2  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.main as app_main  # noqa: E402
from app.core import database as core_db  # noqa: E402
from app.db import deps as db_deps  # noqa: E402
from app.db import session as db_session_mod  # noqa: E402
from app.models import Base  # noqa: E402  (imports every model)

app = app_main.app
app_main.run_migrations = lambda: None   # each test builds its own schema below

SENT: list = []


@pytest.fixture(scope="session")
def _test_database():
    """Create the bizcontrol_test database once if it does not exist yet."""
    u = urlparse(TEST_DATABASE_URL)
    name = u.path.lstrip("/")
    try:
        admin = psycopg2.connect(u._replace(path="/postgres").geturl(), connect_timeout=5)
    except psycopg2.OperationalError as e:
        pytest.fail(f"The local test database is not running ({e}). Start it with: docker compose up -d db")
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
        if not c.fetchone():
            c.execute(f'CREATE DATABASE "{name}"')
    admin.close()


class _SavepointCursor:
    """Runs each statement in its own savepoint. start.py has only ever run on an existing database
    (it alters invoice_settings before creating it), so on a fresh schema some statements fail on the
    first pass and succeed on the second."""

    def __init__(self, cur, side):
        self._c, self._sp = cur, side      # savepoints go through a side cursor so results stay readable

    def execute(self, sql, params=None):
        self._sp.execute("SAVEPOINT s")
        try:
            self._c.execute(sql, params)
            self._sp.execute("RELEASE SAVEPOINT s")
        except Exception:
            self._sp.execute("ROLLBACK TO SAVEPOINT s")

    def fetchone(self):
        return self._c.fetchone()

    def fetchall(self):
        return self._c.fetchall()

    def close(self):
        pass

    def __getattr__(self, k):
        return getattr(self._c, k)


class _SharedConnection:
    def __init__(self, con):
        self._c = con

    def cursor(self):
        return _SavepointCursor(self._c.cursor(), self._c.cursor())

    def commit(self):
        self._c.commit()

    def rollback(self):
        self._c.rollback()

    def close(self):
        pass


def _build_production_schema(con):
    import start

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(psycopg2, "connect", lambda *a, **k: _SharedConnection(con))
        for _ in range(2):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                start.ensure_schema()
    assert "Schema verified/updated successfully" in out.getvalue(), out.getvalue()[-600:]


@pytest.fixture()
def db_session(_test_database, monkeypatch):
    schema = f"test_{uuid.uuid4().hex[:16]}"
    con = psycopg2.connect(TEST_DATABASE_URL, options=f"-c search_path={schema}")
    with con.cursor() as c:
        c.execute(f'CREATE SCHEMA "{schema}"')
    con.commit()
    eng = create_engine("postgresql+psycopg2://", creator=lambda: con, poolclass=StaticPool, pool_reset_on_return=None)
    Base.metadata.create_all(bind=eng)
    _build_production_schema(con)

    TestSession = sessionmaker(bind=eng, autoflush=False, autocommit=False)
    import app.middleware.plan_enforcement as pe
    import app.services.email_center as ec
    import app.services.message_worker as mw
    import app.utils.email_utils as eu
    monkeypatch.setattr(db_session_mod, "SessionLocal", TestSession)
    monkeypatch.setattr(core_db, "SessionLocal", TestSession)
    monkeypatch.setattr(pe, "SessionLocal", TestSession)
    pe._CACHE.clear()
    SENT.clear()
    monkeypatch.setattr(ec, "send_email", lambda db, **kw: SENT.append(("email", kw.get("to_email"))) or True)
    monkeypatch.setattr(eu, "send_email_sync", lambda **kw: SENT.append(("email", kw.get("to_email"))) or True)
    monkeypatch.setattr(mw, "send_whatsapp_message", lambda to, body, *a, **k: SENT.append(("whatsapp", to)))

    db = TestSession()
    try:
        yield db
    finally:
        db.close()
        con.rollback()
        with con.cursor() as c:
            c.execute(f'DROP SCHEMA "{schema}" CASCADE')
        con.commit()
        con.close()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[core_db.get_db] = override_get_db
    app.dependency_overrides[db_deps.get_db] = override_get_db
    from app.core.limiter import limiter
    limiter.reset()   # each test starts with fresh rate-limit counters (login allows 10 a minute)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    assert SENT == [], f"a test tried to send a real message: {SENT}"


def register_and_login(client, slug: str, email: str):
    r = client.post("/api/studios/register", json={
        "name": f"Studio {slug}",
        "slug": slug,
        "email": email,
        "password": "password123"
    })
    assert r.status_code == 200, r.text

    r = client.post("/api/auth/login", json={
        "studio_slug": slug,
        "email": email,
        "password": "password123"
    })
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
