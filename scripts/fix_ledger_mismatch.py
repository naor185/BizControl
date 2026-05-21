"""
Fix: for clients where loyalty_points < ledger sum,
find and delete orphaned positive ledger entries (payment was deleted but ledger entry remained).
Does NOT touch loyalty_points — the balance is already correct.
"""
import sys, os, re
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
from app.models.payment import Payment

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

with Session(engine) as db:
    clients = list(db.scalars(select(Client)))

    to_delete = []

    for client in clients:
        ledger_sum = db.scalar(
            select(func.coalesce(func.sum(ClientPointsLedger.delta_points), 0))
            .where(ClientPointsLedger.client_id == client.id)
        ) or 0

        diff = int(client.loyalty_points) - int(ledger_sum)
        if diff >= 0:
            continue  # balance >= ledger → no issue

        excess = abs(diff)
        print(f"\n⚠️  {client.full_name}: balance={client.loyalty_points}, ledger={ledger_sum}, עודף בלדג'ר={excess}")

        # מצא רשומות חיוביות ובדוק אם התשלום קיים
        pos_entries = list(db.scalars(
            select(ClientPointsLedger).where(
                ClientPointsLedger.client_id == client.id,
                ClientPointsLedger.delta_points > 0,
            ).order_by(ClientPointsLedger.created_at.asc())
        ).all())

        removed = 0
        for entry in pos_entries:
            if removed >= excess:
                break
            uuid_match = UUID_RE.search(entry.reason or "")
            if not uuid_match:
                # פורמט ישן ללא UUID — בדוק לפי סכום התשלום
                import re as _re
                amt_match = _re.search(r"[₪\$]?([\d,]+\.?\d*)", entry.reason or "")
                if amt_match:
                    amount_str = amt_match.group(1).replace(",", "")
                    try:
                        amount_cents = int(float(amount_str) * 100)
                        payment_exists = db.scalar(
                            select(Payment).where(
                                Payment.client_id == client.id,
                                Payment.amount_cents == amount_cents,
                                Payment.status == "paid",
                            )
                        )
                        if payment_exists:
                            print(f"  ↳ תשלום קיים (₪{amount_str}), דלג: {entry.reason}")
                            continue
                        print(f"  🗑  מוחק (פורמט ישן, תשלום לא קיים): +{entry.delta_points} pts | {entry.reason}")
                        to_delete.append(entry)
                        removed += entry.delta_points
                        continue
                    except ValueError:
                        pass
                print(f"  ↳ דלג (לא ניתן לאמת): {entry.reason}")
                continue
            payment_id = uuid_match.group(0)
            payment = db.get(Payment, payment_id)
            if payment is not None:
                print(f"  ↳ תשלום קיים, דלג: {entry.reason}")
                continue
            # תשלום לא קיים — רשומה עזובה
            print(f"  🗑  מוחק: +{entry.delta_points} pts | {entry.reason}")
            to_delete.append(entry)
            removed += entry.delta_points

    if not to_delete:
        print("\n✅ לא נמצאו רשומות לתיקון")
        sys.exit(0)

    print(f"\nסה\"כ רשומות למחיקה: {len(to_delete)}")
    if "--fix" not in sys.argv:
        print("הרץ שוב עם --fix כדי לבצע את התיקון")
        sys.exit(0)

    for entry in to_delete:
        db.delete(entry)
    db.commit()
    print("✅ תוקן בהצלחה")
