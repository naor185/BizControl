import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.background import BackgroundScheduler

from app.db.session import SessionLocal
from app.services.message_worker import process_due_jobs, sweep_upcoming_reminders
from app.api.router import api_router
from app.services.automation_service import AutomationService


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
        finally:
            db.close()

    scheduler.add_job(tick_jobs, "interval", seconds=20, id="message_jobs_tick", replace_existing=True)
    scheduler.add_job(tick_reminders, "interval", minutes=60, id="reminders_sweep_tick", replace_existing=True)
    scheduler.start()

def stop_scheduler():
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
    except Exception:
        pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    AutomationService.register() # Register event handlers
    os.makedirs("uploads", exist_ok=True)
    yield
    stop_scheduler()

app = FastAPI(title="BizControl", version="0.1.0", lifespan=lifespan)

# Mount uploads directory for static file serving
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")

@app.get("/health")
def health():
    return {"status": "ok"}
