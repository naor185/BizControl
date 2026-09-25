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
        cur.execute("ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS media_url TEXT")

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
        # "Unseen" tracking for the new-lead badges. On first creation of the column, leads that
        # are already past status "new" count as seen; leads still "new" stay unseen.
        cur.execute("SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'seen_at'")
        _leads_had_seen_at = cur.fetchone() is not None
        cur.execute("ALTER TABLE leads ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ")
        if not _leads_had_seen_at:
            cur.execute("UPDATE leads SET seen_at = NOW() WHERE status <> 'new'")

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
            # Email verification (default true → existing users + all non-self-signup
            # creation paths are pre-verified; only BizFind self-registration sets false).
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token TEXT",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_sent_at TIMESTAMPTZ",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_days_of_week VARCHAR(20)",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_quota INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_used INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_reset_month VARCHAR(7)",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_prompt_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_completion_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS invoice_scan_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS pretax_amount NUMERIC(10,2)",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(64)",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes TEXT",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sent_to_accountant BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sent_to_accountant_at TIMESTAMPTZ",
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER",
            "ALTER TABLE studios ADD COLUMN IF NOT EXISTS business_type VARCHAR(64) NOT NULL DEFAULT 'other'",
            "ALTER TABLE invoice_settings ADD COLUMN IF NOT EXISTS accountant_email TEXT",
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
            # BizFind & Receipt message templates
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS booking_confirm_wa_template TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS booking_request_approved_wa_template TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS booking_request_rejected_wa_template TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS waitlist_notify_wa_template TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS waitlist_joined_wa_template TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS receipt_link_wa_template TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS pos_receipt_wa_template TEXT",
            "ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS deposit_reminder_wa_template TEXT",
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
        # Deposit/aftercare used to live only on studio_settings.treatment_types
        # (a JSON blob with no relation to a real Service row) — moved onto the
        # Service itself; see the one-time migration below that folds existing
        # treatment_types entries into real Service rows.
        cur.execute("ALTER TABLE services ADD COLUMN IF NOT EXISTS requires_deposit BOOLEAN NOT NULL DEFAULT false")
        cur.execute("ALTER TABLE services ADD COLUMN IF NOT EXISTS deposit_amount_cents INTEGER NOT NULL DEFAULT 0")
        cur.execute("ALTER TABLE services ADD COLUMN IF NOT EXISTS send_aftercare BOOLEAN NOT NULL DEFAULT false")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS service_staff (
                service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (service_id, user_id)
            )
        """)
        cur.execute("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL")
        cur.execute("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
        # Drives slot duration in public_routes.py's booking_slots/create_booking
        # instead of everyone always taking the studio's flat self_booking_slot_minutes.
        cur.execute("ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL")
        # Every appointment request is also a lead. The column links the two; the backfill below
        # turns requests that are still pending into leads exactly once (lead_id IS NULL guard -
        # it self-clears, and deleting a lead later never re-creates it).
        cur.execute("ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS lead_id UUID")
        # ensure_schema() is ONE transaction: if this data backfill ever failed unguarded it would
        # roll back every migration in this run (including the lead_id column the code now needs).
        # A savepoint keeps a failure here from taking anything else down with it.
        cur.execute("SAVEPOINT bizfind_lead_backfill")
        try:
            cur.execute("""
            WITH pend AS (
                SELECT id, studio_id, client_name, client_phone, client_email, service_note, created_at,
                       gen_random_uuid() AS lid
                FROM booking_requests
                WHERE status = 'pending' AND lead_id IS NULL
            ),
            ins AS (
                INSERT INTO leads (id, studio_id, name, phone, email, source, status, service_interest, notes, created_at, updated_at)
                SELECT lid, studio_id, client_name, client_phone, client_email, 'bizfind', 'new',
                       LEFT(service_note, 255), 'בקשת תור מ-BizFind', created_at, NOW()
                FROM pend
                RETURNING id
            )
            UPDATE booking_requests br SET lead_id = pend.lid FROM pend WHERE br.id = pend.id
            """)
            cur.execute("RELEASE SAVEPOINT bizfind_lead_backfill")
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT bizfind_lead_backfill")
            print(f"[start] BizFind lead backfill skipped: {e}")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_booking_requests_service_id ON booking_requests (service_id)")

        # One-time migration: fold studio_settings.treatment_types (a JSON
        # array of {name, requires_deposit, deposit_amount_ils, send_aftercare}
        # with no id/FK, matched to appointments only by fuzzy title-substring
        # comparison) into real Service rows — one studio-owner-facing catalog
        # instead of two disconnected places to configure "what is a bookable
        # treatment." For each entry: update the existing Service with a
        # matching name (case-insensitive) if one exists, else create one
        # (duration defaults to 60 min — unknown before, since treatment_types
        # never had a duration field at all). Clears treatment_types on the
        # studio afterward so this only runs once per studio, ever — a studio
        # visited again on a later startup with treatment_types already NULL
        # is simply skipped.
        import json as _json_mig
        cur.execute("SELECT studio_id, treatment_types FROM studio_settings WHERE treatment_types IS NOT NULL")
        for _stid, _raw in cur.fetchall():
            try:
                _entries = _json_mig.loads(_raw) if isinstance(_raw, str) else _raw
            except Exception:
                _entries = []
            for _entry in (_entries or []):
                _tname = (_entry.get("name") or "").strip()
                if not _tname:
                    continue
                _req_dep = bool(_entry.get("requires_deposit"))
                _dep_cents = round(float(_entry.get("deposit_amount_ils") or 0) * 100)
                _aftercare = bool(_entry.get("send_aftercare"))
                cur.execute(
                    "SELECT id FROM services WHERE studio_id = %s AND lower(name) = lower(%s) LIMIT 1",
                    (_stid, _tname),
                )
                _match = cur.fetchone()
                if _match:
                    cur.execute(
                        "UPDATE services SET requires_deposit = %s, deposit_amount_cents = %s, send_aftercare = %s WHERE id = %s",
                        (_req_dep, _dep_cents, _aftercare, _match[0]),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO services (studio_id, name, duration_minutes, requires_deposit, deposit_amount_cents, send_aftercare, is_active)
                        VALUES (%s, %s, 60, %s, %s, %s, true)
                        """,
                        (_stid, _tname, _req_dep, _dep_cents, _aftercare),
                    )
            cur.execute("UPDATE studio_settings SET treatment_types = NULL WHERE studio_id = %s", (_stid,))
            print(f"[start] migrated {len(_entries or [])} treatment_types into services for studio {_stid}")

        # One-time repair: marketplace_routes.py's slug generator used to let
        # non-ASCII characters straight through (Python's \w in unicode mode
        # matches Hebrew letters), so an all-Hebrew business name became a
        # literal Hebrew slug (e.g. "קליניקה"). That round-trips inconsistently
        # through URL encoding across different code paths — Next.js's
        # useParams() on a client-side navigation can hand back a still-percent-
        # encoded value for a non-ASCII route segment while an API response
        # carries it as plain text, so an exact-match lookup against it silently
        # never matches — which is exactly what broke "my own business shows
        # not found" for every Hebrew-named studio. Regenerate any slug that
        # isn't plain ASCII from the studio's name, the same way a fresh
        # registration would today (see the fixed _slugify() in
        # marketplace_routes.py) — never touches an already-ASCII slug, so a
        # studio's existing public links are untouched unless they were
        # already broken by this bug.
        import re as _re
        cur.execute("SELECT id, name, slug FROM studios WHERE slug ~ '[^a-z0-9-]'")
        for _sid, _name, _old_slug in cur.fetchall():
            _base = _re.sub(r"[^a-z0-9\s-]", "", (_name or "").lower().strip())
            _base = _re.sub(r"[\s_]+", "-", _base)
            _base = _re.sub(r"-+", "-", _base).strip("-")[:48] or "business"
            _new_slug = _base
            _n = 1
            while True:
                cur.execute("SELECT 1 FROM studios WHERE slug = %s AND id != %s", (_new_slug, _sid))
                if not cur.fetchone():
                    break
                _new_slug = f"{_base}-{_n}"
                _n += 1
            cur.execute("UPDATE studios SET slug = %s WHERE id = %s", (_new_slug, _sid))
            print(f"[start] fixed non-ASCII studio slug: {_old_slug!r} -> {_new_slug!r} (studio {_sid})")

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
            CREATE TABLE IF NOT EXISTS plans (
                id VARCHAR(32) PRIMARY KEY,
                display_name VARCHAR(128) NOT NULL,
                price_cents INTEGER NOT NULL DEFAULT 0,
                currency VARCHAR(8) NOT NULL DEFAULT 'ILS',
                billing_period_days INTEGER NOT NULL DEFAULT 30,
                trial_days INTEGER NOT NULL DEFAULT 0,
                stripe_price_id VARCHAR(120),
                scope_bizcontrol BOOLEAN NOT NULL DEFAULT true,
                is_purchasable BOOLEAN NOT NULL DEFAULT true,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Plan Management Center (Plans Engine step 5) — additive columns only.
        cur.execute("""
            ALTER TABLE plans
            ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS price_monthly_cents INTEGER,
            ADD COLUMN IF NOT EXISTS price_annual_cents INTEGER,
            ADD COLUMN IF NOT EXISTS sale_price_cents INTEGER,
            ADD COLUMN IF NOT EXISTS sale_expires_at TIMESTAMPTZ
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS business_type_templates (
                business_type VARCHAR(64) PRIMARY KEY,
                display_name VARCHAR(128) NOT NULL,
                default_modules JSONB NOT NULL DEFAULT '[]',
                default_services JSONB NOT NULL DEFAULT '[]'
            )
        """)
        # The one list of business types (app/services/business_types.py): how each type is shown,
        # the older names it is recognised by, and its BizFind import tag.
        cur.execute("""
            ALTER TABLE business_type_templates
            ADD COLUMN IF NOT EXISTS icon VARCHAR(48),
            ADD COLUMN IF NOT EXISTS color VARCHAR(16),
            ADD COLUMN IF NOT EXISTS sort_order INTEGER,
            ADD COLUMN IF NOT EXISTS is_directory_only BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]',
            ADD COLUMN IF NOT EXISTS osm_tag VARCHAR(64),
            ADD COLUMN IF NOT EXISTS terms JSONB NOT NULL DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS message_defaults JSONB NOT NULL DEFAULT '{}'
        """)
        # the owner's own words for their business (app/services/business_types.studio_terms)
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS business_terms JSONB NOT NULL DEFAULT '{}'")

        # ── Subscription state engine (Plans Engine step 4) ────────────────────
        # Source of truth for "is this studio's access active right now" —
        # replaces reading Studio.is_active/plan_expires_at directly. Those
        # columns are left in place (deprecated) per the established pattern.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL UNIQUE REFERENCES studios(id) ON DELETE CASCADE,
                plan_id VARCHAR(32) NOT NULL REFERENCES plans(id),
                status VARCHAR(20) NOT NULL DEFAULT 'trial',
                current_period_start TIMESTAMPTZ,
                current_period_end TIMESTAMPTZ,
                trial_ends_at TIMESTAMPTZ,
                cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
                canceled_at TIMESTAMPTZ,
                auto_renew BOOLEAN NOT NULL DEFAULT true,
                payment_provider VARCHAR(20) NOT NULL DEFAULT 'stripe',
                provider_customer_id VARCHAR(128),
                provider_subscription_id VARCHAR(128),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS subscription_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
                event_type VARCHAR(32) NOT NULL,
                from_status VARCHAR(20),
                to_status VARCHAR(20),
                from_plan VARCHAR(32),
                to_plan VARCHAR(32),
                source VARCHAR(16) NOT NULL,
                provider_event_id VARCHAR(128),
                metadata JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_subscription_events_studio ON subscription_events (studio_id, created_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_subscription_events_provider_event ON subscription_events (provider_event_id)")
        # NOTE: the one-time data migration that fills these tables from
        # Studio's legacy columns runs later in this function, after `plans`
        # is seeded (subscriptions.plan_id is FK'd to plans.id — seeding
        # plans happens well below this point, not here).

        # ── Generic quota engine (Plans Engine step 3) ─────────────────────────
        # Additive only — period_type defaults to 'unlimited' (no quota
        # dimension at all) so every existing plan_modules row is unaffected
        # until a Super Admin explicitly sets a quota via admin/packages.
        cur.execute("""
            ALTER TABLE plan_modules
            ADD COLUMN IF NOT EXISTS limit_value INTEGER,
            ADD COLUMN IF NOT EXISTS period_type VARCHAR(16) NOT NULL DEFAULT 'unlimited',
            ADD COLUMN IF NOT EXISTS on_exceed_action VARCHAR(16) NOT NULL DEFAULT 'block',
            ADD COLUMN IF NOT EXISTS auto_increase_by INTEGER
        """)
        cur.execute("""
            ALTER TABLE studio_modules
            ADD COLUMN IF NOT EXISTS limit_value_override INTEGER,
            ADD COLUMN IF NOT EXISTS limit_value_delta INTEGER,
            ADD COLUMN IF NOT EXISTS period_type_override VARCHAR(16),
            ADD COLUMN IF NOT EXISTS on_exceed_action_override VARCHAR(16),
            ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false
        """)

        # ── Add-ons (Plans Engine step 6) ───────────────────────────────────────
        # Standalone, priced entities that grant extra modules/quota on top of
        # a studio's plan — never tied to one plan. See app/models/addon.py.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS addons (
                id VARCHAR(32) PRIMARY KEY,
                display_name VARCHAR(128) NOT NULL,
                description TEXT,
                price_cents INTEGER NOT NULL DEFAULT 0,
                currency VARCHAR(8) NOT NULL DEFAULT 'ILS',
                billing_type VARCHAR(16) NOT NULL DEFAULT 'monthly',
                applies_to_all_plans BOOLEAN NOT NULL DEFAULT false,
                is_visible BOOLEAN NOT NULL DEFAULT true,
                is_purchasable BOOLEAN NOT NULL DEFAULT true,
                is_active BOOLEAN NOT NULL DEFAULT true,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS plan_addons (
                plan_id VARCHAR(32) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                addon_id VARCHAR(32) NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
                PRIMARY KEY (plan_id, addon_id)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS addon_modules (
                addon_id VARCHAR(32) NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
                module_id VARCHAR(64) NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
                limit_delta INTEGER,
                PRIMARY KEY (addon_id, module_id)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS studio_addons (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                addon_id VARCHAR(32) NOT NULL REFERENCES addons(id),
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                source VARCHAR(20) NOT NULL DEFAULT 'admin_assigned',
                purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                current_period_end TIMESTAMPTZ,
                canceled_at TIMESTAMPTZ,
                price_cents_at_purchase INTEGER NOT NULL DEFAULT 0
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_studio_addons_studio ON studio_addons (studio_id, status)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_studio_addons_addon ON studio_addons (addon_id, status)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS studio_usage_counters (
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                quota_key VARCHAR(64) NOT NULL,
                period_key VARCHAR(16) NOT NULL,
                used_count INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (studio_id, quota_key, period_key)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_usage_counters_studio_key ON studio_usage_counters (studio_id, quota_key)")

        # parent_module_id: NULL = standalone module; set = a fine-grained
        # "permission" nested under a parent module. Additive only — existing
        # rows keep parent_module_id NULL (still standalone modules), so this
        # is zero behavior change until sub-capability rows are seeded below.
        cur.execute("""
            ALTER TABLE modules
            ADD COLUMN IF NOT EXISTS parent_module_id VARCHAR(64)
                REFERENCES modules(id) ON DELETE CASCADE
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
            # Nav-level modules (control sidebar visibility)
            ("pos",          "core",    "קופה",           18),
            ("products",     "core",    "מוצרים",          19),
            ("expenses",     "core",    "הוצאות",          20),
            ("obligations",  "core",    "התחייבויות",      21),
            ("services",     "core",    "שירותים",         22),
            ("broadcasts",   "core",    "תפוצות",          23),
            # Was previously gated only via the legacy studio_features table
            # (require_feature("voice"), router-level) with no module/plan
            # concept at all — now a real top-level module like any other.
            ("voice",        "communication", "BizControl Voice (שיחות)", 24),
        ]
        for mid, cat, name, sort in MODULES:
            cur.execute("""
                INSERT INTO modules (id, name, category, sort_order)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category
            """, (mid, name, cat, sort))

        # ── One-time cleanup: the Automation Builder feature (rule engine,
        # routes, UI) was removed entirely — confirmed zero automation_rules
        # rows ever existed in production, so this was never real usage.
        # Deletes the now-orphaned module catalog row; ON DELETE CASCADE on
        # plan_modules.module_id / studio_modules.module_id (see
        # app/models/module.py) cleans up its plan-entitlement rows in the
        # same statement — confirmed via direct query that no studio had an
        # explicit override and no business_type_template referenced it, so
        # nothing else depends on this row. Safe to re-run: matches 0 rows
        # once already deleted.
        cur.execute("DELETE FROM modules WHERE id = 'automation_builder'")
        # Unified inbox + marketing analytics removed: their module rows (and, via ON DELETE CASCADE,
        # their plan/studio grants).
        cur.execute("DELETE FROM modules WHERE id IN ('meta_inbox', 'realtime_inbox', 'quick_replies', 'marketing_analytics', 'ai_insights')")

        # ── Seed fine-grained "permissions" (sub-capabilities nested under a
        # parent module) — the one-time migration target for the legacy
        # studio_features table. Always shares its parent's category so the
        # admin tree UI renders each child under the right group.
        # (id, parent_id, category, name, sort_order)
        SUB_MODULES = [
            ("whatsapp_cloud",       "whatsapp",  "communication", "WhatsApp Cloud API (Meta)",        1),
            ("lead_attribution",     "analytics", "advanced",      "מעקב לידים (Attribution)",         2),
            ("ai_auto_tag",          "ai_assistant", "ai",         "תיוג AI אוטומטי ללידים",           0),
            # Was previously an ungated endpoint (only a role check, no
            # module/feature gate at all) with a hardcoded ">= 3/month" cap —
            # now a real module so the cap can be configured via
            # admin/packages instead of a number buried in automation_routes.py.
            ("ai_theme_generate",    "ai_assistant", "ai",         "יצירת ערכת נושא ב-AI",             1),
            # Was previously its own free-floating studio_features flag with
            # its own quota columns on Studio, fully independent of the "ocr"
            # module even though it's the exact same functional area — folding
            # it in here closes that overlap.
            ("invoice_ai_scan",      "ocr",       "ai",            "סריקת חשבוניות AI",                1),
        ]
        for mid, parent_id, cat, name, sort in SUB_MODULES:
            cur.execute("""
                INSERT INTO modules (id, name, category, sort_order, parent_module_id)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
                    parent_module_id=EXCLUDED.parent_module_id
            """, (mid, name, cat, sort, parent_id))

        # One-time data migration: every studio_features row that was enabled
        # gets an equivalent studio_modules override, so no studio loses an
        # entitlement it already had. Idempotent (ON CONFLICT DO NOTHING) —
        # safe to run on every startup. studio_features itself is left intact
        # and still read by the legacy require_feature() path until every
        # call site has moved to require_module() and a deploy cycle has
        # verified it (same deprecate-before-delete pattern as Phase 1).
        cur.execute("""
            INSERT INTO studio_modules (id, studio_id, module_id, is_enabled)
            SELECT gen_random_uuid(), sf.studio_id, sf.feature, true
            FROM studio_features sf
            WHERE sf.is_enabled = true
              AND EXISTS (SELECT 1 FROM modules m WHERE m.id = sf.feature)
              AND NOT EXISTS (
                  SELECT 1 FROM studio_modules sm
                  WHERE sm.studio_id = sf.studio_id AND sm.module_id = sf.feature
              )
        """)

        # invoice_ai_scan is now nested under "ocr" (parent_module_id), and
        # require_module() requires every ancestor to also resolve enabled.
        # Under the old studio_features system, invoice_ai_scan was fully
        # independent of "ocr" — a studio on a plan without "ocr" could still
        # have it manually enabled (that was the whole point of
        # enable_invoice_scan() in superadmin_routes.py: grant it regardless
        # of plan). Force an explicit "ocr" override on for exactly those
        # studios so none of them lose invoice-scan access as a side effect
        # of the new parent-chain rule.
        cur.execute("""
            INSERT INTO studio_modules (id, studio_id, module_id, is_enabled)
            SELECT gen_random_uuid(), sf.studio_id, 'ocr', true
            FROM studio_features sf
            WHERE sf.feature = 'invoice_ai_scan' AND sf.is_enabled = true
            ON CONFLICT (studio_id, module_id) DO UPDATE SET is_enabled = true
        """)

        # ── Seed plan → module defaults (idempotent) ──────────────────────────
        _NAV_MODULES = ["pos", "products", "expenses", "services", "broadcasts"]
        PLAN_MODULES = {
            # "trial" (14-day free trial at signup) is meant to get full access —
            # was previously missing from this dict, which resolved every
            # gateable module to disabled for brand-new studios.
            "trial":      ["crm", "calendar", "payments", "whatsapp", "email", "sms",
                           "customer_club", "wallet", "ocr", "ai_assistant",
                           "online_booking", "marketplace", "wait_list", "gift_cards",
                           "analytics", "multi_location", "employee_mgmt"] + _NAV_MODULES,
            "free":       ["crm", "calendar"] + _NAV_MODULES,
            # bizfind_basic/bizfind_pro are retired (BizFind no longer sells a
            # BizControl-less plan) — kept here only as a safety net so any
            # studio still on one of these plans in production isn't locked
            # out of every module.
            "bizfind_basic": ["crm", "calendar", "payments", "whatsapp", "email"] + _NAV_MODULES,
            "bizfind_pro":   ["crm", "calendar", "payments", "whatsapp", "email"] + _NAV_MODULES,
            "starter":    ["crm", "calendar", "payments", "whatsapp", "email"] + _NAV_MODULES,
            "pro":        ["crm", "calendar", "payments", "whatsapp", "email",
                           "customer_club", "ocr", "ai_assistant", "employee_mgmt"] + _NAV_MODULES,
            # "studio" is a real, actively-sold top-tier plan (₪499/month via
            # billing_routes.py's Stripe checkout) — was missing here entirely,
            # same bug class as the trial/bizfind_basic/bizfind_pro gaps fixed
            # earlier: real paying customers on this plan got zero modules.
            "studio":     ["crm", "calendar", "payments", "whatsapp", "email", "sms",
                           "customer_club", "wallet", "ocr", "ai_assistant",
                           "online_booking", "marketplace", "wait_list", "gift_cards",
                           "analytics", "multi_location", "employee_mgmt"] + _NAV_MODULES,
            "enterprise": ["crm", "calendar", "payments", "whatsapp", "email", "sms",
                           "customer_club", "wallet", "ocr", "ai_assistant",
                           "online_booking", "marketplace", "wait_list", "gift_cards",
                           "analytics", "multi_location", "employee_mgmt"] + _NAV_MODULES,
            "platform":   ["crm", "calendar", "payments", "whatsapp", "email", "sms",
                           "customer_club", "wallet", "ocr", "ai_assistant",
                           "online_booking", "marketplace", "wait_list", "gift_cards",
                           "analytics", "multi_location", "employee_mgmt"] + _NAV_MODULES,
        }
        # ai_theme_generate had no plan gate at all before (any owner/admin/
        # manager could call it) — added to every plan so the new module row
        # doesn't restrict access anyone already had; only the quota (set
        # below) is new, migrated from the old hardcoded ">= 3" check.
        for plan in PLAN_MODULES:
            PLAN_MODULES[plan] = PLAN_MODULES[plan] + ["ai_theme_generate"]
        for plan, mods in PLAN_MODULES.items():
            for mod in mods:
                cur.execute("""
                    INSERT INTO plan_modules (plan, module_id) VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                """, (plan, mod))

        # "obligations" (התחייבויות) used to be a default core module on
        # every plan via _NAV_MODULES — now opt-in only, granted per studio
        # by the superadmin via a studio_modules override, not by plan.
        # Removing it from _NAV_MODULES above only stops it being RE-seeded;
        # the plan_modules rows already inserted on earlier startups need an
        # explicit delete to actually revoke the default (ON CONFLICT DO
        # NOTHING above never removes anything). Every studio currently
        # getting it only via a plan default loses it; the one below
        # (Nctattoo, the studio owner's own) gets it back via its own
        # explicit override so nothing regresses there.
        cur.execute("DELETE FROM plan_modules WHERE module_id = 'obligations'")
        cur.execute("""
            INSERT INTO studio_modules (id, studio_id, module_id, is_enabled)
            VALUES (gen_random_uuid(), 'f390d761-c9ca-425d-88c3-647b4ccee2d2', 'obligations', true)
            ON CONFLICT (studio_id, module_id) DO UPDATE SET is_enabled = true
        """)

        # Quota config for ai_theme_generate — same 3/month cap for every
        # plan, matching the old global hardcoded check in automation_routes.py.
        cur.execute("""
            UPDATE plan_modules
            SET limit_value = 3, period_type = 'monthly', on_exceed_action = 'block'
            WHERE module_id = 'ai_theme_generate'
        """)

        # Carry over each studio's current-cycle AI-generation usage so
        # nobody's count silently resets to 0 (which would hand out extra
        # generations for the rest of their current month) or loses a
        # near-limit warning.
        cur.execute("""
            INSERT INTO studio_usage_counters (studio_id, quota_key, period_key, used_count)
            SELECT ss.studio_id, 'ai_theme_generate', to_char(ss.ai_generations_reset_date, 'YYYY-MM'), ss.ai_generations_count
            FROM studio_settings ss
            WHERE ss.ai_generations_count > 0 AND ss.ai_generations_reset_date IS NOT NULL
            ON CONFLICT (studio_id, quota_key, period_key) DO UPDATE SET used_count = EXCLUDED.used_count
        """)

        # Carry over invoice-scan quota/usage onto the invoice_ai_scan module
        # (only for studios where it's already an active override — created
        # either by step 2's studio_features migration or enable_invoice_scan()
        # — never invented for a studio that isn't actually enabled).
        cur.execute("""
            UPDATE studio_modules sm
            SET limit_value_override = s.invoice_scan_quota,
                period_type_override = 'monthly',
                on_exceed_action_override = 'block'
            FROM studios s
            WHERE sm.studio_id = s.id
              AND sm.module_id = 'invoice_ai_scan'
              AND sm.is_enabled = true
              AND s.invoice_scan_quota > 0
        """)
        cur.execute("""
            INSERT INTO studio_usage_counters (studio_id, quota_key, period_key, used_count)
            SELECT s.id, 'invoice_ai_scan', s.invoice_scan_reset_month, s.invoice_scan_used
            FROM studios s
            JOIN studio_modules sm ON sm.studio_id = s.id AND sm.module_id = 'invoice_ai_scan' AND sm.is_enabled = true
            WHERE s.invoice_scan_quota > 0 AND s.invoice_scan_used > 0 AND s.invoice_scan_reset_month IS NOT NULL
            ON CONFLICT (studio_id, quota_key, period_key) DO UPDATE SET used_count = EXCLUDED.used_count
        """)

        # ── Seed plans registry (idempotent) ───────────────────────────────────
        # One-time migration of plan identity out of scattered dicts (BIZFIND_PLANS
        # in marketplace_routes.py, PRICE_IDS/PLAN_NAMES/PLAN_DAYS in
        # billing_routes.py) into a real, admin-editable table. Nothing reads from
        # this table yet except admin/packages' plan list — zero behavior change
        # for existing studios. stripe_price_id is left NULL; it's pasted in by
        # Super Admin after creating the Price in Stripe (no way to avoid that
        # manual Stripe-side step). id/columns match app/models/module.py's Plan.
        # (plan_id, display_name, price_cents, billing_period_days, trial_days, scope_bizcontrol, is_purchasable, sort_order)
        PLANS_SEED = [
            ("trial",         "ניסיון חינמי",              0,     30, 30, True,  False, 0),
            ("free",          "Free",                       0,     30, 0,  True,  False, 1),
            ("bizfind_basic", "Basic — BizFind בלבד",       9900,  30, 0,  False, False, 2),
            ("bizfind_pro",   "Pro — BizFind בלבד",         17900, 30, 0,  False, False, 3),
            ("starter",       "Starter — BizFind + BizControl", 19900, 30, 0, True, True, 4),
            ("pro",           "Pro — BizFind + BizControl", 34900, 30, 0,  True,  True,  5),
            ("studio",        "Studio — BizFind + BizControl", 49900, 30, 0, True, True, 6),
            ("enterprise",    "Enterprise",                 0,     30, 0,  True,  False, 7),
            ("platform",      "Platform",                   0,     30, 0,  True,  False, 8),
        ]
        for pid, display_name, price_cents, period_days, trial_days, scope_bc, purchasable, sort in PLANS_SEED:
            cur.execute("""
                INSERT INTO plans (id, display_name, price_cents, billing_period_days, trial_days,
                                    scope_bizcontrol, is_purchasable, sort_order)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, (pid, display_name, price_cents, period_days, trial_days, scope_bc, purchasable, sort))

        # The seed above is ON CONFLICT DO NOTHING (never overwrites an admin's
        # own edits in the Plan Management Center) — so on any environment
        # where the 'trial' row was already created before this change, the
        # seed alone can't move it from 14 to 30. This one-time correction
        # targets only the still-default 14 value, so it won't clobber an
        # admin who already customized trial_days themselves.
        cur.execute("UPDATE plans SET trial_days = 30 WHERE id = 'trial' AND trial_days = 14")

        # plan_modules.plan becomes a real FK now that plans is seeded with every
        # key PLAN_MODULES ever used. Checked first (rather than a blind ALTER)
        # because ensure_schema() commits once at the very end — a failed ALTER
        # here would abort the whole migration batch for this deploy, not just
        # this one statement. Skips cleanly (keeps plan as a plain column) if any
        # orphan value shows up that wasn't anticipated, instead of risking that.
        cur.execute("""
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_plan_modules_plan'
        """)
        if not cur.fetchone():
            cur.execute("""
                SELECT DISTINCT plan FROM plan_modules
                WHERE plan NOT IN (SELECT id FROM plans)
            """)
            orphans = [r[0] for r in cur.fetchall()]
            if orphans:
                print(f"[start] Skipping plan_modules.plan FK — orphan plan keys not in plans table: {orphans}")
            else:
                cur.execute("""
                    ALTER TABLE plan_modules
                        ADD CONSTRAINT fk_plan_modules_plan
                        FOREIGN KEY (plan) REFERENCES plans(id) ON DELETE CASCADE
                """)

        # Backfill plans.stripe_price_id from the Stripe Price ID env vars
        # billing_routes.py used directly before step 4 (STRIPE_PRICE_STARTER
        # etc.) — completes what step 1 anticipated ("pasted in by Super Admin
        # after creating the Price in Stripe") without requiring a manual
        # re-entry of IDs that already exist in Railway env vars. Only fills
        # in NULL — never overwrites a value Super Admin may have set since.
        PRICE_ID_ENV = {
            "starter": os.environ.get("STRIPE_PRICE_STARTER", ""),
            "pro":     os.environ.get("STRIPE_PRICE_PRO", ""),
            "studio":  os.environ.get("STRIPE_PRICE_STUDIO", ""),
        }
        for pid, price_id in PRICE_ID_ENV.items():
            if price_id:
                cur.execute(
                    "UPDATE plans SET stripe_price_id = %s WHERE id = %s AND stripe_price_id IS NULL",
                    (price_id, pid),
                )

        # One-time data migration: every studio without a subscriptions row
        # yet gets one derived from its current Studio columns — a studio
        # that's is_active with a future (or no) expiry becomes 'active'
        # (or 'trial' if its plan is literally "trial"); anything inactive
        # or past its expiry becomes 'expired'. Idempotent — only fills in
        # studios that don't have a row yet, never overwrites one that does
        # (so once billing_routes.py starts writing here, this stays a
        # no-op). Runs here (not right after CREATE TABLE above) because
        # subscriptions.plan_id is FK'd to plans.id, and plans is only
        # seeded by this point in the function.
        cur.execute("""
            INSERT INTO subscriptions (studio_id, plan_id, status, current_period_start, current_period_end,
                                        trial_ends_at, provider_customer_id, provider_subscription_id)
            SELECT s.id,
                   CASE WHEN EXISTS (SELECT 1 FROM plans p WHERE p.id = s.subscription_plan)
                        THEN s.subscription_plan ELSE 'free' END,
                   CASE
                       WHEN NOT s.is_active OR (s.plan_expires_at IS NOT NULL AND s.plan_expires_at < NOW()) THEN 'expired'
                       WHEN s.subscription_plan = 'trial' THEN 'trial'
                       ELSE 'active'
                   END,
                   CASE WHEN s.is_active THEN COALESCE(s.plan_expires_at, NOW()) - INTERVAL '30 days' END,
                   s.plan_expires_at,
                   CASE WHEN s.subscription_plan = 'trial' THEN s.plan_expires_at END,
                   s.stripe_customer_id,
                   s.stripe_subscription_id
            FROM studios s
            WHERE NOT EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.studio_id = s.id)
              AND s.is_platform = false
            ON CONFLICT (studio_id) DO NOTHING
        """)

        # ── Business types (app/data/business_types.py) ───────────────────────
        # The table is the source of truth and the superadmin edits it, so this adds a missing type and
        # fills a still-empty field — it never overwrites a value someone changed. (Before 2026-09-24 it
        # rewrote name, modules and services on every start.) A label still equal to its old default is
        # upgraded once.
        import json as _json
        from app.data.business_types import BUSINESS_TYPES, PREVIOUS_LABELS
        for _t in BUSINESS_TYPES:
            cur.execute("""
                INSERT INTO business_type_templates (business_type, display_name, default_modules, default_services,
                                                     icon, color, sort_order, is_directory_only, aliases, osm_tag, terms,
                                                     message_defaults)
                VALUES (%(key)s, %(label)s, %(modules)s, %(services)s,
                        %(icon)s, %(color)s, %(sort)s, %(directory_only)s, %(aliases)s, %(osm_tag)s, %(terms)s,
                        %(messages)s)
                ON CONFLICT (business_type) DO UPDATE SET
                    display_name = CASE WHEN business_type_templates.display_name = %(previous_label)s
                                        THEN EXCLUDED.display_name ELSE business_type_templates.display_name END,
                    icon = COALESCE(business_type_templates.icon, EXCLUDED.icon),
                    color = COALESCE(business_type_templates.color, EXCLUDED.color),
                    sort_order = COALESCE(business_type_templates.sort_order, EXCLUDED.sort_order),
                    aliases = CASE WHEN business_type_templates.aliases = '[]'::jsonb
                                   THEN EXCLUDED.aliases ELSE business_type_templates.aliases END,
                    osm_tag = COALESCE(business_type_templates.osm_tag, EXCLUDED.osm_tag),
                    terms = CASE WHEN business_type_templates.terms = '{}'::jsonb
                                 THEN EXCLUDED.terms ELSE business_type_templates.terms END,
                    message_defaults = CASE WHEN business_type_templates.message_defaults = '{}'::jsonb
                                            THEN EXCLUDED.message_defaults ELSE business_type_templates.message_defaults END
            """, {
                "key": _t["key"], "label": _t["label"], "icon": _t["icon"], "color": _t["color"],
                "sort": _t["sort"], "directory_only": bool(_t.get("directory_only")), "osm_tag": _t.get("osm_tag"),
                "modules": _json.dumps(_t["modules"], ensure_ascii=False),
                "services": _json.dumps(_t["services"], ensure_ascii=False),
                "aliases": _json.dumps(_t["aliases"], ensure_ascii=False),
                "terms": _json.dumps(_t.get("terms", {}), ensure_ascii=False),
                "messages": _json.dumps(_t.get("messages", {}), ensure_ascii=False),
                "previous_label": PREVIOUS_LABELS.get(_t["key"], _t["label"]),
            })

        # Texts the old settings screen saved as if the owner wrote them: the tattoo aftercare instructions
        # (saved even at a clinic) go, so the field's default applies; the deposit-approved template names
        # the staff in the business's own word ({staff_title}) instead of "✂️ אמן/ית". Only texts still
        # exactly equal to what the screen saved are touched — an owner's own text is left alone.
        from app.data.business_types import LEGACY_SAVED_ONLY_IF_UNCHANGED as _LEGACY
        cur.execute("UPDATE studio_settings SET aftercare_message = NULL WHERE aftercare_message = %s",
                    (_LEGACY["aftercare_message"],))
        _old_dep = _LEGACY["deposit_approved_wa_template"]
        _new_dep = "\n".join("👥 {staff_title}: {artist_name}" if "{artist_name}" in _line else _line
                             for _line in _old_dep.split("\n"))
        cur.execute("UPDATE studio_settings SET deposit_approved_wa_template = %s WHERE deposit_approved_wa_template = %s",
                    (_new_dep, _old_dep))

        # Businesses whose type is not a known type (free text from an older signup form) get the type
        # their text names, or "other" — a studio then keeps the text it wrote in business_type_note.
        cur.execute("ALTER TABLE studios ADD COLUMN IF NOT EXISTS business_type_note VARCHAR(120)")
        from app.services.business_types import OTHER, match_business_type
        cur.execute("SELECT business_type, display_name, aliases FROM business_type_templates")
        _types = cur.fetchall()
        for _table, _col in (("studios", "business_type"), ("businesses", "category")):
            cur.execute("SELECT to_regclass(%s)", (_table,))
            if cur.fetchone()[0] is None:      # businesses is created further down on a fresh database
                continue
            cur.execute(f"""SELECT DISTINCT {_col} FROM {_table}
                            WHERE {_col} IS NULL OR {_col} NOT IN (SELECT business_type FROM business_type_templates)""")
            for (_val,) in cur.fetchall():
                _matched = match_business_type(_val, _types)
                _key = _matched or OTHER
                if _val is None:
                    cur.execute(f"UPDATE {_table} SET {_col} = %s WHERE {_col} IS NULL", (_key,))
                    continue
                if _table == "studios" and _matched is None and _val.strip():   # the owner's own words
                    cur.execute("""UPDATE studios SET business_type_note = LEFT(%s, 120)
                                   WHERE business_type = %s AND business_type_note IS NULL""", (_val.strip(), _val))
                cur.execute(f"UPDATE {_table} SET {_col} = %s WHERE {_col} = %s", (_key, _val))
                print(f"[start] {_table}.{_col}: {_val!r} -> {_key}")

        # Zero out loyalty points for non-club-member clients (one-time cleanup)
        cur.execute("""
            UPDATE clients SET loyalty_points = 0
            WHERE is_club_member = false AND loyalty_points > 0
        """)

        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS calendar_start_hour VARCHAR(16) NOT NULL DEFAULT '08:00'")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS calendar_end_hour VARCHAR(16) NOT NULL DEFAULT '23:00'")
        cur.execute("UPDATE studio_settings SET calendar_start_hour = '08:00' WHERE calendar_start_hour IS NULL OR calendar_start_hour = '' OR calendar_start_hour = '00:00'")
        cur.execute("UPDATE studio_settings SET calendar_end_hour = '23:00' WHERE calendar_end_hour IS NULL OR calendar_end_hour = '' OR calendar_end_hour = '00:00'")

        # ── Obligations: actual paid amount tracking ──────────────────────────
        cur.execute("ALTER TABLE financial_obligations ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER NOT NULL DEFAULT 0")
        # Backfill existing rows: actual paid = months_paid × monthly_payment_cents (capped at total)
        cur.execute("""
            UPDATE financial_obligations
            SET amount_paid_cents = LEAST(months_paid * monthly_payment_cents, total_amount_cents)
            WHERE amount_paid_cents = 0 AND months_paid > 0
        """)

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
        cur.execute("ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64)")
        # Prevents a stalled/lost checkout response + resubmit from creating a true duplicate sale
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_transactions_idempotency
            ON pos_transactions (studio_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
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
            CREATE TABLE IF NOT EXISTS password_reset_otps (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                email VARCHAR(255),
                phone VARCHAR(32),
                code VARCHAR(6) NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # The WhatsApp recovery flow was redesigned to key off phone (typed
        # directly by the owner) instead of email — email was never NULL
        # before, existing rows still have it; drop the constraint so new
        # phone-keyed rows don't need one.
        cur.execute("ALTER TABLE password_reset_otps ALTER COLUMN email DROP NOT NULL")
        cur.execute("ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS phone VARCHAR(32)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_password_reset_otps_email ON password_reset_otps (email, expires_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_password_reset_otps_phone ON password_reset_otps (phone, expires_at)")

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

        # ── BizFind auto-imported businesses (unclaimed listings + Claim flow) ──
        # Deliberately separate from `studios` — an unclaimed business is not a
        # tenant, has no User/login, and its fields come from an external
        # source until an owner claims it. Once claimed, claimed_studio_id
        # points at the real Studio created via the normal registration path;
        # the businesses row itself is kept (not deleted) as the claim record.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS businesses (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(200) NOT NULL,
                slug VARCHAR(220) NOT NULL UNIQUE,
                category VARCHAR(60) NOT NULL,
                city VARCHAR(120),
                address VARCHAR(255),
                phone VARCHAR(20),
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                description TEXT,
                opening_hours JSONB,
                claim_status VARCHAR(12) NOT NULL DEFAULT 'unclaimed'
                    CHECK (claim_status IN ('unclaimed','pending','claimed')),
                claimed_studio_id UUID REFERENCES studios(id) ON DELETE SET NULL,
                claimed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_businesses_city_category ON businesses (city, category)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_businesses_claim_status ON businesses (claim_status)")

        # One row per external source a business was found in/synced from —
        # never conflate this with the business's own live fields (same
        # mistake as the old marketplace_profiles shadow-table bug).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS business_sources (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                source VARCHAR(30) NOT NULL,
                external_id VARCHAR(120) NOT NULL,
                source_url VARCHAR(500),
                last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (source, external_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_business_sources_business ON business_sources (business_id)")

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

        # ── BizControl Voice — call log (Phase 1: manual entry, no live telephony yet) ──
        cur.execute("""
            CREATE TABLE IF NOT EXISTS calls (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
                from_number VARCHAR(32) NOT NULL,
                to_number VARCHAR(32) NOT NULL,
                client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                started_at TIMESTAMPTZ NOT NULL,
                ended_at TIMESTAMPTZ,
                duration_seconds INTEGER,
                status VARCHAR(12) NOT NULL DEFAULT 'answered' CHECK (status IN ('answered','missed','voicemail')),
                recording_url TEXT,
                transcript TEXT,
                ai_summary JSONB,
                quoted_price_cents INTEGER,
                notes TEXT,
                external_call_id VARCHAR(120),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_calls_studio ON calls (studio_id, started_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_calls_client ON calls (client_id)")
        cur.execute("ALTER TABLE calls ADD COLUMN IF NOT EXISTS external_call_id VARCHAR(120)")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_calls_studio_external_id ON calls (studio_id, external_call_id) WHERE external_call_id IS NOT NULL")

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

        # ── Public gift-card shop: buyer info + pending-payment approval flow ──
        cur.execute("ALTER TABLE gift_cards ALTER COLUMN status TYPE VARCHAR(20)")
        cur.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS buyer_name VARCHAR(120)")
        cur.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS buyer_email VARCHAR(255)")
        cur.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS buyer_phone VARCHAR(32)")
        cur.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS deliver_to VARCHAR(12) DEFAULT 'buyer'")
        cur.execute("ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS bonus_cents INTEGER NOT NULL DEFAULT 0")

        # ── Gift card purchase bonus (studio-configurable threshold + %) ───────
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS gift_card_bonus_enabled BOOLEAN NOT NULL DEFAULT false")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS gift_card_bonus_threshold_cents INTEGER NOT NULL DEFAULT 50000")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS gift_card_bonus_percent INTEGER NOT NULL DEFAULT 10")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS gift_card_min_amount_cents INTEGER NOT NULL DEFAULT 100")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS gift_card_max_amount_cents INTEGER NOT NULL DEFAULT 0")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS gift_voucher_theme VARCHAR(30) NOT NULL DEFAULT 'black_gold'")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS gift_card_validity_months INTEGER NOT NULL DEFAULT 12")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS optout_page_message TEXT")

        # ── Points-redemption celebration card — sent when a client redeems a lot ──
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS points_celebration_enabled BOOLEAN NOT NULL DEFAULT true")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS points_celebration_threshold_cents INTEGER NOT NULL DEFAULT 30000")

        # ── Setup-progress checklist — a studio can dismiss a "recommended"
        # item it deliberately doesn't want (e.g. self-booking), so it stops
        # counting against their percent instead of nagging forever. JSON
        # array of item ids, same lightweight-list pattern as other small
        # per-studio lists in this table.
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS dismissed_setup_items TEXT")

        # ── Global platform design system — superadmin-controlled palette
        # applied everywhere in BizControl + BizFind, replacing each
        # studio's own theme_primary_color/theme_secondary_color (those
        # columns are untouched here — just no longer read for color; see
        # app/api/public_routes.py's GET /public/platform-theme). Only
        # meaningful on the one studio row with is_platform = true.
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS theme_background_color VARCHAR(32) NOT NULL DEFAULT '#f8fafc'")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS theme_surface_color VARCHAR(32) NOT NULL DEFAULT '#ffffff'")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS theme_text_color VARCHAR(32) NOT NULL DEFAULT '#0f172a'")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS theme_text_muted_color VARCHAR(32) NOT NULL DEFAULT '#64748b'")
        cur.execute("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS theme_accent_color VARCHAR(32) NOT NULL DEFAULT '#f59e0b'")

        # One-time seed: the platform row's theme_primary_color/
        # theme_secondary_color predate this feature and still sit at the
        # generic black/white default from when they were per-studio-only
        # fields — give the platform row a real starting palette so launch
        # day isn't black-on-white. Guarded on "still at the untouched
        # default" so this never overwrites a superadmin's real edit on a
        # later restart — runs at most once, ever, per environment.
        cur.execute("""
            UPDATE studio_settings SET
                theme_primary_color = '#7c3aed',
                theme_secondary_color = '#4c1d95'
            WHERE studio_id = (SELECT id FROM studios WHERE is_platform = true LIMIT 1)
              AND theme_primary_color = '#000000'
              AND theme_secondary_color = '#ffffff'
        """)

        # ── Short opt-out links — a short code instead of a long JWT in the URL ──
        cur.execute("""
            CREATE TABLE IF NOT EXISTS client_optout_links (
                code VARCHAR(12) PRIMARY KEY,
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (studio_id, client_id)
            )
        """)

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

        # ── Gift card purchase-page view tracking ──────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gift_card_page_views (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                view_date DATE NOT NULL DEFAULT CURRENT_DATE,
                count INTEGER NOT NULL DEFAULT 1,
                UNIQUE (studio_id, view_date)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_gcpv_studio_date ON gift_card_page_views (studio_id, view_date)")

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

        # Push notifications: message_jobs relaxed to allow a User recipient (not just a Client)
        cur.execute("ALTER TABLE message_jobs ALTER COLUMN client_id DROP NOT NULL")
        cur.execute("ALTER TABLE message_jobs ALTER COLUMN to_phone DROP NOT NULL")
        cur.execute("ALTER TABLE message_jobs ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES users(id) ON DELETE CASCADE")
        cur.execute("ALTER TABLE message_jobs ADD COLUMN IF NOT EXISTS deep_link TEXT")

        # ck_message_jobs_channel still only allowed ('whatsapp', 'email') — 'push' rows were violating it
        cur.execute("ALTER TABLE message_jobs DROP CONSTRAINT IF EXISTS ck_message_jobs_channel")
        cur.execute("ALTER TABLE message_jobs ADD CONSTRAINT ck_message_jobs_channel CHECK (channel IN ('whatsapp', 'email', 'push'))")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS device_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                token TEXT NOT NULL UNIQUE,
                platform VARCHAR(16) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_device_tokens_user_id ON device_tokens (user_id)")

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

        # ── Integration billing-failure alerts (cooldown tracking) ───────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS integration_alerts (
                integration_name VARCHAR(100) PRIMARY KEY,
                last_alerted_at TIMESTAMPTZ NOT NULL,
                last_error TEXT
            )
        """)

        # ── Repeated failed-login tracking (alert studio owner on possible brute force) ──
        cur.execute("""
            CREATE TABLE IF NOT EXISTS login_failure_tracking (
                studio_id UUID NOT NULL,
                email VARCHAR(255) NOT NULL,
                failure_count INTEGER NOT NULL DEFAULT 0,
                first_failure_at TIMESTAMPTZ,
                last_failure_at TIMESTAMPTZ,
                last_alerted_at TIMESTAMPTZ,
                PRIMARY KEY (studio_id, email)
            )
        """)
        cur.execute("ALTER TABLE login_failure_tracking ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ")

        # ── Cross-app secure handoff (one-time codes, replaces JWT-in-URL) ────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS auth_handoff_codes (
                code UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                token TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 minutes'),
                used_at TIMESTAMPTZ
            )
        """)
        # A handoff-issued session used to carry only an access token, so it
        # could never outlive that token's own expiry — unlike every other
        # login path, which gets a real refresh token. Persisted alongside
        # the access token in the same one-time code.
        cur.execute("ALTER TABLE auth_handoff_codes ADD COLUMN IF NOT EXISTS refresh_token TEXT")

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

        # One-time cleanup: strip [birthday-YYYY-MM] tag that was incorrectly
        # prepended to WhatsApp birthday message bodies before the reminder_type fix.
        cur.execute("""
            UPDATE message_jobs
            SET body = regexp_replace(body, '^\[birthday-\d{4}-\d{2}\]\n?', '', 'g')
            WHERE status IN ('pending', 'failed')
              AND body ~ '^\[birthday-\d{4}-\d{2}\]'
        """)

        cur.execute("""
            ALTER TABLE studio_settings
            ADD COLUMN IF NOT EXISTS block_shabbat_messages BOOLEAN NOT NULL DEFAULT FALSE
        """)

        # Treatment photos: owner uploads photos to a client's file after a
        # treatment; shown to the client in their BizFind personal area.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS client_treatment_photos (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
                uploaded_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
                photo_url TEXT NOT NULL,
                caption VARCHAR(255),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_client_treatment_photos_client ON client_treatment_photos (client_id, created_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_client_treatment_photos_studio ON client_treatment_photos (studio_id)")

        # Push notifications for BizFind's own customers (marketplace_customers) —
        # separate device-token table from device_tokens (that one is for
        # BizControl studio users). A customer's device isn't tied to one studio.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS customer_device_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                customer_id UUID NOT NULL REFERENCES marketplace_customers(id) ON DELETE CASCADE,
                token TEXT NOT NULL UNIQUE,
                platform VARCHAR(16) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_customer_device_tokens_customer_id ON customer_device_tokens (customer_id)")

        cur.execute("ALTER TABLE message_jobs ADD COLUMN IF NOT EXISTS recipient_customer_id UUID REFERENCES marketplace_customers(id) ON DELETE CASCADE")

        # Refresh-token rotation grace window (see /api/auth/refresh) — lets a
        # client that never received/saved a rotated pair (mobile app
        # suspended mid-request) recover instead of being permanently
        # locked out of their session.
        cur.execute("ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ")
        cur.execute("ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by_token TEXT")
        # Session identity across a rotation chain, for the session-list /
        # remote-revoke ("log out this device") feature — see auth_routes.py.
        cur.execute("ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT")
        cur.execute("ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ")

        # Staff-facing push reminders (distinct from the customer-facing
        # 1day/3day/7day/same_day set) — the studio admin adds as many rules
        # as they want, each with an arbitrary lead time, applying to
        # appointments and/or tasks. No fixed set of lead times by design.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS staff_reminder_rules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                applies_to VARCHAR(20) NOT NULL DEFAULT 'both',
                lead_minutes INTEGER NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_staff_reminder_rules_studio ON staff_reminder_rules (studio_id)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS staff_reminder_sent_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                rule_id UUID NOT NULL REFERENCES staff_reminder_rules(id) ON DELETE CASCADE,
                target_type VARCHAR(20) NOT NULL,
                target_id UUID NOT NULL,
                occurrence_date DATE NOT NULL,
                sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_staff_reminder_sent UNIQUE (rule_id, target_type, target_id, occurrence_date)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_staff_reminder_sent_log_rule ON staff_reminder_sent_log (rule_id)")

        # ── Universal Migration Engine (app/models/migration.py, app/migration/) ──
        cur.execute("CREATE SEQUENCE IF NOT EXISTS migration_code_seq")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS migrations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                code VARCHAR(32) NOT NULL UNIQUE,
                source VARCHAR(32) NOT NULL,
                connector_version VARCHAR(16) NOT NULL,
                entity_type VARCHAR(24) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'draft',
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                file_name VARCHAR(255),
                settings JSONB NOT NULL DEFAULT '{}',
                summary JSONB,
                error TEXT,
                heartbeat_at TIMESTAMPTZ,
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                rolled_back_at TIMESTAMPTZ,
                raw_purged_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_migrations_studio ON migrations (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_migrations_status ON migrations (status)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS migration_rows (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                migration_id UUID NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
                studio_id UUID NOT NULL,
                row_number INTEGER NOT NULL,
                raw JSONB,
                data JSONB,
                issues JSONB,
                external_id VARCHAR(128),
                phone_key VARCHAR(40),
                email_key VARCHAR(254),
                name_key VARCHAR(200),
                scanned BOOLEAN NOT NULL DEFAULT false,
                match_status VARCHAR(20),
                match_target_id UUID,
                match_reason VARCHAR(48),
                decision VARCHAR(8),
                status VARCHAR(12) NOT NULL DEFAULT 'pending',
                action VARCHAR(10),
                local_id UUID,
                applied JSONB,
                link_created BOOLEAN NOT NULL DEFAULT false,
                error TEXT,
                CONSTRAINT uq_migration_row UNIQUE (migration_id, row_number)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_migration_rows_migration ON migration_rows (migration_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_migration_rows_studio ON migration_rows (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_migration_rows_match ON migration_rows (migration_id, match_status)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_migration_rows_status ON migration_rows (migration_id, status)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS external_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                source VARCHAR(32) NOT NULL,
                entity_type VARCHAR(24) NOT NULL,
                external_id VARCHAR(128) NOT NULL,
                local_id UUID NOT NULL,
                migration_id UUID REFERENCES migrations(id) ON DELETE SET NULL,
                created_by_migration BOOLEAN NOT NULL DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_external_record UNIQUE (studio_id, source, entity_type, external_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_external_records_local ON external_records (local_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_external_records_migration ON external_records (migration_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS migration_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                migration_id UUID NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
                studio_id UUID NOT NULL,
                user_id UUID,
                level VARCHAR(8) NOT NULL DEFAULT 'info',
                code VARCHAR(48) NOT NULL,
                message TEXT NOT NULL DEFAULT '',
                data JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_migration_events_migration ON migration_events (migration_id)")

        # The "migration" module. Granted to every plan once, when the module row is first created —
        # not on every startup, so a superadmin who later removes it from a plan is not overridden.
        cur.execute("SELECT 1 FROM modules WHERE id = 'migration'")
        _migration_module_is_new = cur.fetchone() is None
        cur.execute("""
            INSERT INTO modules (id, name, category, sort_order)
            VALUES ('migration', 'ייבוא נתונים ממערכות אחרות', 'core', 25)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category
        """)
        if _migration_module_is_new:
            cur.execute("INSERT INTO plan_modules (plan, module_id) SELECT id, 'migration' FROM plans ON CONFLICT DO NOTHING")

        # ── Classes & memberships — stage 1: infrastructure ───────────────────
        # Notification choices per business (app/services/notifications.py) and the owner's settings at
        # every level (app/services/policies.py).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS notification_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                event VARCHAR(40) NOT NULL,
                channel VARCHAR(16) NOT NULL,
                enabled BOOLEAN,
                body TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_notification_template UNIQUE (studio_id, event, channel)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_notification_templates_studio ON notification_templates (studio_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS policy_settings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                scope_type VARCHAR(20) NOT NULL,
                scope_id UUID,
                key VARCHAR(48) NOT NULL,
                value JSONB NOT NULL,
                updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_policy_settings_studio ON policy_settings (studio_id)")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_setting ON policy_settings
                       (studio_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), key)""")
        # One message per event, recipient and channel — even for two identical events at the same moment.
        cur.execute("ALTER TABLE message_jobs ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(160)")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_message_jobs_dedup ON message_jobs (studio_id, dedup_key)
                       WHERE dedup_key IS NOT NULL""")
        cur.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(160)")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedup ON notifications (studio_id, dedup_key)
                       WHERE dedup_key IS NOT NULL""")
        # The modules. Not granted to any plan — a tattoo studio does not need them; the superadmin turns
        # them on. The fields they fit (pilates/yoga, gym) get them in their default modules — once, when the
        # modules are first created, so a later change by the superadmin is not undone.
        cur.execute("SELECT 1 FROM modules WHERE id = 'classes'")
        _classes_modules_are_new = cur.fetchone() is None
        for _mid, _name, _parent, _order in (("classes", "שיעורים קבוצתיים", None, 40),
                                             ("rooms", "חדרים", None, 41),
                                             ("memberships", "מנויים וכרטיסיות", None, 42),
                                             ("class_waitlist", "רשימת המתנה לשיעורים", "classes", 43)):
            cur.execute("""
                INSERT INTO modules (id, name, category, sort_order, parent_module_id)
                VALUES (%s, %s, 'core', %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, (_mid, _name, _order, _parent))
        if _classes_modules_are_new:
            cur.execute("""
                UPDATE business_type_templates
                SET default_modules = default_modules || '["classes", "rooms", "memberships", "class_waitlist"]'::jsonb
                WHERE business_type IN ('pilates', 'gym') AND NOT default_modules ? 'classes'
            """)

        # ── Classes & memberships — stage 2: rooms, class templates, sessions (app/models/classes.py) ──
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rooms (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                name VARCHAR(120) NOT NULL,
                capacity INTEGER NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT true,
                source VARCHAR(16) NOT NULL DEFAULT 'user',
                source_ref VARCHAR(120),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_rooms_studio_id ON rooms (studio_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS class_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                name VARCHAR(160) NOT NULL,
                service_id UUID REFERENCES services(id) ON DELETE SET NULL,
                color VARCHAR(16),
                room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
                instructor_id UUID REFERENCES users(id) ON DELETE SET NULL,
                capacity INTEGER NOT NULL,
                weekdays SMALLINT[] NOT NULL,
                start_time TIME NOT NULL,
                duration_minutes INTEGER NOT NULL,
                starts_on DATE NOT NULL,
                ends_on DATE,
                sessions_count INTEGER,
                is_active BOOLEAN NOT NULL DEFAULT true,
                source VARCHAR(16) NOT NULL DEFAULT 'user',
                source_ref VARCHAR(120),
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_templates_studio_id ON class_templates (studio_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS class_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                template_id UUID REFERENCES class_templates(id) ON DELETE SET NULL,
                occurs_on DATE NOT NULL,
                starts_at TIMESTAMPTZ NOT NULL,
                ends_at TIMESTAMPTZ NOT NULL,
                room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
                instructor_id UUID REFERENCES users(id) ON DELETE SET NULL,
                capacity INTEGER NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
                detached BOOLEAN NOT NULL DEFAULT false,
                cancel_reason TEXT,
                canceled_at TIMESTAMPTZ,
                canceled_by UUID REFERENCES users(id) ON DELETE SET NULL,
                source VARCHAR(16) NOT NULL DEFAULT 'system',
                source_ref VARCHAR(120),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_class_session_template_date UNIQUE (template_id, occurs_on)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_sessions_studio_id ON class_sessions (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_sessions_template_id ON class_sessions (template_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_sessions_starts_at ON class_sessions (starts_at)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS class_bookings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                status VARCHAR(16) NOT NULL DEFAULT 'booked',
                source VARCHAR(16) NOT NULL DEFAULT 'user',
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                canceled_at TIMESTAMPTZ,
                cancel_reason VARCHAR(32)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_bookings_studio_id ON class_bookings (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_bookings_session_id ON class_bookings (session_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_bookings_client_id ON class_bookings (client_id)")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_class_booking_active ON class_bookings (session_id, client_id)
                       WHERE status <> 'canceled'""")
        # stage 3: bookings — attendance, over-capacity record, the background jobs' once-per-session marks
        for _col in ("canceled_by UUID REFERENCES users(id) ON DELETE SET NULL",
                     "over_capacity BOOLEAN NOT NULL DEFAULT false",
                     "marked_at TIMESTAMPTZ",
                     "marked_by UUID REFERENCES users(id) ON DELETE SET NULL"):
            cur.execute(f"ALTER TABLE class_bookings ADD COLUMN IF NOT EXISTS {_col}")
        cur.execute("ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ")
        cur.execute("ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS min_checked_at TIMESTAMPTZ")

        # ── Classes & memberships — stage 4: memberships (app/models/memberships.py) ──────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS membership_types (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                name VARCHAR(120) NOT NULL,
                kind VARCHAR(16) NOT NULL,
                price_cents INTEGER NOT NULL DEFAULT 0,
                duration_days INTEGER,
                entries INTEGER,
                covers_all BOOLEAN NOT NULL DEFAULT true,
                covered_templates UUID[] NOT NULL DEFAULT '{}',
                is_active BOOLEAN NOT NULL DEFAULT true,
                source VARCHAR(16) NOT NULL DEFAULT 'user',
                source_ref VARCHAR(120),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_membership_types_studio_id ON membership_types (studio_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS memberships (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                type_id UUID REFERENCES membership_types(id) ON DELETE SET NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                starts_on DATE NOT NULL,
                ends_on DATE,
                rules JSONB NOT NULL DEFAULT '{}'::jsonb,
                price_cents INTEGER NOT NULL DEFAULT 0,
                renewal_expected_on DATE,
                notes TEXT,
                source VARCHAR(16) NOT NULL DEFAULT 'user',
                source_ref VARCHAR(120),
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_memberships_studio_id ON memberships (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_memberships_client_id ON memberships (client_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS membership_entry_ledger (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
                booking_id UUID REFERENCES class_bookings(id) ON DELETE SET NULL,
                stage VARCHAR(10) NOT NULL,
                outcome VARCHAR(10),
                amount INTEGER NOT NULL DEFAULT 1,
                reason VARCHAR(160),
                source VARCHAR(16) NOT NULL DEFAULT 'user',
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_membership_entry_ledger_studio_id ON membership_entry_ledger (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_membership_entry_ledger_membership_id ON membership_entry_ledger (membership_id)")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_entry_booking_stage ON membership_entry_ledger (booking_id, stage)
                       WHERE booking_id IS NOT NULL AND stage IN ('reserve', 'close')""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS booking_policy_rules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                scope_type VARCHAR(20) NOT NULL,
                scope_id UUID,
                event VARCHAR(16) NOT NULL,
                from_count INTEGER NOT NULL DEFAULT 1,
                within_days INTEGER,
                action VARCHAR(10) NOT NULL,
                amount_cents INTEGER,
                percent INTEGER,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_booking_policy_rules_studio_id ON booking_policy_rules (studio_id)")
        for _col in ("membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL",
                     "entry_state VARCHAR(10)",
                     "drop_in BOOLEAN NOT NULL DEFAULT false",
                     "justified BOOLEAN NOT NULL DEFAULT false",
                     "policy_action VARCHAR(10)",
                     "swapped_from_booking_id UUID"):
            cur.execute(f"ALTER TABLE class_bookings ADD COLUMN IF NOT EXISTS {_col}")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_bookings_membership_id ON class_bookings (membership_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS class_fees (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                booking_id UUID NOT NULL UNIQUE REFERENCES class_bookings(id) ON DELETE CASCADE,
                rule_id UUID REFERENCES booking_policy_rules(id) ON DELETE SET NULL,
                event VARCHAR(16) NOT NULL,
                amount_cents INTEGER NOT NULL,
                reason VARCHAR(200) NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'pending',
                waived_by UUID REFERENCES users(id) ON DELETE SET NULL,
                waived_at TIMESTAMPTZ,
                waive_reason VARCHAR(200),
                paid_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_fees_studio_id ON class_fees (studio_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_class_fees_client_id ON class_fees (client_id)")
        # A payment for a membership or a class booking, not only an appointment (the plan's decision 9:
        # extend payments, no parallel table). Every report was checked (commit message, stage 4 part 3).
        cur.execute("ALTER TABLE payments ALTER COLUMN appointment_id DROP NOT NULL")
        cur.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES memberships(id)")
        cur.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS class_booking_id UUID REFERENCES class_bookings(id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_payments_membership_id ON payments (membership_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_payments_class_booking_id ON payments (class_booking_id)")
        cur.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_payments_subject') THEN
                    ALTER TABLE payments ADD CONSTRAINT ck_payments_subject
                        CHECK (appointment_id IS NOT NULL OR membership_id IS NOT NULL OR class_booking_id IS NOT NULL);
                END IF;
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
