import os
from app.main import app
import app.main as main_module

print(f"DEBUG: main.py file path: {main_module.__file__}")

for route in app.routes:
    if hasattr(route, "path"):
        methods = getattr(route, "methods", [])
        print(f"{list(methods)} {route.path}")
