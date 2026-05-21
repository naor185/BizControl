"""
Diagnostic + fix: finds cashback ledger entries whose payment was deleted.
Prints a report, then asks for confirmation before fixing.
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, select, or_
from sqlalchemy.orm import Session

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL לא מוגדר"); sys.exit(1)

engine = create_engine(DATABASE_URL)

from app.models.client_points_ledger import ClientPointsLedger
from app.models.payment import Payment
from app.models.client import Client

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

with Session(engine) as db:
    # כל רשומות קאשבק חיוביות
    cashback_entries = list(db.scalars(
        select(ClientPointsLedger).where(
            ClientPointsLedger.delta_points > 0,
            or_(
                ClientPointsLedger.reason.ilike("%cashback%"),
                ClientPointsLedger.reason.ilike("%Cashback%"),
            )
        )
    ).all())

    print(f"סה\"כ רשומות קאשבק בלדג'ר: {len(cashback_entries)}\n")

    orphaned = []

    for entry in cashback_entries:
        # חלץ UUID של תשלום מה-reason
        match = UUID_RE.search(entry.reason or "")
        if not match:
            continue
        payment_id = match.group(0)
        payment = db.get(Payment, payment_id)
        if payment is None:
            client = db.get(Client, entry.client_id)
            orphaned.append({
                "entry": entry,
                "payment_id": payment_id,
                "client_name": client.full_name if client else "?",
            })

    if not orphaned:
        print("✅ לא נמצאו רשומות קאשבק עזובות — הכל תקין!")
        sys.exit(0)

    print(f"נמצאו {len(orphaned)} רשומות קאשבק עזובות (תשלום נמחק אבל נקודות נשארו):\n")
    total_ghost = 0
    for o in orphaned:
        e = o["entry"]
        print(f"  לקוח: {o['client_name']}")
        print(f"  נקודות: +{e.delta_points}")
        print(f"  reason: {e.reason}")
        print(f"  תשלום {o['payment_id']} — לא קיים")
        print()
        total_ghost += e.delta_points

    print(f"סה\"כ נקודות עזובות: {total_ghost}")
    print()

    ans = input("לתקן? (כן/לא): ").strip().lower()
    if ans not in ("כן", "yes", "y", "k", "כ"):
        print("בוטל — לא בוצע שינוי"); sys.exit(0)

    for o in orphaned:
        e = o["entry"]
        client = db.get(Client, e.client_id)
        if client:
            client.loyalty_points = max(0, int(client.loyalty_points or 0) - e.delta_points)
            print(f"  הורדתי {e.delta_points} נקודות מ-{o['client_name']}")
        db.delete(e)

    db.commit()
    print(f"\n✅ תוקן — {len(orphaned)} רשומות נמחקו, {total_ghost} נקודות עזובות הוסרו")
