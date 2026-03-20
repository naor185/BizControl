from celery import Celery

celery = Celery(
    "bizcontrol",
    broker="redis://localhost:6379",
    backend="redis://localhost:6379"
)
