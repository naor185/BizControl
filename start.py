import os
import uvicorn


def ensure_schema():
    """Create missing tables/columns from recent migrations using IF NOT EXISTS.
    Safe to run on every startup — idempotent."""
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        print("[start] No DATABASE_URL — skipping schema check.")
        return

    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    try:
        import psycopg2
        conn = psycopg2.connect(database_url)
        conn.autocommit = False
        cur = conn.cursor()

        # ── Tables ──────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS studio_notes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                created_by_email VARCHAR(255) NOT NULL,
                body TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_studio_notes_studio_id ON studio_notes (studio_id)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS leads (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                email VARCHAR(255),
                source VARCHAR(32) NOT NULL DEFAULT 'manual',
                status VARCHAR(32) NOT NULL DEFAULT 'new',
                service_interest VARCHAR(255),
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_leads_studio_id ON leads (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_leads_status ON leads (studio_id, status)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS studio_integrations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                platform VARCHAR(32) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT FALSE,
                expires_at TIMESTAMPTZ,
                phone_number_id VARCHAR(255),
                access_token VARCHAR(1024),
                page_id VARCHAR(128),
                instagram_account_id VARCHAR(128),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (studio_id, platform)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_studio_integrations_studio_id ON studio_integrations (studio_id)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                admin_id VARCHAR(64) NOT NULL,
                admin_email VARCHAR(255) NOT NULL,
                action VARCHAR(64) NOT NULL,
                studio_id VARCHAR(64),
                studio_name VARCHAR(255),
                details JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_admin_id ON audit_logs (admin_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_studio_id ON audit_logs (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs (created_at)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS booking_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                artist_id UUID REFERENCES users(id) ON DELETE SET NULL,
                client_name VARCHAR(160) NOT NULL,
                client_phone VARCHAR(32) NOT NULL,
                client_email VARCHAR(255),
                service_note TEXT,
                requested_at TIMESTAMPTZ NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                rejection_reason TEXT,
                reviewed_by_id UUID,
                reviewed_at TIMESTAMPTZ,
                appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_booking_requests_studio_id ON booking_requests (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_booking_requests_artist_id ON booking_requests (artist_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_booking_requests_status ON booking_requests (status)")

        # ── Columns ─────────────────────────────────────────────────────────
        for stmt in [
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS facebook_page_id VARCHAR(64)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS instagram_account_id VARCHAR(64)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS meta_page_access_token TEXT",
            "ALTER TABLE studio_settings ALTER COLUMN whatsapp_api_key TYPE TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS self_booking_enabled BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS self_booking_slot_minutes INTEGER NOT NULL DEFAULT 60",
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_name VARCHAR(255)",
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_id VARCHAR(128)",
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_id VARCHAR(128)",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(128)",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(128)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32)",
        ]:
            cur.execute(stmt)

        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS ix_leads_external_id
            ON leads (studio_id, external_id)
            WHERE external_id IS NOT NULL
        """)

        conn.commit()
        cur.close()
        conn.close()
        print("[start] Schema verified/updated successfully.")
    except Exception as e:
        print(f"[start] Schema update warning: {e}")


if __name__ == "__main__":
    ensure_schema()
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        workers=1,
        timeout_keep_alive=120,
    )
