class EventBus:

    handlers = {}

    @classmethod
    def register(cls, event_name, handler):

        if event_name not in cls.handlers:
            cls.handlers[event_name] = []

        cls.handlers[event_name].append(handler)

    @classmethod
    def emit(cls, event_name, payload):

        if event_name not in cls.handlers:
            return

        for handler in cls.handlers[event_name]:
            handler(payload)
