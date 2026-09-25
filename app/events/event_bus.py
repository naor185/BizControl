class EventBus:
    """In-process events. Every event carries its origin — "user" (someone did it in a screen), "system"
    (a scheduled job) or "migration" (an import). Handlers pass it on to
    app/services/notifications.notify, which never sends anything for a migration."""

    ORIGINS = ("user", "system", "migration")
    handlers = {}

    @classmethod
    def register(cls, event_name, handler):

        if event_name not in cls.handlers:
            cls.handlers[event_name] = []

        cls.handlers[event_name].append(handler)

    @classmethod
    def emit(cls, event_name, payload, origin="user"):
        if origin not in cls.ORIGINS:
            raise ValueError(f"unknown event origin: {origin}")

        if event_name not in cls.handlers:
            return

        for handler in cls.handlers[event_name]:
            handler({**payload, "origin": origin})
