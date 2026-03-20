from sqlalchemy import text
from app.db.session import SessionLocal
from app.events.event_bus import EventBus
import uuid
from datetime import datetime

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
            print(f"Error in automation: {e}")
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
        print(f"✅ Added {points_to_add} points for client {client_id}")

    @staticmethod
    def aftercare_message(db, data):
        # Placeholder for messaging logic
        print(f"📩 Sending aftercare message to {data.get('client_id')}")

    @staticmethod
    def ask_for_review(db, data):
        # Placeholder for review request logic
        print(f"⭐️ Asking for review from {data.get('client_id')}")
