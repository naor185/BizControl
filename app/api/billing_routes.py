"""
Billing — checkout, webhooks, customer portal.

Stripe is a payment provider, not the source of truth: every route here
resolves state through app/core/billing.py's apply_subscription_event()
and PaymentProvider abstraction. Studio.subscription_plan/is_active/
plan_expires_at/stripe_customer_id/stripe_subscription_id are still
dual-written for backward compat with other code that reads them for
display (deprecated, not deleted) — app/models/subscription.py's
Subscription.status is what plan_enforcement.py actually gates on.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import select
from pydantic import BaseModel

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.billing import apply_subscription_event, get_payment_provider
from app.models.studio import Studio
from app.models.subscription import Subscription
from app.models.module import Plan

router = APIRouter(prefix="/billing", tags=["Billing"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app")

PLAN_DAYS_FALLBACK = 31  # used only if a plan row is somehow missing billing_period_days


class CheckoutIn(BaseModel):
    plan: str  # starter | pro | studio


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
def billing_status(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    studio = db.get(Studio, ctx.studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    sub = db.scalar(select(Subscription).where(Subscription.studio_id == ctx.studio_id))
    return {
        "plan": studio.subscription_plan,
        "is_active": studio.is_active,
        "plan_expires_at": studio.plan_expires_at.isoformat() if studio.plan_expires_at else None,
        "stripe_customer_id": studio.stripe_customer_id,
        "stripe_subscription_id": studio.stripe_subscription_id,
        "has_active_subscription": bool(studio.stripe_subscription_id),
        # Source of truth going forward — see app/models/subscription.py
        "subscription_status": sub.status if sub else None,
        "current_period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
        "trial_ends_at": sub.trial_ends_at.isoformat() if sub and sub.trial_ends_at else None,
        "cancel_at_period_end": sub.cancel_at_period_end if sub else False,
    }


# ── Checkout ──────────────────────────────────────────────────────────────────

@router.post("/checkout")
def create_checkout(
    payload: CheckoutIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    plan = db.get(Plan, payload.plan)
    if not plan or not plan.stripe_price_id:
        raise HTTPException(status_code=400, detail=f"Unknown plan or price not configured: {payload.plan}")

    studio = db.get(Studio, ctx.studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")

    provider = get_payment_provider()  # single provider today, see PaymentProvider

    # If already has a subscription → send to the portal instead of a second checkout
    if studio.stripe_subscription_id:
        url = provider.create_portal_session(studio, return_url=f"{FRONTEND_URL}/billing")
        return {"url": url, "mode": "portal"}

    try:
        url = provider.create_checkout(
            studio, plan,
            success_url=f"{FRONTEND_URL}/billing?success=1&plan={payload.plan}",
            cancel_url=f"{FRONTEND_URL}/billing?canceled=1",
        )
    finally:
        db.commit()  # provider.create_checkout may have set studio.stripe_customer_id
    return {"url": url, "mode": "checkout"}


# ── Customer Portal ───────────────────────────────────────────────────────────

@router.post("/portal")
def customer_portal(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    studio = db.get(Studio, ctx.studio_id)
    if not studio or not studio.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No billing account found")

    url = get_payment_provider().create_portal_session(studio, return_url=f"{FRONTEND_URL}/billing")
    return {"url": url}


# ── Webhook ───────────────────────────────────────────────────────────────────

@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    if WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(payload, sig, WEBHOOK_SECRET)
        except stripe.errors.SignatureVerificationError:
            return JSONResponse(status_code=400, content={"detail": "Invalid signature"})
    else:
        import json
        event = json.loads(payload)

    event_type = event["type"]
    event_id = event.get("id")
    data = event["data"]["object"]

    # ── Payment succeeded (new subscription or renewal) ──────────────────────
    if event_type == "checkout.session.completed":
        studio_id = data.get("metadata", {}).get("studio_id")
        plan_id = data.get("metadata", {}).get("plan", "starter")
        sub_id = data.get("subscription")
        customer_id = data.get("customer")
        _sync_period(db, studio_id, "activated", plan_id, sub_id, customer_id, event_id)

    elif event_type == "invoice.paid":
        sub_id = data.get("subscription")
        if sub_id:
            stripe_sub = stripe.Subscription.retrieve(sub_id)
            studio_id = stripe_sub.get("metadata", {}).get("studio_id")
            plan_id = stripe_sub.get("metadata", {}).get("plan", "starter")
            customer_id = stripe_sub.get("customer")
            _sync_period(db, studio_id, "renewed", plan_id, sub_id, customer_id, event_id)

    # ── Renewal payment failed — was previously not handled at all, meaning a
    # declined card produced no warning and no distinct state until the old
    # period simply expired and the studio got blanket-blocked ──────────────
    elif event_type == "invoice.payment_failed":
        sub_id = data.get("subscription")
        if sub_id:
            stripe_sub = stripe.Subscription.retrieve(sub_id)
            studio_id = stripe_sub.get("metadata", {}).get("studio_id")
            if studio_id:
                apply_subscription_event(
                    db, studio_id, "payment_failed", source="webhook",
                    provider_event_id=event_id, metadata={"stripe_subscription_id": sub_id},
                )

    # ── Subscription canceled/paused — was previously not reflected in
    # is_active at all, only stripe_subscription_id got cleared ─────────────
    elif event_type in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub_id = data.get("id")
        studio_id = data.get("metadata", {}).get("studio_id")
        if studio_id:
            studio = db.get(Studio, studio_id)
            if studio and studio.stripe_subscription_id == sub_id:
                event_name = "canceled" if event_type == "customer.subscription.deleted" else "suspended"
                apply_subscription_event(
                    db, studio_id, event_name, source="webhook",
                    provider_event_id=event_id, metadata={"stripe_subscription_id": sub_id},
                )
                studio.stripe_subscription_id = None
                if event_name == "canceled":
                    studio.is_active = False
                db.commit()

    return {"received": True}


def _sync_period(db: Session, studio_id: str | None, event_type: str, plan_id: str,
                  sub_id: str | None, customer_id: str | None, event_id: str | None) -> None:
    """checkout.session.completed / invoice.paid both mean 'this studio just
    paid for a period' — activate/extend via apply_subscription_event(), and
    dual-write the legacy Studio columns for other code that still reads
    them directly (display-only reads; enforcement no longer does)."""
    if not studio_id:
        return
    studio = db.get(Studio, studio_id)
    if not studio:
        return

    plan = db.get(Plan, plan_id)
    period_days = (plan.billing_period_days if plan else None) or PLAN_DAYS_FALLBACK
    now = datetime.now(timezone.utc)
    period_start = now
    period_end = now + timedelta(days=period_days)

    apply_subscription_event(
        db, studio_id, event_type, source="webhook",
        plan_id=plan_id, current_period_start=period_start, current_period_end=period_end,
        provider_customer_id=customer_id, provider_subscription_id=sub_id,
        cancel_at_period_end=False, provider_event_id=event_id,
    )

    # Legacy dual-write (deprecated fields, kept for other readers)
    studio.subscription_plan = plan_id
    studio.is_active = True
    if sub_id:
        studio.stripe_subscription_id = sub_id
    if customer_id:
        studio.stripe_customer_id = customer_id
    studio.plan_expires_at = period_end
    db.commit()
