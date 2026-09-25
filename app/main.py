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
from app.services.message_worker import process_due_jobs, sweep_upcoming_reminders, sweep_7day_reminders, sweep_3day_reminders, sweep_birthday_messages, sweep_same_day_reminders, sweep_deposit_reminders, sweep_staff_reminders
from app.services.plan_alert_service import sweep_plan_expiry_alerts, sweep_subscription_transitions
from app.api.router import api_router
from app.services.automation_service import AutomationService
from app.middleware.plan_enforcement import PlanEnforcementMiddleware


scheduler = BackgroundScheduler()
_scheduler_log = logging.getLogger("bizcontrol.scheduler")

def start_scheduler():
    if os.getenv("DISABLE_SCHEDULER") == "1":
        return

    def tick_jobs():
        db = SessionLocal()
        try:
            process_due_jobs(db)
        except Exception as e:
            # This tick runs every 20s and previously had no error handling at
            # all — a recurring failure here (DB hiccup, lock contention, etc.)
            # meant the ENTIRE message queue silently stopped draining, with
            # zero signal to the studio owner or admin. Log + alert (1h cooldown
            # inside alert_integration_failure, so a persistent failure doesn't
            # spam) instead of failing silently.
            _scheduler_log.exception("process_due_jobs tick failed")
            try:
                db.rollback()  # clear any failed-transaction state before reusing the session
                from app.services.integration_alerts import alert_integration_failure
                alert_integration_failure(db, "תור הודעות (WhatsApp/Email) — תקלה כללית", str(e), force=True)
            except Exception:
                _scheduler_log.exception("failed to send process_due_jobs failure alert")
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

    def tick_subscription_transitions():
        db = SessionLocal()
        try:
            sweep_subscription_transitions(db)
        finally:
            db.close()

    def tick_birthday_messages():
        db = SessionLocal()
        try:
            sweep_birthday_messages(db)
        finally:
            db.close()

    def tick_deposit_reminders():
        db = SessionLocal()
        try:
            sweep_deposit_reminders(db)
        finally:
            db.close()

    def tick_staff_reminders():
        db = SessionLocal()
        try:
            sweep_staff_reminders(db)
        except Exception:
            _scheduler_log.exception("sweep_staff_reminders tick failed")
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
    scheduler.add_job(tick_subscription_transitions, "cron", hour=9, minute=15, id="subscription_transitions_tick", replace_existing=True)
    # Runs DAILY (not monthly) — sweep_birthday_messages now sends each club
    # member a personal message 2 days before their own birthday, instead of
    # one generic batch at the start of the birthday month.
    scheduler.add_job(tick_birthday_messages, "cron", hour=10, minute=0, timezone="Asia/Jerusalem", misfire_grace_time=86400, id="birthday_messages_tick", replace_existing=True)
    scheduler.add_job(tick_deposit_reminders, "interval", hours=1, id="deposit_reminders_tick", replace_existing=True)
    scheduler.add_job(tick_staff_reminders, "interval", minutes=2, id="staff_reminders_tick", replace_existing=True)

    def tick_waitlist_expiry():
        """Mark wait-list entries notified >24h ago as expired."""
        from datetime import datetime, timedelta, timezone
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

    def tick_broadcasts():
        """Process scheduled broadcasts — create MessageJob per recipient."""
        from datetime import datetime as _dt, timezone as _tz
        from sqlalchemy import select as _sel, update as _upd
        from app.models.broadcast import Broadcast
        from app.models.message_job import MessageJob
        from app.models.studio_settings import StudioSettings
        from app.services.marketing import unsubscribe_link
        _log = logging.getLogger("bizcontrol.broadcasts")
        db = SessionLocal()
        try:
            now = _dt.now(_tz.utc)
            due = db.scalars(
                _sel(Broadcast).where(
                    Broadcast.status == "scheduled",
                    Broadcast.scheduled_at <= now,
                )
            ).all()
            for b in due:
                b.status = "processing"
                db.commit()
                # Only clients who may receive marketing (app/services/marketing.py); the dispatcher
                # re-checks each message at send time.
                from app.services.marketing import broadcast_recipients_query
                clients = db.scalars(broadcast_recipients_query(b.studio_id, b.audience)).all()
                for client in clients:
                    client_name = getattr(client, "name", None) or getattr(client, "full_name", None) or ""
                    personalized_body = b.body.replace("{client_name}", client_name) if "{client_name}" in b.body else b.body

                    # Opt-out link — a personal link per recipient so a broadcast
                    # never goes out without a way to unsubscribe. If the studio
                    # placed {optout_link} in the text, fill it in there; otherwise
                    # append a default footer.
                    optout_link = unsubscribe_link(db, b.studio_id, client.id)
                    if "{optout_link}" in personalized_body:
                        personalized_body = personalized_body.replace("{optout_link}", f"להסרה מרשימת התפוצה: {optout_link}")
                    else:
                        personalized_body = f"{personalized_body}\n\nלהסרה מרשימת התפוצה: {optout_link}"

                    db.add(MessageJob(
                        studio_id=b.studio_id,
                        client_id=client.id,
                        channel="whatsapp",
                        to_phone=client.phone,
                        body=personalized_body,
                        media_url=b.media_url or None,
                        scheduled_at=now,
                        status="pending",
                        reminder_type="broadcast",
                    ))
                b.status = "sent"
                b.sent_count = len(clients)
                db.commit()
                _log.info("Broadcast %s sent to %d recipients", b.id, len(clients))
        except Exception:
            _log.exception("broadcasts sweep failed")
        finally:
            db.close()

    scheduler.add_job(tick_broadcasts, "interval", minutes=1, id="broadcasts_tick", replace_existing=True)

    def tick_cleanup_handoffs():
        from sqlalchemy import text as _text
        db = SessionLocal()
        try:
            db.execute(
                _text("DELETE FROM auth_handoff_codes WHERE expires_at < NOW() - INTERVAL '1 hour'")
            )
            db.commit()
        except Exception:
            logging.getLogger("bizcontrol.handoffs").exception("handoff cleanup failed")
        finally:
            db.close()

    scheduler.add_job(tick_cleanup_handoffs, "cron", hour=3, minute=0, id="handoff_cleanup", replace_existing=True)

    def tick_migrations():
        """Advance imports that are mid-scan or mid-import (also resumes them after a restart)."""
        from app.migration.engine import tick
        try:
            tick()
        except Exception:
            logging.getLogger("bizcontrol.migration").exception("migration tick failed")

    def tick_migration_purge():
        """Raw source rows of finished imports are deleted after 30 days."""
        from app.migration.engine import purge_old_raw
        db = SessionLocal()
        try:
            purge_old_raw(db)
        except Exception:
            db.rollback()
            logging.getLogger("bizcontrol.migration").exception("migration purge failed")
        finally:
            db.close()

    def tick_class_sessions():
        """Keeps every class schedule filled weeks_ahead weeks ahead (app/services/classes.py)."""
        from app.services.classes import generate_all
        from app.services.memberships import refresh_statuses
        db = SessionLocal()
        try:
            generate_all(db)
            refresh_statuses(db)            # memberships: pending → active on their day, → expired at the end
        except Exception:
            db.rollback()
            logging.getLogger("bizcontrol.classes").exception("class sessions tick failed")
        finally:
            db.close()

    scheduler.add_job(tick_class_sessions, "cron", hour=2, minute=30, timezone="Asia/Jerusalem",
                      misfire_grace_time=6 * 3600, id="class_sessions_tick", replace_existing=True)

    def tick_class_checks():
        """Before each class: the reminder, and the minimum-participants check (app/services/class_bookings.py)."""
        from app.services.class_bookings import sweep_min_participants, sweep_reminders
        db = SessionLocal()
        try:
            sweep_min_participants(db)      # first: a class cancelled here gets no reminder
            sweep_reminders(db)
        except Exception:
            db.rollback()
            logging.getLogger("bizcontrol.classes").exception("class checks tick failed")
        finally:
            db.close()

    scheduler.add_job(tick_class_checks, "interval", minutes=10, id="class_checks_tick", replace_existing=True,
                      max_instances=1, coalesce=True)

    def tick_membership_notices():
        """Memberships ending in 7 / 3 days, 2 entries left, back from a freeze tomorrow (membership_changes)."""
        from app.services.membership_changes import sweep_notices
        db = SessionLocal()
        try:
            sweep_notices(db)
        except Exception:
            db.rollback()
            logging.getLogger("bizcontrol.classes").exception("membership notices tick failed")
        finally:
            db.close()

    scheduler.add_job(tick_membership_notices, "cron", hour=10, minute=0, timezone="Asia/Jerusalem",
                      misfire_grace_time=6 * 3600, id="membership_notices_tick", replace_existing=True)
    scheduler.add_job(tick_migrations, "interval", seconds=15, id="migrations_tick", replace_existing=True,
                      max_instances=1, coalesce=True)
    scheduler.add_job(tick_migration_purge, "cron", hour=3, minute=30, timezone="Asia/Jerusalem",
                      id="migrations_purge", replace_existing=True)
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
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS club_invite_enabled BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS club_invite_delay_minutes INTEGER NOT NULL DEFAULT 30"))
        conn.execute(text("ALTER TABLE studio_settings ADD COLUMN IF NOT EXISTS birthday_automation_enabled BOOLEAN NOT NULL DEFAULT true"))
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

        # ── z12: Lead attribution ─────────────────────────────────────────────
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

_is_production = os.getenv("ENVIRONMENT", "production") == "production"
app = FastAPI(
    title="BizControl",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Ensure uploads directory exists before mounting
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

_BUILTIN_ORIGINS = [
    "https://bizfind-nine.vercel.app",
    "https://find.biz-control.com",
    "https://biz-control.com",
    "https://www.biz-control.com",
    "https://bizcontrol-seven.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001",
    # Native Capacitor shells use these local origins while communicating with
    # the same HTTPS API as the web application.
    "capacitor://localhost",
    "http://localhost",
]
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_extra = [o.strip() for o in _raw_origins.split(",") if o.strip()] if _raw_origins else []
origins = list(dict.fromkeys(_BUILTIN_ORIGINS + _extra)) if (_BUILTIN_ORIGINS or _extra) else ["*"]

# CORSMiddleware must be the outermost middleware (added last — Starlette
# wraps in reverse order of add_middleware calls). PlanEnforcementMiddleware
# is a BaseHTTPMiddleware subclass; when it sat outside CORSMiddleware, its
# response reconstruction could drop the CORS headers CORSMiddleware had
# already added, especially on error/edge-case responses — the browser then
# reports "CORS blocked" even though the server fully processed the request
# (e.g. an appointment actually gets created, but the client sees a failure).
app.add_middleware(PlanEnforcementMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["server"] = "webserver"
    return response


app.include_router(api_router, prefix="/api")

@app.get("/health")
def health():
    missing = [k for k in ("JWT_SECRET", "DATABASE_URL", "RESEND_API_KEY") if not os.getenv(k)]
    if missing:
        import logging
        logging.getLogger("bizcontrol.health").warning("Missing env vars: %s", missing)
    return {"status": "ok", "missing_config": missing}
