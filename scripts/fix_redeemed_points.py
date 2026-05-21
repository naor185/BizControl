"""
One-time script: fix stale "redeemed points" ledger entries
whose main payment was deleted (bug before the fix).

What it does:
1. Finds all negative ledger entries (redeemed points) with no surviving main payment
2. Restores the points to the client
3. Deletes the stale ledger entry
4. Deletes the orphaned shadow payment record (notes containing "מימש")
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, select, or_, not_
from sqlalchemy.orm import Session

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL לא מוגדר ב-.env")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

from app.models.client_points_ledger import ClientPointsLedger
from app.models.payment import Payment
from app.models.client import Client

with Session(engine) as db:
    # Find all negative (redeemed) ledger entries
    redeemed_entries = list(db.scalars(
        select(ClientPointsLedger).where(
            ClientPointsLedger.delta_points < 0,
            ClientPointsLedger.reason.ilike("%redeemed%"),
        )
    ).all())

    print(f"נמצאו {len(redeemed_entries)} רשומות מימוש נקודות בסה\"כ")

    if not redeemed_entries:
        print("אין מה לתקן — הכל תקין ✅")
        sys.exit(0)

    fixed_clients = 0
    fixed_entries = 0
    fixed_shadows = 0

    for entry in redeemed_entries:
        if entry.appointment_id is None:
            continue

        # Check if a real (non-shadow) payment still exists for this appointment + client
        real_payment = db.scalar(
            select(Payment).where(
                Payment.appointment_id == entry.appointment_id,
                Payment.client_id == entry.client_id,
                or_(
                    Payment.notes == None,
                    not_(Payment.notes.ilike("%מימש%")),
                ),
            )
        )

        if real_payment is not None:
            # Main payment still alive — ledger entry is valid, skip
            continue

        # Main payment was deleted — this entry is orphaned
        points_to_restore = abs(entry.delta_points)
        client = db.get(Client, entry.client_id)

        print(f"  ✦ לקוח {entry.client_id}: מחזיר {points_to_restore} נקודות | מוחק רשומת מימוש")

        if client:
            client.loyalty_points = int(client.loyalty_points or 0) + points_to_restore
            fixed_clients += 1

        db.delete(entry)
        fixed_entries += 1

        # Delete the orphaned shadow payment ("מימש") for this appointment
        shadow = db.scalar(
            select(Payment).where(
                Payment.appointment_id == entry.appointment_id,
                Payment.client_id == entry.client_id,
                Payment.notes.ilike("%מימש%"),
            )
        )
        if shadow:
            print(f"    → מוחק תשלום צל: {shadow.id}")
            db.delete(shadow)
            fixed_shadows += 1

    db.commit()

    print()
    print("=" * 40)
    print("סיום ✅")
    print(f"  לקוחות שתוקנו:        {fixed_clients}")
    print(f"  רשומות ledger שנמחקו:  {fixed_entries}")
    print(f"  תשלומי צל שנמחקו:     {fixed_shadows}")
