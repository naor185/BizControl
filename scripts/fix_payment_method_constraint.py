"""
Fix: drop old ck_payments_method constraint and recreate with all valid methods.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL לא מוגדר"); sys.exit(1)

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    conn.execute(text("ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_method"))
    conn.execute(text(
        "ALTER TABLE payments ADD CONSTRAINT ck_payments_method "
        "CHECK (method IN ('cash','bit','credit','credit_card','paypal','bank','bank_transfer','paybox','installment','other'))"
    ))
    conn.commit()
    print("✅ constraint עודכן בהצלחה — פייבוקס, אשראי והעברה בנקאית נתמכים עכשיו")
