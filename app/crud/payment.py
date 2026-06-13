from __future__ import annotations
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models.payment import Payment
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.lead import Lead

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
        # Ensure client is marked as club member when they have/use points
        if not client.is_club_member:
            client.is_club_member = True

    # Validate and apply birthday coupon discount
    applied_coupon = None
    coupon_code = getattr(data, "coupon_code", None)
    if coupon_code:
        from app.crud.birthday_coupon import validate_coupon
        applied_coupon = validate_coupon(db, studio_id, data.client_id, coupon_code)
        if applied_coupon is None:
            raise ValueError("קוד קופון לא תקין, כבר נוצל, או פג תוקפו")
        # Apply discount to amount_cents
        discount_factor = 1.0 - (applied_coupon.discount_percent / 100.0)
        discounted_cents = int(data.amount_cents * discount_factor)
        amount_cents = discounted_cents
    else:
        amount_cents = int(data.amount_cents)

    # Reduce cash amount by points redeemed (staff enters total price; points cover part of it)
    if data.points_redeemed > 0:
        amount_cents = max(0, amount_cents - data.points_redeemed * 100)

    obj = Payment(
        studio_id=studio_id,
        appointment_id=data.appointment_id,
        client_id=data.client_id,
        amount_cents=amount_cents,
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

    # Mark coupon as redeemed after payment is committed
    if applied_coupon is not None:
        from app.crud.birthday_coupon import apply_coupon
        apply_coupon(db, applied_coupon, payment_id=obj.id, appointment_id=data.appointment_id)
        db.commit()

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
    points_earned = 0
    if obj.status == "paid" and obj.type in ("payment", "deposit"):
        from app.models.studio_settings import StudioSettings
        from app.models.client_points_ledger import ClientPointsLedger
        from app.models.message_job import MessageJob
        from datetime import datetime, timezone

        settings = db.get(StudioSettings, studio_id)
        if settings and settings.points_percent_per_payment is not None and settings.points_percent_per_payment > 0 and client.is_club_member:
            amount_ils = obj.amount_cents / 100.0
            from app.crud.membership_tier import get_client_tier
            tier = get_client_tier(db, studio_id, client.id)
            multiplier = tier.points_multiplier if tier else 1.0
            points_earned = int(amount_ils * (settings.points_percent_per_payment / 100.0) * multiplier)

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

    # Fire automation rules for payment_received
    if obj.status == "paid" and obj.type == "payment":
        try:
            from app.services.automation_engine import fire_event as _fire
            _fire(db, studio_id, "payment_received", {
                "client_name": client.full_name,
                "client_phone": client.phone or "",
                "service_name": appt.title or "",
                "service_id": str(appt.service_id) if getattr(appt, "service_id", None) else "",
                "amount": str(obj.amount_cents // 100),
                "appointment_date": appt.starts_at.strftime("%d/%m/%Y") if appt.starts_at else "",
            }, appointment_id=appt.id, client_id=client.id)
        except Exception:
            import logging as _l; _l.getLogger(__name__).exception("Automation engine error for payment_received")

    # Auto-mark appointment as done when final payment received
    if obj.status == "paid" and obj.type == "payment" and appt.status == "scheduled":
        appt.status = "done"
        db.commit()

    # Club invitation for non-members — fires after payment (main trigger)
    if obj.status == "paid" and obj.type == "payment":
        try:
            from app.crud.automation import maybe_enqueue_club_invite
            maybe_enqueue_club_invite(db, studio_id, client, appointment_id=appt.id)
        except Exception:
            import logging as _l
            _l.getLogger(__name__).exception("club invite error after payment %s", obj.id)

    # Send thank-you message after final payment (always — not just when content configured)
    if obj.status == "paid" and obj.type == "payment" and client.phone:
        try:
            from app.crud.automation import enqueue_post_payment_message
            enqueue_post_payment_message(db, appt, obj.amount_cents, points_earned=points_earned)
        except Exception:
            import logging as _log
            _log.getLogger(__name__).exception("Failed to enqueue post-payment message for appointment %s", appt.id)

    # Attribution revenue tracking — best effort, non-blocking
    if obj.status == "paid" and obj.type in ("payment", "deposit") and obj.amount_cents > 0:
        try:
            from app.services.lead_attribution_service import record_revenue
            lead = None
            if client.phone:
                clean = client.phone.replace("+", "").replace(" ", "").replace("-", "")
                lead = db.scalar(
                    select(Lead).where(
                        Lead.studio_id == studio_id,
                        Lead.phone.in_([client.phone, f"+{clean}", clean]),
                        Lead.status == "booked",
                    )
                )
            if lead and record_revenue(db, lead.id, obj.amount_cents):
                db.commit()
        except Exception:
            pass

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

    # Auto-create invoice/receipt for paid transactions (best-effort, non-blocking)
    if obj.status == "paid" and obj.type in ("payment", "deposit"):
        try:
            _auto_create_invoice(db, studio_id, obj, appt, client)
        except Exception:
            import logging as _log
            _log.getLogger(__name__).exception("Auto-invoice failed for payment %s", obj.id)

    return obj

def _auto_create_invoice(db: Session, studio_id: UUID, payment: Payment, appt, client) -> None:
    """Create an invoice/receipt automatically when a payment is recorded."""
    import uuid as _uuid
    from sqlalchemy import text

    # Get invoice settings
    settings_row = db.execute(
        text("SELECT * FROM invoice_settings WHERE studio_id = :sid"),
        {"sid": str(studio_id)},
    ).fetchone()
    settings = dict(settings_row._mapping) if settings_row else {}
    biz_type = settings.get("business_type", "osek_patur")

    studio_row = db.execute(
        text("SELECT name, logo_url FROM studios WHERE id = :sid"),
        {"sid": str(studio_id)},
    ).fetchone()
    studio_name = studio_row[0] if studio_row else ""
    studio_logo = studio_row[1] if studio_row else None

    # osek_patur → receipt; murshe/chevra_baam → invoice_tax_receipt
    doc_type = "receipt" if biz_type == "osek_patur" else "invoice_tax_receipt"

    # Atomic serial number
    result = db.execute(
        text("""
            INSERT INTO invoice_series (studio_id, doc_type, next_number)
            VALUES (:sid, :dt, 1001)
            ON CONFLICT (studio_id, doc_type)
            DO UPDATE SET next_number = invoice_series.next_number + 1
            RETURNING next_number - 1
        """),
        {"sid": str(studio_id), "dt": doc_type},
    ).fetchone()
    db.commit()
    doc_number = result[0]

    # VAT calculation: payment amount is treated as total (VAT-inclusive for murshe)
    vat_rate = float(settings.get("vat_rate") or 18.0)
    if biz_type == "osek_patur":
        subtotal_cents = payment.amount_cents
        vat_amount_cents = 0
        total_cents = payment.amount_cents
    else:
        # Price is VAT-inclusive → extract net
        subtotal_cents = int(round(payment.amount_cents / (1 + vat_rate / 100)))
        vat_amount_cents = payment.amount_cents - subtotal_cents
        total_cents = payment.amount_cents

    invoice_id = str(_uuid.uuid4())
    description = getattr(appt, "title", None) or "שירות"

    db.execute(
        text("""
            INSERT INTO invoices (
                id, studio_id, doc_type, doc_number, status,
                client_id, client_name, client_phone,
                business_name, business_type, business_number,
                business_address, business_city, business_phone, business_email, business_logo_url,
                subtotal_cents, vat_rate, vat_amount_cents, total_cents, tip_cents,
                payment_method, source, source_id,
                issued_by_id, issued_at
            ) VALUES (
                :id, :sid, :dt, :dn, 'issued',
                :cid, :cname, :cphone,
                :bname, :btype, :bnum,
                :baddr, :bcity, :bphone, :bemail, :blogo,
                :sub, :vr, :vat, :total, 0,
                :method, 'payment', :src_id,
                NULL, NOW()
            )
        """),
        {
            "id": invoice_id, "sid": str(studio_id), "dt": doc_type, "dn": doc_number,
            "cid": str(client.id), "cname": client.full_name, "cphone": client.phone,
            "bname": settings.get("business_name") or studio_name,
            "btype": biz_type,
            "bnum": settings.get("business_number"),
            "baddr": settings.get("business_address"),
            "bcity": settings.get("business_city"),
            "bphone": settings.get("business_phone"),
            "bemail": settings.get("business_email"),
            "blogo": settings.get("logo_url") or studio_logo,
            "sub": subtotal_cents, "vr": vat_rate, "vat": vat_amount_cents, "total": total_cents,
            "method": payment.method,
            "src_id": str(payment.id),
        },
    )

    db.execute(
        text("""
            INSERT INTO invoice_items
                (id, invoice_id, description, quantity, unit_price_cents, total_price_cents, sort_order)
            VALUES (:id, :inv, :desc, 1, :up, :tp, 0)
        """),
        {
            "id": str(_uuid.uuid4()), "inv": invoice_id,
            "desc": description,
            "up": subtotal_cents, "tp": subtotal_cents,
        },
    )
    db.commit()


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
def delete_all_client_payments(db: Session, studio_id: UUID, client_id: UUID) -> int:
    from app.models.client_points_ledger import ClientPointsLedger
    payments = list(db.scalars(
        select(Payment).where(Payment.studio_id == studio_id, Payment.client_id == client_id)
    ).all())
    count = 0
    for p in payments:
        # revert cashback ledger entries for each payment
        ledger_entries = list(db.scalars(
            select(ClientPointsLedger).where(
                ClientPointsLedger.studio_id == studio_id,
                ClientPointsLedger.client_id == client_id,
                ClientPointsLedger.reason.ilike(f"%Cashback for payment {p.id}%")
            )
        ).all())
        for entry in ledger_entries:
            db.delete(entry)
        db.delete(p)
        count += 1
    # reset client loyalty points to 0
    client = db.scalar(select(Client).where(Client.id == client_id, Client.studio_id == studio_id))
    if client:
        client.loyalty_points = 0
    # delete all ledger entries for this client
    all_ledger = list(db.scalars(
        select(ClientPointsLedger).where(
            ClientPointsLedger.studio_id == studio_id,
            ClientPointsLedger.client_id == client_id,
        )
    ).all())
    for entry in all_ledger:
        db.delete(entry)
    db.commit()
    return count


def _cascade_delete_linked_invoices(db: Session, payment_id: UUID) -> None:
    """Delete all invoices (+ credit notes) linked to this payment. invoice_items cascade via FK."""
    from sqlalchemy import text
    pid = str(payment_id)

    to_delete: set[str] = set()

    direct = db.execute(
        text("SELECT id, credited_by_id FROM invoices WHERE source_id = :pid"),
        {"pid": pid},
    ).fetchall()
    for row in direct:
        to_delete.add(str(row[0]))
        if row[1]:
            to_delete.add(str(row[1]))

    for inv_id in list(to_delete):
        credits = db.execute(
            text("SELECT id FROM invoices WHERE credits_invoice_id = :iid"),
            {"iid": inv_id},
        ).fetchall()
        for r in credits:
            to_delete.add(str(r[0]))

    for inv_id in to_delete:
        db.execute(text("DELETE FROM invoices WHERE id = :id"), {"id": inv_id})


def delete_payment(db: Session, studio_id: UUID, payment_id: UUID, with_appointment: bool = False) -> bool:
    from app.models.client_points_ledger import ClientPointsLedger

    obj = db.scalar(select(Payment).where(Payment.id == payment_id, Payment.studio_id == studio_id))
    if not obj:
        return False

    # 1. Find and revert cashback entries — handle two historical formats:
    #    New format: "Cashback for payment {payment_uuid}"
    #    Old format: "cashback X% on payment ₪..." (linked only by appointment_id)
    seen_ids: set = set()
    cashback_entries: list = []

    # New format — by payment UUID in reason
    for e in db.scalars(
        select(ClientPointsLedger).where(
            ClientPointsLedger.studio_id == studio_id,
            ClientPointsLedger.client_id == obj.client_id,
            ClientPointsLedger.reason.ilike(f"%{obj.id}%"),
            ClientPointsLedger.delta_points > 0,
        )
    ).all():
        if e.id not in seen_ids:
            seen_ids.add(e.id)
            cashback_entries.append(e)

    # Old format — any positive cashback entry on this appointment
    if obj.appointment_id:
        for e in db.scalars(
            select(ClientPointsLedger).where(
                ClientPointsLedger.studio_id == studio_id,
                ClientPointsLedger.client_id == obj.client_id,
                ClientPointsLedger.appointment_id == obj.appointment_id,
                ClientPointsLedger.reason.ilike("%cashback%"),
                ClientPointsLedger.delta_points > 0,
            )
        ).all():
            if e.id not in seen_ids:
                seen_ids.add(e.id)
                cashback_entries.append(e)

    client = db.get(Client, obj.client_id)

    if cashback_entries and client:
        total_points_to_revert = sum(e.delta_points for e in cashback_entries)
        client.loyalty_points = max(0, int(client.loyalty_points or 0) - total_points_to_revert)
        for e in cashback_entries:
            db.delete(e)

    # 2. Restore redeemed points — find negative ledger entries for this appointment
    if obj.appointment_id:
        redeemed_entries = list(db.scalars(
            select(ClientPointsLedger).where(
                ClientPointsLedger.studio_id == studio_id,
                ClientPointsLedger.client_id == obj.client_id,
                ClientPointsLedger.appointment_id == obj.appointment_id,
                ClientPointsLedger.reason.ilike("%redeemed%"),
                ClientPointsLedger.delta_points < 0,
            )
        ).all())
        if redeemed_entries and client:
            total_to_restore = sum(abs(e.delta_points) for e in redeemed_entries)
            client.loyalty_points = int(client.loyalty_points or 0) + total_to_restore
            for e in redeemed_entries:
                db.delete(e)

        # Also delete the shadow "points payment" record created during create_payment
        shadow = db.scalar(
            select(Payment).where(
                Payment.studio_id == studio_id,
                Payment.appointment_id == obj.appointment_id,
                Payment.client_id == obj.client_id,
                Payment.notes.ilike("%מימש%"),
                Payment.id != obj.id,
            )
        )
        if shadow:
            db.delete(shadow)

    # 3. Restore birthday coupon if this payment had one applied
    from app.crud.birthday_coupon import restore_coupon
    restore_coupon(db, payment_id)

    # 4. Cascade-delete linked invoices/credit-notes (invoice_items cascade via FK)
    _cascade_delete_linked_invoices(db, payment_id)

    # 5. Delete the payment itself
    appt_id = obj.appointment_id
    db.delete(obj)

    # 5. Optionally delete the associated appointment
    if with_appointment and appt_id:
        appt = db.scalar(select(Appointment).where(Appointment.id == appt_id, Appointment.studio_id == studio_id))
        if appt:
            # delete remaining payments on this appointment first
            other_payments = list(db.scalars(select(Payment).where(Payment.appointment_id == appt_id)).all())
            for p in other_payments:
                db.delete(p)
            db.delete(appt)

    db.commit()
    return True
