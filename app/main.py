import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI

logging.basicConfig(
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
)

_sentry_dsn = os.getenv("SENTRY_DSN", "")
if _sentry_dsn:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        sentry_sdk.init(
            dsn=_sentry_dsn,
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
            traces_sample_rate=0.1,
            environment=os.getenv("ENVIRONMENT", "production"),
            send_default_pii=False,
        )
        logging.getLogger(__name__).info("Sentry initialized")
    except ImportError:
        logging.getLogger(__name__).warning("sentry-sdk not installed, skipping")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.limiter import limiter
from apscheduler.schedulers.background import BackgroundScheduler

from app.db.session import SessionLocal
from app.services.message_worker import process_due_jobs, sweep_upcoming_reminders, sweep_7day_reminders, sweep_3day_reminders, sweep_birthday_messages, sweep_same_day_reminders
from app.services.plan_alert_service import sweep_plan_expiry_alerts
from app.api.router import api_router
from app.services.automation_service import AutomationService
from app.middleware.plan_enforcement import PlanEnforcementMiddleware


scheduler = BackgroundScheduler()

def start_scheduler():
    if os.getenv("DISABLE_SCHEDULER") == "1":
        return

    def tick_jobs():
        db = SessionLocal()
        try:
            process_due_jobs(db)
        finally:
            db.close()

    def tick_reminders():
        db = SessionLocal()
        try:
            sweep_upcoming_reminders(db)
            sweep_7day_reminders(db)
            sweep_3day_reminders(db)
        finally:
            db.close()

    def tick_same_day_reminders():
        db = SessionLocal()
        try:
            sweep_same_day_reminders(db)
        finally:
            db.close()

    def tick_plan_alerts():
        db = SessionLocal()
        try:
            sweep_plan_expiry_alerts(db)
        finally:
            db.close()

    def tick_birthday_messages():
        db = SessionLocal()
        try:
            sweep_birthday_messages(db)
        finally:
            db.close()

    def tick_birthday_automations():
        """Fire client_birthday automation rules for clients with a birthday today."""
        import pytz as _pytz
        from datetime import date as _date
        from sqlalchemy import select as _select, extract as _extract
        from app.models.client import Client as _Client
        from app.services.automation_engine import fire_event as _fire
        db = SessionLocal()
        try:
            _today = _date.today()  # server date (UTC); birthday month/day still match
            clients = db.scalars(
                _select(_Client).where(
                    _Client.birth_date.isnot(None),
                    _Client.is_active == True,  # noqa
                    _extract("month", _Client.birth_date) == _today.month,
                    _extract("day", _Client.birth_date) == _today.day,
                )
            ).all()
            for c in clients:
                try:
                    _fire(db, c.studio_id, "client_birthday", {
                        "client_name": c.full_name,
                        "client_phone": c.phone or "",
                    }, client_id=c.id)
                except Exception:
                    pass
        except Exception:
            logging.getLogger("bizcontrol.automations").exception("birthday automations sweep failed")
        finally:
            db.close()

    def tick_expire_coupons():
        from app.crud.birthday_coupon import expire_old_coupons
        db = SessionLocal()
        try:
            expired = expire_old_coupons(db)
            if expired:
                logging.getLogger("bizcontrol.coupons").info("Expired %d birthday coupons", expired)
        finally:
            db.close()

    scheduler.add_job(tick_jobs, "interval", seconds=20, id="message_jobs_tick", replace_existing=True)
    scheduler.add_job(tick_reminders, "interval", minutes=60, id="reminders_sweep_tick", replace_existing=True)
    scheduler.add_job(tick_same_day_reminders, "cron", hour=8, minute=0, timezone="Asia/Jerusalem", id="same_day_reminders_tick", replace_existing=True)
    scheduler.add_job(tick_plan_alerts, "cron", hour=9, minute=0, id="plan_alerts_tick", replace_existing=True)
    scheduler.add_job(tick_birthday_messages, "cron", day=25, hour=10, minute=0, id="birthday_messages_tick", replace_existing=True)
    scheduler.add_job(tick_birthday_automations, "cron", hour=9, minute=5, timezone="Asia/Jerusalem", id="birthday_automations_tick", replace_existing=True)

    def tick_waitlist_expiry():
        """Mark wait-list entries notified >24h ago as expired."""
        from datetime import timedelta
        from sqlalchemy import select as _sel, update as _upd
        from app.models.wait_list import WaitListEntry as _WL
        db = SessionLocal()
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
            db.execute(
                _upd(_WL)
                .where(_WL.status == "notified", _WL.notified_at < cutoff)
                .values(status="expired")
            )
            db.commit()
        except Exception:
            logging.getLogger("bizcontrol.waitlist").exception("waitlist expiry sweep failed")
        finally:
            db.close()

    scheduler.add_job(tick_waitlist_expiry, "interval", hours=1, id="waitlist_expiry_tick", replace_existing=True)
    scheduler.add_job(tick_expire_coupons, "cron", hour=1, minute=0, id="expire_coupons_tick", replace_existing=True)
    scheduler.start()

def stop_scheduler():
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
    except Exception:
        pass

def run_migrations():
    from sqlalchemy import text
    from app.core.database import engine
    with engine.connect() as conn:
        # Fix payments method constraint to include all frontend methods
        conn.execute(text("ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_method"))
        conn.execute(text(
            "ALTER TABLE payments ADD CONSTRAINT ck_payments_method "
            "CHECK (method IN ('cash','bit','credit','credit_card','paypal','bank','bank_transfer','paybox','installment','other'))"
        ))
        conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_opted_out BOOLEAN NOT NULL DEFAULT false"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS treatment_types TEXT"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS birthday_automation_enabled BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS meta_ad_account_id VARCHAR(64)"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ad_insights (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                date_start DATE NOT NULL,
                date_stop DATE NOT NULL,
                campaign_id VARCHAR(64) NOT NULL,
                campaign_name VARCHAR(255) NOT NULL DEFAULT '',
                ad_set_id VARCHAR(64),
                ad_set_name VARCHAR(255),
                ad_id VARCHAR(64),
                ad_name VARCHAR(255),
                impressions INTEGER NOT NULL DEFAULT 0,
                clicks INTEGER NOT NULL DEFAULT 0,
                reach INTEGER NOT NULL DEFAULT 0,
                spend_cents INTEGER NOT NULL DEFAULT 0,
                leads INTEGER NOT NULL DEFAULT 0,
                link_clicks INTEGER NOT NULL DEFAULT 0,
                actions JSONB,
                synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_insights (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                type VARCHAR(32) NOT NULL,
                title VARCHAR(255) NOT NULL,
                body TEXT NOT NULL,
                priority VARCHAR(16) NOT NULL DEFAULT 'medium',
                icon VARCHAR(8),
                generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS quick_replies (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                title VARCHAR(100) NOT NULL,
                body TEXT NOT NULL,
                shortcut VARCHAR(30),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS reminder_3day_wa_template TEXT"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS reminder_7day_wa_template TEXT"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_pin_settings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                pin_hash TEXT NOT NULL,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pin_attempt_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                success BOOLEAN NOT NULL,
                ip_address VARCHAR(45),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tasks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                title VARCHAR(200) NOT NULL,
                task_date DATE,
                start_time VARCHAR(5),
                end_time VARCHAR(5),
                notes TEXT,
                color VARCHAR(7) NOT NULL DEFAULT '#8b5cf6',
                recurrence_type VARCHAR(20) NOT NULL DEFAULT 'none',
                recurrence_day INTEGER,
                recurrence_month INTEGER,
                recurrence_end_date DATE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS customer_club_cards (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                qr_token VARCHAR(64) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_club_card_per_client UNIQUE (studio_id, client_id),
                CONSTRAINT uq_club_card_token UNIQUE (qr_token)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS wallet_pass_designs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL UNIQUE REFERENCES studios(id) ON DELETE CASCADE,
                background_color VARCHAR(32) NOT NULL DEFAULT '#1a1a2e',
                text_color VARCHAR(32) NOT NULL DEFAULT '#ffffff',
                strip_color VARCHAR(32) NOT NULL DEFAULT '#6366f1',
                label_color VARCHAR(32) NOT NULL DEFAULT '#a5b4fc',
                logo_url TEXT,
                icon_url TEXT,
                show_points BOOLEAN NOT NULL DEFAULT true,
                show_tier BOOLEAN NOT NULL DEFAULT true,
                show_barcode BOOLEAN NOT NULL DEFAULT true,
                card_title VARCHAR(100),
                card_description VARCHAR(200),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS customer_login_otps (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                code VARCHAR(6) NOT NULL,
                channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
                expires_at TIMESTAMPTZ NOT NULL,
                used BOOLEAN NOT NULL DEFAULT false,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS birthday_coupons (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                code VARCHAR(32) NOT NULL,
                discount_percent INTEGER NOT NULL DEFAULT 10,
                birthday_month INTEGER NOT NULL,
                birthday_year INTEGER NOT NULL,
                starts_at TIMESTAMPTZ NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                redeemed_at TIMESTAMPTZ,
                payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
                appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_birthday_coupon_code UNIQUE (code),
                CONSTRAINT uq_birthday_coupon_per_year UNIQUE (studio_id, client_id, birthday_month, birthday_year)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS monthly_goals (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                target_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
                CONSTRAINT uq_monthly_goals_studio_date UNIQUE (studio_id, year, month)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS membership_tiers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                name VARCHAR(60) NOT NULL,
                color VARCHAR(20) NOT NULL DEFAULT '#C0C0C0',
                icon VARCHAR(10) NOT NULL DEFAULT '⭐',
                rank_order INTEGER NOT NULL DEFAULT 1,
                threshold_type VARCHAR(30) NOT NULL DEFAULT 'visits',
                threshold_value INTEGER NOT NULL DEFAULT 1,
                points_multiplier FLOAT NOT NULL DEFAULT 1.0,
                birthday_gift_percent INTEGER NOT NULL DEFAULT 10,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS stamp_cards (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                required_stamps INTEGER NOT NULL DEFAULT 5,
                reward_type VARCHAR(30) NOT NULL DEFAULT 'discount_percent',
                reward_value INTEGER NOT NULL DEFAULT 10,
                reward_description VARCHAR(200),
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS client_stamp_progress (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                stamp_card_id UUID NOT NULL REFERENCES stamp_cards(id) ON DELETE CASCADE,
                stamps_collected INTEGER NOT NULL DEFAULT 0,
                completed_count INTEGER NOT NULL DEFAULT 0,
                last_stamp_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_stamp_progress UNIQUE (studio_id, client_id, stamp_card_id)
            )
        """))

        # ── z11: Feature flags + credentials + webhook logs ────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS studio_features (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                feature VARCHAR(64) NOT NULL,
                is_enabled BOOLEAN NOT NULL DEFAULT false,
                enabled_by UUID REFERENCES users(id) ON DELETE SET NULL,
                enabled_at TIMESTAMPTZ,
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_studio_feature UNIQUE (studio_id, feature)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS studio_credentials (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                platform VARCHAR(32) NOT NULL,
                key_name VARCHAR(64) NOT NULL,
                encrypted_value TEXT NOT NULL,
                injected_by UUID REFERENCES users(id) ON DELETE SET NULL,
                injected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ,
                notes TEXT,
                CONSTRAINT uq_studio_credential UNIQUE (studio_id, platform, key_name)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS webhook_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID,
                platform VARCHAR(32) NOT NULL,
                event_type VARCHAR(64) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'ok',
                payload JSONB,
                error TEXT,
                received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_webhook_logs_studio ON webhook_logs(studio_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_webhook_logs_received ON webhook_logs(received_at DESC)"))

        # ── z12: Unified conversations + messages + lead attribution ──────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
                lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
                platform VARCHAR(20) NOT NULL,
                external_id VARCHAR(128) NOT NULL,
                display_name VARCHAR(255),
                source_type VARCHAR(32),
                campaign_id VARCHAR(64),
                campaign_name VARCHAR(255),
                ad_id VARCHAR(64),
                ad_name VARCHAR(255),
                post_id VARCHAR(128),
                reel_id VARCHAR(128),
                referral_url TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'open',
                assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
                is_pinned BOOLEAN NOT NULL DEFAULT false,
                tags JSONB,
                internal_notes TEXT,
                first_response_at TIMESTAMPTZ,
                last_message_at TIMESTAMPTZ,
                unread_count INTEGER NOT NULL DEFAULT 0,
                message_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_conversation UNIQUE (studio_id, platform, external_id)
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_studio_id ON conversations(studio_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_client_id ON conversations(client_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_lead_id ON conversations(lead_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_last_message ON conversations(studio_id, last_message_at)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversations_platform ON conversations(studio_id, platform)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                direction VARCHAR(4) NOT NULL,
                platform VARCHAR(20) NOT NULL,
                external_message_id VARCHAR(128),
                type VARCHAR(20) NOT NULL DEFAULT 'text',
                body TEXT,
                media_url TEXT,
                media_type VARCHAR(32),
                is_read BOOLEAN NOT NULL DEFAULT false,
                delivery_status VARCHAR(20),
                sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
                sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_messages_conversation_id ON messages(conversation_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_messages_studio_id ON messages(studio_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_messages_sent_at ON messages(conversation_id, sent_at)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS lead_sources (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
                lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                conversation_id UUID,
                platform VARCHAR(20) NOT NULL,
                source_type VARCHAR(32) NOT NULL,
                campaign_id VARCHAR(64),
                campaign_name VARCHAR(255),
                ad_set_id VARCHAR(64),
                ad_id VARCHAR(64),
                ad_name VARCHAR(255),
                post_id VARCHAR(128),
                reel_id VARCHAR(128),
                story_id VARCHAR(128),
                referral_url TEXT,
                converted_to_booking BOOLEAN NOT NULL DEFAULT false,
                converted_at TIMESTAMPTZ,
                revenue_cents INTEGER,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lead_sources_studio_id ON lead_sources(studio_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lead_sources_lead_id ON lead_sources(lead_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lead_sources_campaign ON lead_sources(studio_id, campaign_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lead_sources_ad ON lead_sources(studio_id, ad_id)"))

        # ── תזכורות — שדות חדשים ──────────────────────────────────────────────
        conn.execute(text("ALTER TABLE message_jobs ADD COLUMN IF NOT EXISTS reminder_type VARCHAR(32)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_message_jobs_reminder_type ON message_jobs(appointment_id, reminder_type) WHERE reminder_type IS NOT NULL"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS same_day_reminder_enabled BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS reminder_1_day_enabled BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS reminder_3_days_enabled BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS reminder_7_days_enabled BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS deposit_warning_enabled BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS same_day_reminder_wa_template TEXT"))

        conn.commit()

@asynccontextmanager
async def lifespan(_app: FastAPI):
    run_migrations()
    start_scheduler()
    AutomationService.register() # Register event handlers
    os.makedirs("uploads", exist_ok=True)
    yield
    stop_scheduler()

app = FastAPI(title="BizControl", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Ensure uploads directory exists before mounting
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

_BUILTIN_ORIGINS = [
    "https://bizfind-nine.vercel.app",
    "https://www.biz-control.com",
    "https://bizcontrol-seven.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001",
]
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_extra = [o.strip() for o in _raw_origins.split(",") if o.strip()] if _raw_origins else []
origins = list(dict.fromkeys(_BUILTIN_ORIGINS + _extra)) if (_BUILTIN_ORIGINS or _extra) else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(PlanEnforcementMiddleware)

app.include_router(api_router, prefix="/api")

@app.get("/health")
def health():
    missing = [k for k in ("JWT_SECRET", "DATABASE_URL", "RESEND_API_KEY") if not os.getenv(k)]
    if missing:
        import logging
        logging.getLogger("bizcontrol.health").warning("Missing env vars: %s", missing)
    return {"status": "ok", "missing_config": missing}
