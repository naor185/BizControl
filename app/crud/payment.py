from __future__ import annotations
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models.payment import Payment
from app.models.appointment import Appointment
from app.models.client import Client

def create_payment(db: Session, studio_id: UUID, data) -> Payment:
    # ensure appointment belongs to studio
    appt = db.scalar(select(Appointment).where(Appointment.id == data.appointment_id, Appointment.studio_id == studio_id))
    if appt is None:
        raise ValueError("Appointment not found")

    client = db.scalar(select(Client).where(Client.id == data.client_id, Client.studio_id == studio_id))
    if client is None:
        raise ValueError("Client not found")

    if data.points_redeemed > 0:
        if (client.loyalty_points or 0) < data.points_redeemed:
            raise ValueError(f"Not enough points. Client has {client.loyalty_points or 0} points.")
        client.loyalty_points = (client.loyalty_points or 0) - data.points_redeemed

    obj = Payment(
        studio_id=studio_id,
        appointment_id=data.appointment_id,
        client_id=data.client_id,
        amount_cents=int(data.amount_cents),
        currency=data.currency.upper(),
        type=data.type,
        status=data.status,
        method=data.method,
        external_ref=data.external_ref,
        notes=data.notes,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    # Secondary record representing the payment via points (for balancing the appointment bill, not hitting cash reports)
    if data.points_redeemed > 0:
        from app.models.client_points_ledger import ClientPointsLedger
        # Deduct points ledger
        db.add(ClientPointsLedger(
            studio_id=studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            delta_points=-data.points_redeemed,
            reason=f"Points redeemed for payment on appointment {appt.id}"
        ))
        # Points payment record (1 point = 1 ILS)
        points_val_cents = data.points_redeemed * 100
        points_payment = Payment(
            studio_id=studio_id,
            appointment_id=data.appointment_id,
            client_id=data.client_id,
            amount_cents=points_val_cents,
            currency=data.currency.upper(),
            type="payment",
            status="paid",
            method="other",
            notes=f"[מערכת] הלקוח מימש {data.points_redeemed} ש״ח באמצעות נקודות מועדון",
        )
        db.add(points_payment)
        db.commit()

    # Award Cashback if the payment is "paid" and represents positive revenue
    if obj.status == "paid" and obj.type in ("payment", "deposit"):
        from app.models.studio_settings import StudioSettings
        from app.models.client_points_ledger import ClientPointsLedger
        from app.models.message_job import MessageJob
        from datetime import datetime, timezone

        settings = db.get(StudioSettings, studio_id)
        if settings and settings.points_percent_per_payment is not None and settings.points_percent_per_payment > 0:
            # Calculate points = (amount in cents / 100) * (percent / 100)
            amount_ils = obj.amount_cents / 100.0
            points_earned = int(amount_ils * (settings.points_percent_per_payment / 100.0))
            
            if points_earned > 0:
                client.loyalty_points = int(client.loyalty_points or 0) + points_earned
                db.add(ClientPointsLedger(
                    studio_id=studio_id,
                    client_id=client.id,
                    appointment_id=appt.id,
                    delta_points=points_earned,
                    reason=f"Cashback for payment {obj.id}"
                ))
                db.commit()

                from app.crud.automation import enqueue_post_payment_message
                enqueue_post_payment_message(db, appt, obj.amount_cents)
                
                # Check if we should queue an email notification regarding the earned points
                if client.email and settings.smtp_host and settings.smtp_user and settings.smtp_pass:
                    html_content = f"""
                    <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2 style="color: #333;">תודה על התשלום! 🎉</h2>
                        <p>שלום {client.full_name},</p>
                        <p>זוהי הודעה אוטומטית לעדכן אותך שהתקבל תשלום לאחרונה, וצברת על כך <strong style="color: #10b981;">{points_earned} נקודות קאשבק!</strong></p>
                        <p><strong>סה״כ היתרה שלך עומדת כעת על: {client.loyalty_points} נקודות.</strong></p>
                        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
                        <p style="font-size: 12px; color: #888;">הודעה זו נשלחה אוטומטית ממערכת BizControl.</p>
                    </div>
                    """
                    db.add(MessageJob(
                        studio_id=studio_id,
                        client_id=client.id,
                        appointment_id=appt.id,
                        channel="email",
                        to_phone=client.email, # using to_phone field to store the destination (email)
                        body=html_content,
                        scheduled_at=datetime.now(timezone.utc),
                        status="pending",
                        attempts=0,
                    ))
                    db.commit()

    # Record product sales if any
    if hasattr(data, 'product_items') and data.product_items:
        from app.models.product import Product
        from app.models.product_sale import ProductSale

        for item in data.product_items:
            product = db.get(Product, item.product_id)
            if not product or product.studio_id != studio_id:
                continue
            
            # Record sale
            unit_price_cents = item.price_cents if item.price_cents is not None else int(product.price * 100)
            total_item_price_cents = unit_price_cents * item.quantity
            
            sale = ProductSale(
                studio_id=studio_id,
                product_id=product.id,
                payment_id=obj.id,
                user_id=appt.artist_id, # Assuming the artist of the appointment gets the credit
                quantity=item.quantity,
                unit_price_cents=unit_price_cents,
                total_price_cents=total_item_price_cents
            )
            db.add(sale)
            
            # Decrement stock
            product.stock_quantity = (product.stock_quantity or 0) - item.quantity
        
        db.commit()

    return obj

def list_payments(db: Session, studio_id: UUID, appointment_id: UUID | None = None, client_id: UUID | None = None) -> list[Payment]:
    stmt = select(Payment).where(Payment.studio_id == studio_id)
    if appointment_id:
        stmt = stmt.where(Payment.appointment_id == appointment_id)
    if client_id:
        stmt = stmt.where(Payment.client_id == client_id)
    stmt = stmt.order_by(Payment.created_at.desc())
    return list(db.scalars(stmt).all())

def appointment_balance(db: Session, studio_id: UUID, appointment_id: UUID):
    # ensure appointment exists & belongs to studio
    appt = db.scalar(select(Appointment).where(Appointment.id == appointment_id, Appointment.studio_id == studio_id))
    if appt is None:
        return None

    paid = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0))
        .where(
            Payment.studio_id == studio_id,
            Payment.appointment_id == appointment_id,
            Payment.status == "paid",
            Payment.type.in_(["deposit", "payment"]),
        )
    )
    refund = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0))
        .where(
            Payment.studio_id == studio_id,
            Payment.appointment_id == appointment_id,
            Payment.status == "paid",
            Payment.type == "refund",
        )
    )

    paid = int(paid or 0)
    refund = int(refund or 0)
    return {
        "appointment_id": appointment_id,
        "currency": "ILS",
        "total_paid_cents": paid,
        "total_refund_cents": refund,
        "net_paid_cents": paid - refund,
    }
def delete_payment(db: Session, studio_id: UUID, payment_id: UUID) -> bool:
    from app.models.client_points_ledger import ClientPointsLedger
    
    obj = db.scalar(select(Payment).where(Payment.id == payment_id, Payment.studio_id == studio_id))
    if not obj:
        return False
    
    # 1. Find and revert cashback if applicable
    # We look for ledger entries associated with this specific payment
    ledger_entries = db.scalars(
        select(ClientPointsLedger).where(
            ClientPointsLedger.studio_id == studio_id,
            ClientPointsLedger.client_id == obj.client_id,
            ClientPointsLedger.reason.ilike(f"%Cashback for payment {obj.id}%")
        )
    ).all()
    
    if ledger_entries:
        client = db.get(Client, obj.client_id)
        if client:
            total_points_to_revert = sum(entry.delta_points for entry in ledger_entries)
            client.loyalty_points = int(client.loyalty_points or 0) - total_points_to_revert
            
            # Delete those ledger entries
            for entry in ledger_entries:
                db.delete(entry)
    
    # 2. Delete the payment itself
    db.delete(obj)
    db.commit()
    return True
