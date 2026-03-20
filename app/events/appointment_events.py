from app.events.event_bus import EventBus


def appointment_completed(data):

    EventBus.emit(
        "appointment.completed",
        data
    )
