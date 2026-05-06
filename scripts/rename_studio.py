"""
One-time script: rename teststudio → NCTATTOO
Updates studio name, slug, and owner credentials.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from argon2 import PasswordHasher

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
ph = PasswordHasher()

NEW_NAME        = "NCTATTOO"
NEW_SLUG        = "nctattoo"
NEW_EMAIL       = "ncbilutattoo@gmail.com"
NEW_DISPLAY     = "Naor"
NEW_PASSWORD    = "Naor2024!"   # change after first login

with Session(engine) as db:
    # 1. Find studio
    result = db.execute(text("SELECT id FROM studios WHERE slug = 'teststudio'")).fetchone()
    if not result:
        print("❌ Studio 'teststudio' not found. Checking existing studios...")
        all_studios = db.execute(text("SELECT slug, name FROM studios")).fetchall()
        for s in all_studios:
            print(f"  • {s.slug} — {s.name}")
        sys.exit(1)

    studio_id = result.id
    print(f"[OK] Found studio: {studio_id}")

    # 2. Update studio
    db.execute(text("""
        UPDATE studios
        SET name = :name, slug = :slug
        WHERE id = :id
    """), {"name": NEW_NAME, "slug": NEW_SLUG, "id": studio_id})
    print(f"[OK] Studio renamed -> {NEW_NAME} (slug: {NEW_SLUG})")

    # 3. Find owner user
    owner = db.execute(text("""
        SELECT id FROM users WHERE studio_id = :sid AND role = 'owner'
    """), {"sid": studio_id}).fetchone()

    if owner:
        new_hash = ph.hash(NEW_PASSWORD)
        db.execute(text("""
            UPDATE users
            SET email = :email, display_name = :name, password_hash = :pw
            WHERE id = :id
        """), {
            "email": NEW_EMAIL,
            "name": NEW_DISPLAY,
            "pw": new_hash,
            "id": owner.id
        })
        print(f"[OK] Owner updated -> {NEW_EMAIL}")
    else:
        print("[WARN] No owner user found for this studio")

    db.commit()
    print("\n[DONE] Login details:")
    print(f"   Slug:     {NEW_SLUG}")
    print(f"   Email:    {NEW_EMAIL}")
    print(f"   Password: {NEW_PASSWORD}")
