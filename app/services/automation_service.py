from sqlalchemy import text
from app.db.session import SessionLocal
from app.events.event_bus import EventBus
from app.utils.logger import get_logger
import uuid
from datetime import datetime

log = get_logger(__name__)

class AutomationService:

    @staticmethod
    def register():
        EventBus.register(
            "appointment.completed",
            AutomationService.handle_completion
        )

    @staticmethod
    def handle_completion(data):
        """Unified handler for all completion tasks"""
        db = SessionLocal()
        try:
            AutomationService.add_loyalty_points(db, data)
            AutomationService.aftercare_message(db, data)
            AutomationService.ask_for_review(db, data)
            db.commit()
        except Exception as e:
            db.rollback()
            log.exception("Error in automation handler: %s", e)
        finally:
            db.close()

    @staticmethod
    def add_loyalty_points(db, data):
        client_id = data.get("client_id")
        points_to_add = 10  # דוגמה: 10 נקודות על כל תור
        
        # 1. עדכון מאזן הנקודות (Client Points)
        db.execute(
            text("""
                INSERT INTO client_points (client_id, points_balance)
                VALUES (:client_id, :points)
                ON CONFLICT (client_id) DO UPDATE 
                SET points_balance = client_points.points_balance + :points
            """),
            {"client_id": client_id, "points": points_to_add}
        )

        # 2. תיעוד ב-Ledger
        db.execute(
            text("""
                INSERT INTO client_points_ledger (id, client_id, delta_points, reason, created_at)
                VALUES (:id, :client_id, :delta_points, :reason, :created_at)
            """),
            {
                "id": str(uuid.uuid4()),
                "client_id": client_id,
                "delta_points": points_to_add,
                "reason": f"נקודות עבור תור שהסתיים (Appt: {data.get('appointment_id')})",
                "created_at": datetime.now()
            }
        )
        log.info("Added %d points for client %s", points_to_add, client_id)

    @staticmethod
    def aftercare_message(db, data):
        # Placeholder for messaging logic
        log.info("Aftercare message placeholder for client %s", data.get("client_id"))

    @staticmethod
    def ask_for_review(db, data):
        # Placeholder for review request logic
        log.info("Review request placeholder for client %s", data.get("client_id"))
