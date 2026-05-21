"""
Audit: compares client.loyalty_points vs sum of ledger entries per client.
Flags clients where the balance doesn't match the ledger.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL לא מוגדר"); sys.exit(1)

engine = create_engine(DATABASE_URL)

from app.models.client import Client
from app.models.client_points_ledger import ClientPointsLedger

with Session(engine) as db:
    clients = list(db.scalars(select(Client).where(Client.loyalty_points != 0)))

    print(f"{'שם לקוח':<25} {'balance':>10} {'ledger sum':>12} {'הפרש':>8}")
    print("-" * 60)

    total_diff = 0
    for client in clients:
        ledger_sum = db.scalar(
            select(func.coalesce(func.sum(ClientPointsLedger.delta_points), 0))
            .where(ClientPointsLedger.client_id == client.id)
        ) or 0

        diff = int(client.loyalty_points) - int(ledger_sum)
        total_diff += diff

        flag = "  ⚠️ " if diff != 0 else ""
        print(f"{client.full_name:<25} {client.loyalty_points:>10} {ledger_sum:>12} {diff:>+8}{flag}")

    print("-" * 60)
    label = 'סה"כ הפרש:'
    print(f"{label:<25} {total_diff:>+8}")

    if total_diff == 0:
        print("\n✅ הכל מאוזן — balance = ledger בכל הלקוחות")
    else:
        print(f"\n⚠️  יש פער של {total_diff} נקודות בין ה-balance לבין הלדג'ר")
