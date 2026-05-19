from app.db.session import SessionLocal
from app.events.event_bus import EventBus
from app.utils.logger import get_logger

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
        # Points are awarded only via payment cashback (payment.py), not on appointment completion
        pass

    @staticmethod
    def aftercare_message(db, data):
        # Placeholder for messaging logic
        log.info("Aftercare message placeholder for client %s", data.get("client_id"))

    @staticmethod
    def ask_for_review(db, data):
        # Placeholder for review request logic
        log.info("Review request placeholder for client %s", data.get("client_id"))
