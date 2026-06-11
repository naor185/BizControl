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
            CREATE TABLE IF NOT EXISTS broadcasts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL,
                created_by UUID,
                title VARCHAR(255) NOT NULL,
                body TEXT NOT NULL,
                audience VARCHAR(50) NOT NULL DEFAULT 'all',
                scheduled_at TIMESTAMPTZ NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
                recipient_count INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_broadcasts_studio_id ON broadcasts (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_broadcasts_status ON broadcasts (status)")

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
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_quota INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_used INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_reset_month VARCHAR(7)",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS pretax_amount NUMERIC(10,2)",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(64)",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes TEXT",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sent_to_accountant BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sent_to_accountant_at TIMESTAMPTZ",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS business_type VARCHAR(64) NOT NULL DEFAULT 'other'",
        ]:
            cur.execute(stmt)

        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS ix_leads_external_id
            ON leads (studio_id, external_id)
            WHERE external_id IS NOT NULL
        """)

        # ── Phase 6: Multi-Location ──────────────────────────────────────────
        for stmt in [
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS organization_id UUID",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS location_name VARCHAR(128)",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS is_main_location BOOLEAN NOT NULL DEFAULT true",
        ]:
            cur.execute(stmt)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_studios_org ON studios (organization_id) WHERE organization_id IS NOT NULL")

        # ── Phase 4: Marketplace ─────────────────────────────────────────────
        for stmt in [
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_visible BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_description TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_city VARCHAR(64)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_cover_url TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_phone VARCHAR(32)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS notification_phone VARCHAR(32)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_instagram VARCHAR(255)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_whatsapp VARCHAR(32)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_hours TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_facebook VARCHAR(255)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_tiktok VARCHAR(255)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_website VARCHAR(255)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS marketplace_youtube VARCHAR(255)",
        ]:
            cur.execute(stmt)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS studio_reviews (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_name VARCHAR(120) NOT NULL,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                comment TEXT,
                is_approved BOOLEAN NOT NULL DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_studio_reviews_studio ON studio_reviews (studio_id, is_approved)")

        # ── Phase 3: Wait List + Online Booking ──────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS wait_list (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
                client_name VARCHAR(160),
                client_phone VARCHAR(32),
                service_id UUID REFERENCES services(id) ON DELETE SET NULL,
                preferred_artist_id UUID REFERENCES users(id) ON DELETE SET NULL,
                notes TEXT,
                status VARCHAR(16) NOT NULL DEFAULT 'waiting',
                notified_at TIMESTAMPTZ,
                confirmed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_wait_list_studio_status ON wait_list (studio_id, status)")

        # ── Phase 2: Automation Rule Engine ──────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS automation_rules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                name VARCHAR(128) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT true,
                trigger_event VARCHAR(64) NOT NULL,
                trigger_conditions JSONB NOT NULL DEFAULT '{}',
                actions JSONB NOT NULL DEFAULT '[]',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_automation_rules_studio ON automation_rules (studio_id, trigger_event)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS automation_executions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
                studio_id UUID NOT NULL,
                trigger_event VARCHAR(64) NOT NULL,
                context_data JSONB NOT NULL DEFAULT '{}',
                status VARCHAR(16) NOT NULL DEFAULT 'ok',
                error TEXT,
                executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_automation_exec_rule ON automation_executions (rule_id)")

        # ── Phase 1: Service Catalog ──────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS services (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                name VARCHAR(128) NOT NULL,
                description TEXT,
                duration_minutes INTEGER NOT NULL DEFAULT 60,
                price_cents INTEGER NOT NULL DEFAULT 0,
                color VARCHAR(16) NOT NULL DEFAULT '#7c3aed',
                category VARCHAR(64),
                is_active BOOLEAN NOT NULL DEFAULT true,
                requires_consultation BOOLEAN NOT NULL DEFAULT false,
                is_bookable_online BOOLEAN NOT NULL DEFAULT false,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_services_studio ON services (studio_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS service_staff (
                service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (service_id, user_id)
            )
        """)
        cur.execute("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS studio_gallery (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                url TEXT NOT NULL,
                caption VARCHAR(255),
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_studio_gallery_studio ON studio_gallery (studio_id, sort_order)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS hero_slides (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                url TEXT NOT NULL,
                label VARCHAR(120) NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_hero_slides_sort ON hero_slides (sort_order) WHERE is_active")

        # ── Phase 0: Module System ────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS modules (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                description TEXT,
                category VARCHAR(32) NOT NULL DEFAULT 'core',
                is_available BOOLEAN NOT NULL DEFAULT true,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS studio_modules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                module_id VARCHAR(64) NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
                is_enabled BOOLEAN NOT NULL,
                enabled_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(studio_id, module_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_studio_modules_studio ON studio_modules (studio_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS plan_modules (
                plan VARCHAR(32) NOT NULL,
                module_id VARCHAR(64) NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
                PRIMARY KEY (plan, module_id)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS business_type_templates (
                business_type VARCHAR(64) PRIMARY KEY,
                display_name VARCHAR(128) NOT NULL,
                default_modules JSONB NOT NULL DEFAULT '[]',
                default_services JSONB NOT NULL DEFAULT '[]'
            )
        """)

        # ── Seed module registry (idempotent) ─────────────────────────────────
        MODULES = [
            ("crm",                "core",          "CRM & לקוחות",              0),
            ("calendar",           "core",          "יומן & תורים",              1),
            ("payments",           "core",          "תשלומים & חשבוניות",        2),
            ("whatsapp",           "communication", "WhatsApp אוטומציה",          3),
            ("email",              "communication", "Email אוטומציה",             4),
            ("sms",                "communication", "SMS",                         5),
            ("customer_club",      "advanced",      "מועדון לקוחות & נקודות",    6),
            ("wallet",             "advanced",      "Digital Wallet Pass",         7),
            ("ocr",                "ai",            "סריקת מסמכים & OCR",         8),
            ("ai_assistant",       "ai",            "עוזר AI (ויקי)",             9),
            ("online_booking",     "marketplace",   "קביעת תורים אונליין",       10),
            ("marketplace",        "marketplace",   "פרופיל ציבורי & Marketplace",11),
            ("wait_list",          "advanced",      "רשימת המתנה",                12),
            ("gift_cards",         "advanced",      "כרטיסי מתנה",               13),
            ("analytics",          "advanced",      "Analytics מתקדם",            14),
            ("multi_location",     "advanced",      "ריבוי סניפים",              15),
            ("employee_mgmt",      "core",          "ניהול צוות & שכר",          16),
            ("automation_builder", "advanced",      "בונה אוטומציות (WHEN/THEN)",17),
        ]
        for mid, cat, name, sort in MODULES:
            cur.execute("""
                INSERT INTO modules (id, name, category, sort_order)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category
            """, (mid, name, cat, sort))

        # ── Seed plan → module defaults (idempotent) ──────────────────────────
        PLAN_MODULES = {
            "free":       ["crm", "calendar"],
            "starter":    ["crm", "calendar", "payments", "whatsapp", "email"],
            "pro":        ["crm", "calendar", "payments", "whatsapp", "email",
                           "customer_club", "ocr", "ai_assistant", "employee_mgmt"],
            "enterprise": ["crm", "calendar", "payments", "whatsapp", "email", "sms",
                           "customer_club", "wallet", "ocr", "ai_assistant",
                           "online_booking", "marketplace", "wait_list", "gift_cards",
                           "analytics", "multi_location", "employee_mgmt", "automation_builder"],
            "platform":   ["crm", "calendar", "payments", "whatsapp", "email", "sms",
                           "customer_club", "wallet", "ocr", "ai_assistant",
                           "online_booking", "marketplace", "wait_list", "gift_cards",
                           "analytics", "multi_location", "employee_mgmt", "automation_builder"],
        }
        for plan, mods in PLAN_MODULES.items():
            for mod in mods:
                cur.execute("""
                    INSERT INTO plan_modules (plan, module_id) VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                """, (plan, mod))

        # ── Seed business type templates (idempotent) ─────────────────────────
        import json as _json
        BT = [
            ("tattoo", "סטודיו קעקועים", ["crm","calendar","payments","whatsapp","customer_club","ocr"],
             [{"name":"ייעוץ","duration_minutes":60,"price":0,"color":"#8b5cf6"},
              {"name":"קעקוע קטן","duration_minutes":120,"price":300,"color":"#7c3aed"},
              {"name":"קעקוע בינוני","duration_minutes":240,"price":600,"color":"#6d28d9"},
              {"name":"קעקוע גדול","duration_minutes":360,"price":900,"color":"#5b21b6"}]),
            ("barber", "ספר / ברברשופ", ["crm","calendar","payments","whatsapp","online_booking","wait_list"],
             [{"name":"תספורת","duration_minutes":30,"price":60,"color":"#0ea5e9"},
              {"name":"זקן","duration_minutes":20,"price":40,"color":"#0284c7"},
              {"name":"תספורת + זקן","duration_minutes":45,"price":90,"color":"#0369a1"}]),
            ("nails", "ציפורניים", ["crm","calendar","payments","whatsapp","online_booking"],
             [{"name":"מניקור","duration_minutes":45,"price":80,"color":"#ec4899"},
              {"name":"פדיקור","duration_minutes":60,"price":100,"color":"#db2777"},
              {"name":"לק ג'ל","duration_minutes":60,"price":120,"color":"#be185d"},
              {"name":"בנייה","duration_minutes":90,"price":200,"color":"#9d174d"}]),
            ("laser", "קליניקת לייזר", ["crm","calendar","payments","whatsapp","email","online_booking"],
             [{"name":"לייזר שפם","duration_minutes":30,"price":150,"color":"#f59e0b"},
              {"name":"לייזר ביקיני","duration_minutes":45,"price":250,"color":"#d97706"},
              {"name":"לייזר גב","duration_minutes":60,"price":350,"color":"#b45309"}]),
            ("pilates", "פילאטיס / כושר", ["crm","calendar","payments","whatsapp","online_booking","wait_list","customer_club"],
             [{"name":"שיעור אישי","duration_minutes":60,"price":200,"color":"#10b981"},
              {"name":"שיעור קבוצתי","duration_minutes":60,"price":80,"color":"#059669"},
              {"name":"מנוי חודשי","duration_minutes":0,"price":600,"color":"#047857"}]),
            ("spa", "ספא / קוסמטיקה", ["crm","calendar","payments","whatsapp","online_booking","customer_club"],
             [{"name":"פנים בסיסי","duration_minutes":60,"price":200,"color":"#6366f1"},
              {"name":"עיסוי שוודי","duration_minutes":60,"price":250,"color":"#4f46e5"},
              {"name":"עיסוי רקמות עמוק","duration_minutes":90,"price":320,"color":"#4338ca"}]),
            ("medical", "קליניקה / מרפאה", ["crm","calendar","payments","whatsapp","email"],
             [{"name":"ייעוץ","duration_minutes":30,"price":350,"color":"#14b8a6"},
              {"name":"טיפול","duration_minutes":60,"price":500,"color":"#0d9488"}]),
            ("other", "אחר", ["crm","calendar","payments","whatsapp"],
             [{"name":"שירות","duration_minutes":60,"price":0,"color":"#64748b"}]),
        ]
        for bt, dn, mods, svcs in BT:
            cur.execute("""
                INSERT INTO business_type_templates (business_type, display_name, default_modules, default_services)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (business_type) DO UPDATE
                    SET display_name=EXCLUDED.display_name,
                        default_modules=EXCLUDED.default_modules,
                        default_services=EXCLUDED.default_services
            """, (bt, dn, _json.dumps(mods, ensure_ascii=False), _json.dumps(svcs, ensure_ascii=False)))

        # Zero out loyalty points for non-club-member clients (one-time cleanup)
        cur.execute("""
            UPDATE clients SET loyalty_points = 0
            WHERE is_club_member = false AND loyalty_points > 0
        """)

        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS calendar_start_hour VARCHAR(16) NOT NULL DEFAULT '08:00'")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS calendar_end_hour VARCHAR(16) NOT NULL DEFAULT '23:00'")

        # ── POS / Cash Register ───────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pos_transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
                cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
                total_cents INTEGER NOT NULL,
                discount_cents INTEGER NOT NULL DEFAULT 0,
                method VARCHAR(20) NOT NULL DEFAULT 'cash',
                status VARCHAR(10) NOT NULL DEFAULT 'paid',
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_pos_transactions_studio ON pos_transactions (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_pos_transactions_client ON pos_transactions (client_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pos_transaction_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                transaction_id UUID NOT NULL REFERENCES pos_transactions(id) ON DELETE CASCADE,
                product_id UUID REFERENCES products(id) ON DELETE SET NULL,
                description VARCHAR(300) NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                unit_price_cents INTEGER NOT NULL,
                total_price_cents INTEGER NOT NULL
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_pos_transaction_items_txn ON pos_transaction_items (transaction_id)")
        # Allow paybox in existing pos_transactions if constraint is present (idempotent via DROP/ADD)
        cur.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name='pos_transactions' AND constraint_name='ck_pos_method'
                ) THEN
                    ALTER TABLE pos_transactions DROP CONSTRAINT ck_pos_method;
                END IF;
                ALTER TABLE pos_transactions ADD CONSTRAINT ck_pos_method
                    CHECK (method IN ('cash','bit','credit','credit_card','paybox','bank_transfer','apple_pay','google_pay','other'));
            END $$;
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
