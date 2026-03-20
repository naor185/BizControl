import os
import uuid
import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

# מכבים scheduler בבדיקות כדי שלא ירוץ ברקע
os.environ["DISABLE_SCHEDULER"] = "1"

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import app
from app.core.database import engine
from app.core.database import get_db
from app.models import Base  # חשוב: מייבא את כל המודלים לרישום metadata

@pytest.fixture()
def db_session():
    schema = f"test_{uuid.uuid4().hex}"

    conn = engine.connect()
    conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    conn.execute(text(f'SET search_path TO "{schema}"'))

    Base.metadata.create_all(bind=conn)

    TestingSessionLocal = sessionmaker(bind=conn, autoflush=False, autocommit=False)
    db = TestingSessionLocal()

    try:
        yield db
    finally:
        db.close()
        # מוחקים הכל בבום, בלי להשאיר לכלוך
        conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        conn.close()

@pytest.fixture()
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()

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
