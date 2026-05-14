import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

logging.basicConfig(
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
)

_sentry_dsn = os.getenv("SENTRY_DSN", "")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=0.1,
        environment=os.getenv("ENVIRONMENT", "production"),
        send_default_pii=False,
    )
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.limiter import limiter
from apscheduler.schedulers.background import BackgroundScheduler

from app.db.session import SessionLocal
from app.services.message_worker import process_due_jobs, sweep_upcoming_reminders, sweep_7day_reminders, sweep_3day_reminders
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

    def tick_plan_alerts():
        db = SessionLocal()
        try:
            sweep_plan_expiry_alerts(db)
        finally:
            db.close()

    scheduler.add_job(tick_jobs, "interval", seconds=20, id="message_jobs_tick", replace_existing=True)
    scheduler.add_job(tick_reminders, "interval", minutes=60, id="reminders_sweep_tick", replace_existing=True)
    scheduler.add_job(tick_plan_alerts, "cron", hour=9, minute=0, id="plan_alerts_tick", replace_existing=True)
    scheduler.start()

def stop_scheduler():
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
    except Exception:
        pass

@asynccontextmanager
async def lifespan(_app: FastAPI):
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

_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
origins = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else ["*"]
)

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
