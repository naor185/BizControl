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
            # WhatsApp integration columns — added idempotently
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS whatsapp_provider VARCHAR(64)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS whatsapp_phone_id VARCHAR(255)",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS whatsapp_api_key TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS whatsapp_instance_id VARCHAR(255)",
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
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS points_balance_wa_template TEXT",
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
            # Nav-level modules (control sidebar visibility)
            ("pos",          "core",    "קופה",           18),
            ("products",     "core",    "מוצרים",          19),
            ("expenses",     "core",    "הוצאות",          20),
            ("obligations",  "core",    "התחייבויות",      21),
            ("services",     "core",    "שירותים",         22),
            ("broadcasts",   "core",    "תפוצות",          23),
        ]
        for mid, cat, name, sort in MODULES:
            cur.execute("""
                INSERT INTO modules (id, name, category, sort_order)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category
            """, (mid, name, cat, sort))

        # ── Seed plan → module defaults (idempotent) ──────────────────────────
        _NAV_MODULES = ["pos", "products", "expenses", "obligations", "services", "broadcasts"]
        PLAN_MODULES = {
            "free":       ["crm", "calendar"] + _NAV_MODULES,
            "starter":    ["crm", "calendar", "payments", "whatsapp", "email"] + _NAV_MODULES,
            "pro":        ["crm", "calendar", "payments", "whatsapp", "email",
                           "customer_club", "ocr", "ai_assistant", "employee_mgmt"] + _NAV_MODULES,
            "enterprise": ["crm", "calendar", "payments", "whatsapp", "email", "sms",
                           "customer_club", "wallet", "ocr", "ai_assistant",
                           "online_booking", "marketplace", "wait_list", "gift_cards",
                           "analytics", "multi_location", "employee_mgmt", "automation_builder"] + _NAV_MODULES,
            "platform":   ["crm", "calendar", "payments", "whatsapp", "email", "sms",
                           "customer_club", "wallet", "ocr", "ai_assistant",
                           "online_booking", "marketplace", "wait_list", "gift_cards",
                           "analytics", "multi_location", "employee_mgmt", "automation_builder"] + _NAV_MODULES,
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

        # ── BizFind Marketplace Customer Auth ────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS marketplace_customers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                phone VARCHAR(20) NOT NULL UNIQUE,
                first_name VARCHAR(80) NOT NULL DEFAULT '',
                last_name VARCHAR(80) NOT NULL DEFAULT '',
                email VARCHAR(255),
                city VARCHAR(120),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_login_at TIMESTAMPTZ
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_marketplace_customers_phone ON marketplace_customers (phone)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS marketplace_otps (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                phone VARCHAR(20) NOT NULL,
                code VARCHAR(6) NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_marketplace_otps_phone ON marketplace_otps (phone, expires_at)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS marketplace_favorites (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                customer_id UUID NOT NULL REFERENCES marketplace_customers(id) ON DELETE CASCADE,
                studio_slug VARCHAR(120) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (customer_id, studio_slug)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_marketplace_favorites_customer ON marketplace_favorites (customer_id)")

        # ── Platform Config (key-value system settings) ───────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS platform_config (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── Financial Obligations ─────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS financial_obligations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                title VARCHAR(200) NOT NULL,
                counterparty VARCHAR(200),
                direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming','outgoing')),
                notes TEXT,
                total_amount_cents INTEGER NOT NULL,
                monthly_payment_cents INTEGER NOT NULL,
                day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
                start_date DATE NOT NULL,
                months_paid INTEGER NOT NULL DEFAULT 0,
                task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
                status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
                color VARCHAR(7) NOT NULL DEFAULT '#f97316',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_financial_obligations_studio ON financial_obligations (studio_id)")

        # ── Invoice / Document System ─────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS invoice_settings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL UNIQUE REFERENCES studios(id) ON DELETE CASCADE,
                business_type VARCHAR(20) NOT NULL DEFAULT 'osek_patur',
                business_name VARCHAR(200),
                business_number VARCHAR(20),
                vat_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
                business_address TEXT,
                business_city VARCHAR(100),
                business_phone VARCHAR(32),
                business_email VARCHAR(255),
                logo_url TEXT,
                signature_url TEXT,
                payment_terms TEXT,
                default_notes TEXT,
                settings_completed BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("ALTER TABLE invoice_settings ADD COLUMN IF NOT EXISTS settings_completed BOOLEAN NOT NULL DEFAULT FALSE")
        cur.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS business_city VARCHAR(100)")
        cur.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_invoices_appointment ON invoices (appointment_id)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS invoice_series (
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                doc_type VARCHAR(30) NOT NULL,
                next_number INTEGER NOT NULL DEFAULT 1000,
                PRIMARY KEY (studio_id, doc_type)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS invoices (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE RESTRICT,
                doc_type VARCHAR(30) NOT NULL,
                doc_number INTEGER NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'issued',

                client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
                client_name VARCHAR(200),
                client_phone VARCHAR(32),
                client_email VARCHAR(255),
                client_address TEXT,
                client_business_number VARCHAR(20),

                business_name VARCHAR(200) NOT NULL,
                business_type VARCHAR(20) NOT NULL,
                business_number VARCHAR(20),
                business_address TEXT,
                business_phone VARCHAR(32),
                business_email VARCHAR(255),
                business_logo_url TEXT,

                subtotal_cents INTEGER NOT NULL DEFAULT 0,
                vat_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
                vat_amount_cents INTEGER NOT NULL DEFAULT 0,
                total_cents INTEGER NOT NULL DEFAULT 0,
                tip_cents INTEGER NOT NULL DEFAULT 0,

                payment_method VARCHAR(30),
                payment_reference VARCHAR(200),
                payment_date DATE,

                credited_by_id UUID,
                credits_invoice_id UUID,

                notes TEXT,
                payment_terms TEXT,
                signature_url TEXT,

                source VARCHAR(20) DEFAULT 'manual',
                source_id UUID,
                issued_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
                pdf_url TEXT,

                issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                UNIQUE (studio_id, doc_type, doc_number)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_invoices_studio ON invoices (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_invoices_client ON invoices (studio_id, client_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_invoices_issued_at ON invoices (studio_id, issued_at)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS invoice_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                description VARCHAR(300) NOT NULL,
                quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
                unit_price_cents INTEGER NOT NULL,
                total_price_cents INTEGER NOT NULL,
                product_id UUID REFERENCES products(id) ON DELETE SET NULL,
                service_id UUID REFERENCES services(id) ON DELETE SET NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_invoice_items_invoice ON invoice_items (invoice_id)")

        # ── WhatsApp Multi-Tenant Connections ────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_connections (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL UNIQUE REFERENCES studios(id) ON DELETE CASCADE,
                provider VARCHAR(50) NOT NULL DEFAULT 'green_api',
                instance_id VARCHAR(255),
                api_token TEXT,
                phone_number VARCHAR(50),
                status VARCHAR(50) NOT NULL DEFAULT 'disconnected',
                managed BOOLEAN NOT NULL DEFAULT false,
                last_connected_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_whatsapp_conn_studio ON whatsapp_connections (studio_id)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
                phone VARCHAR(50),
                direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
                message TEXT,
                status VARCHAR(50) NOT NULL DEFAULT 'sent',
                provider VARCHAR(30),
                instance_id VARCHAR(255),
                error_message TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_whatsapp_logs_studio ON whatsapp_logs (studio_id, created_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_whatsapp_logs_client ON whatsapp_logs (client_id)")

        # ── Gift Cards ───────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gift_cards (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                code VARCHAR(16) NOT NULL UNIQUE,
                amount_cents INTEGER NOT NULL,
                balance_cents INTEGER NOT NULL,
                recipient_name VARCHAR(120),
                recipient_email VARCHAR(255),
                recipient_phone VARCHAR(32),
                sender_name VARCHAR(120),
                personal_message TEXT,
                status VARCHAR(12) NOT NULL DEFAULT 'active',
                expires_at DATE,
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_used_at TIMESTAMPTZ
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_gift_cards_studio ON gift_cards (studio_id)")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_gift_cards_code ON gift_cards (code)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS gift_card_transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                gift_card_id UUID NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
                studio_id UUID NOT NULL,
                amount_cents INTEGER NOT NULL,
                balance_before_cents INTEGER NOT NULL,
                balance_after_cents INTEGER NOT NULL,
                redeemed_by_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
                pos_transaction_id UUID,
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_gct_card ON gift_card_transactions (gift_card_id)")

        # ── Marketplace Analytics ─────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS marketplace_page_views (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                view_date DATE NOT NULL DEFAULT CURRENT_DATE,
                count INTEGER NOT NULL DEFAULT 1,
                UNIQUE (studio_id, view_date)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_mpv_studio_date ON marketplace_page_views (studio_id, view_date)")

        # ── BizFind Business Profiles ─────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS marketplace_profiles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,

                business_name VARCHAR(200) NOT NULL,
                category VARCHAR(80),
                city VARCHAR(80),
                description TEXT,
                phone VARCHAR(32),
                whatsapp VARCHAR(32),
                logo_url TEXT,
                cover_image TEXT,

                plan_code VARCHAR(40) NOT NULL DEFAULT 'trial',
                is_active BOOLEAN NOT NULL DEFAULT true,
                is_published BOOLEAN NOT NULL DEFAULT true,

                website_url TEXT,
                instagram_url TEXT,
                facebook_url TEXT,
                tiktok_url TEXT,

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                UNIQUE (studio_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_mp_studio ON marketplace_profiles (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_mp_category ON marketplace_profiles (category)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_mp_city ON marketplace_profiles (city)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_mp_plan ON marketplace_profiles (plan_code)")

        # Backfill existing studios that have marketplace data in studio_settings
        cur.execute("""
            INSERT INTO marketplace_profiles (id, studio_id, business_name, category, city, description, phone, whatsapp, logo_url, cover_image, plan_code, is_active, is_published)
            SELECT
                gen_random_uuid(),
                s.id,
                s.name,
                NULL,
                ss.marketplace_city,
                ss.marketplace_description,
                ss.marketplace_phone,
                ss.marketplace_whatsapp,
                s.logo_url,
                ss.marketplace_cover_url,
                COALESCE(s.subscription_plan, 'trial'),
                s.is_active,
                COALESCE(ss.marketplace_visible, false)
            FROM studios s
            LEFT JOIN studio_settings ss ON ss.studio_id = s.id
            WHERE s.is_platform = false
            ON CONFLICT (studio_id) DO NOTHING
        """)

        # ── BizFind Plan Feature Flags ────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS bizfind_plan_features (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                plan_code VARCHAR(40) NOT NULL,
                feature_key VARCHAR(80) NOT NULL,
                feature_label VARCHAR(200),
                is_enabled BOOLEAN NOT NULL DEFAULT true,
                limit_value INTEGER,          -- NULL = unlimited
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (plan_code, feature_key)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_bpf_plan ON bizfind_plan_features (plan_code)")

        # Seed default feature flags per plan (idempotent via ON CONFLICT DO NOTHING)
        _plan_features = [
            # (plan_code, feature_key, feature_label, is_enabled, limit_value)
            # ── trial ──────────────────────────────────────────────────────────
            ("trial", "bizfind_listing",         "פרופיל עסקי ב-BizFind",          True,  None),
            ("trial", "online_booking",           "הזמנות תורים אונליין",            True,  None),
            ("trial", "leads_inbox",              "קבלת לידים",                      True,  None),
            ("trial", "bizcontrol_calendar",      "יומן BizControl",                 True,  None),
            ("trial", "bizcontrol_crm",           "CRM לקוחות",                      True,  None),
            ("trial", "bizcontrol_payments",      "תשלומים וקבלות",                  True,  None),
            ("trial", "bizcontrol_pos",           "קופה",                            True,  None),
            ("trial", "bizcontrol_automations",   "אוטומציות ו-WhatsApp",            True,  None),
            ("trial", "trial_days",               "ימי ניסיון",                       True,  14),
            # ── bizfind_basic ──────────────────────────────────────────────────
            ("bizfind_basic", "bizfind_listing",  "פרופיל עסקי ב-BizFind",          True,  None),
            ("bizfind_basic", "online_booking",   "הזמנות תורים אונליין",            True,  50),
            ("bizfind_basic", "leads_inbox",      "קבלת לידים",                      True,  None),
            ("bizfind_basic", "gallery",          "גלריית תמונות",                   True,  10),
            ("bizfind_basic", "bizcontrol_calendar", "יומן BizControl",              False, None),
            ("bizfind_basic", "bizcontrol_crm",   "CRM לקוחות",                      False, None),
            ("bizfind_basic", "bizcontrol_payments", "תשלומים",                      False, None),
            # ── bizfind_pro ────────────────────────────────────────────────────
            ("bizfind_pro", "bizfind_listing",    "פרופיל עסקי ב-BizFind",          True,  None),
            ("bizfind_pro", "online_booking",     "הזמנות תורים אונליין",            True,  None),
            ("bizfind_pro", "leads_inbox",        "קבלת לידים",                      True,  None),
            ("bizfind_pro", "gallery",            "גלריית תמונות",                   True,  None),
            ("bizfind_pro", "reviews",            "ביקורות ודירוג",                  True,  None),
            ("bizfind_pro", "analytics",          "סטטיסטיקות",                      True,  None),
            ("bizfind_pro", "priority_listing",   "הופעה מועדפת בחיפוש",            True,  None),
            ("bizfind_pro", "bizcontrol_calendar","יומן BizControl",                 False, None),
            ("bizfind_pro", "bizcontrol_crm",     "CRM לקוחות",                      False, None),
            # ── starter (BizFind + BizControl Starter) ────────────────────────
            ("starter", "bizfind_listing",        "פרופיל עסקי ב-BizFind",          True,  None),
            ("starter", "online_booking",         "הזמנות תורים אונליין",            True,  None),
            ("starter", "leads_inbox",            "קבלת לידים",                      True,  None),
            ("starter", "gallery",                "גלריית תמונות",                   True,  None),
            ("starter", "reviews",                "ביקורות ודירוג",                  True,  None),
            ("starter", "analytics",              "סטטיסטיקות",                      True,  None),
            ("starter", "bizcontrol_calendar",    "יומן BizControl",                 True,  None),
            ("starter", "bizcontrol_crm",         "CRM לקוחות",                      True,  None),
            ("starter", "bizcontrol_payments",    "תשלומים וקבלות",                  True,  None),
            ("starter", "max_artists",            "מספר מקסימלי של אמנים",           True,  2),
            ("starter", "bizcontrol_automations", "אוטומציות",                       False, None),
            ("starter", "bizcontrol_pos",         "קופה",                            False, None),
            # ── pro (BizFind + BizControl Pro) ────────────────────────────────
            ("pro", "bizfind_listing",            "פרופיל עסקי ב-BizFind",          True,  None),
            ("pro", "online_booking",             "הזמנות תורים אונליין",            True,  None),
            ("pro", "leads_inbox",                "קבלת לידים",                      True,  None),
            ("pro", "gallery",                    "גלריית תמונות",                   True,  None),
            ("pro", "reviews",                    "ביקורות ודירוג",                  True,  None),
            ("pro", "analytics",                  "סטטיסטיקות",                      True,  None),
            ("pro", "priority_listing",           "הופעה מועדפת בחיפוש",            True,  None),
            ("pro", "bizcontrol_calendar",        "יומן BizControl",                 True,  None),
            ("pro", "bizcontrol_crm",             "CRM לקוחות",                      True,  None),
            ("pro", "bizcontrol_payments",        "תשלומים וקבלות",                  True,  None),
            ("pro", "bizcontrol_automations",     "אוטומציות ו-WhatsApp",            True,  None),
            ("pro", "bizcontrol_pos",             "קופה",                            True,  None),
            ("pro", "max_artists",                "מספר מקסימלי של אמנים",           True,  5),
            ("pro", "bizcontrol_ai",              "AI — ויקי",                        True,  None),
            # ── studio (BizFind + BizControl Studio) ──────────────────────────
            ("studio", "bizfind_listing",         "פרופיל עסקי ב-BizFind",          True,  None),
            ("studio", "online_booking",          "הזמנות תורים אונליין",            True,  None),
            ("studio", "leads_inbox",             "קבלת לידים",                      True,  None),
            ("studio", "gallery",                 "גלריית תמונות",                   True,  None),
            ("studio", "reviews",                 "ביקורות ודירוג",                  True,  None),
            ("studio", "analytics",               "סטטיסטיקות",                      True,  None),
            ("studio", "priority_listing",        "הופעה מועדפת בחיפוש",            True,  None),
            ("studio", "bizcontrol_calendar",     "יומן BizControl",                 True,  None),
            ("studio", "bizcontrol_crm",          "CRM לקוחות",                      True,  None),
            ("studio", "bizcontrol_payments",     "תשלומים וקבלות",                  True,  None),
            ("studio", "bizcontrol_automations",  "אוטומציות ו-WhatsApp",            True,  None),
            ("studio", "bizcontrol_pos",          "קופה",                            True,  None),
            ("studio", "bizcontrol_ai",           "AI — ויקי",                        True,  None),
            ("studio", "self_booking_page",       "דף הזמנה עצמית",                  True,  None),
            ("studio", "excel_export",            "ייצוא Excel",                      True,  None),
            ("studio", "max_artists",             "מספר מקסימלי של אמנים",           True,  None),  # unlimited
        ]
        for row in _plan_features:
            cur.execute("""
                INSERT INTO bizfind_plan_features
                    (id, plan_code, feature_key, feature_label, is_enabled, limit_value)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                ON CONFLICT (plan_code, feature_key) DO NOTHING
            """, row)

        # ── Email Center ──────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS email_system_settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                provider VARCHAR(20) NOT NULL DEFAULT 'resend',
                api_key TEXT,
                domain VARCHAR(100) DEFAULT 'biz-control.com',
                system_email VARCHAR(255) DEFAULT 'noreply@biz-control.com',
                notification_email VARCHAR(255) DEFAULT 'notifications@biz-control.com',
                support_email VARCHAR(255) DEFAULT 'support@biz-control.com',
                reply_email_default VARCHAR(255) DEFAULT 'support@biz-control.com',
                email_sending_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                marketing_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                appointment_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                invoice_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT single_row CHECK (id = 1)
            )
        """)
        cur.execute("INSERT INTO email_system_settings (id) VALUES (1) ON CONFLICT DO NOTHING")
        cur.execute("ALTER TABLE message_jobs ADD COLUMN IF NOT EXISTS subject VARCHAR(255)")
        cur.execute("ALTER TABLE message_jobs ADD COLUMN IF NOT EXISTS media_url TEXT")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS studio_email_settings (
                studio_id UUID PRIMARY KEY REFERENCES studios(id) ON DELETE CASCADE,
                reply_to_email VARCHAR(255),
                business_signature TEXT,
                email_confirmation_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
                email_reminder_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
                email_deposit_approved_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                email_reschedule_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
                email_cancel_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
                email_post_payment_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
                email_birthday_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
                email_club_invite_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
                email_receipt_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        for col, default in [
            ("email_confirmation_enabled",     "TRUE"),
            ("email_reminder_enabled",         "TRUE"),
            ("email_deposit_approved_enabled", "TRUE"),
            ("email_reschedule_enabled",       "TRUE"),
            ("email_cancel_enabled",           "TRUE"),
            ("email_post_payment_enabled",     "TRUE"),
            ("email_birthday_enabled",         "TRUE"),
            ("email_club_invite_enabled",      "TRUE"),
            ("email_receipt_enabled",          "TRUE"),
        ]:
            cur.execute(f"ALTER TABLE studio_email_settings ADD COLUMN IF NOT EXISTS {col} BOOLEAN NOT NULL DEFAULT {default}")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS email_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID REFERENCES studios(id) ON DELETE SET NULL,
                client_id UUID,
                recipient_email VARCHAR(255) NOT NULL,
                subject TEXT NOT NULL,
                template_key VARCHAR(100),
                status VARCHAR(20) NOT NULL DEFAULT 'sent',
                provider_message_id TEXT,
                error_message TEXT,
                sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_email_logs_studio ON email_logs (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_email_logs_sent_at ON email_logs (sent_at DESC)")

        # ── Cross-app secure handoff (one-time codes, replaces JWT-in-URL) ────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS auth_handoff_codes (
                code UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                token TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 minutes'),
                used_at TIMESTAMPTZ
            )
        """)

        # ── Marketplace customer email/password auth ─────────────────────────
        cur.execute("""
            ALTER TABLE marketplace_customers
            ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE,
            ADD COLUMN IF NOT EXISTS password_hash TEXT
        """)

        # ── Booking request public token (for customer-facing status link) ────
        cur.execute("""
            ALTER TABLE booking_requests
            ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT gen_random_uuid()
        """)
        cur.execute("""
            UPDATE booking_requests SET public_token = gen_random_uuid()
            WHERE public_token IS NULL
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
