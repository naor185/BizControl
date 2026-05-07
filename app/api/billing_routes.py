"""
Stripe billing — checkout, webhooks, customer portal.
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
from app.models.studio import Studio
from app.models.user import User

router = APIRouter(prefix="/billing", tags=["Billing"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app")

# Stripe Price IDs — set these env vars in Railway
PRICE_IDS: dict[str, str] = {
    "starter": os.getenv("STRIPE_PRICE_STARTER", ""),
    "pro":     os.getenv("STRIPE_PRICE_PRO", ""),
    "studio":  os.getenv("STRIPE_PRICE_STUDIO", ""),
}

PLAN_NAMES = {
    "starter": "Starter",
    "pro":     "Pro",
    "studio":  "Studio",
}

PLAN_DAYS = 31  # days added per successful payment


class CheckoutIn(BaseModel):
    plan: str  # starter | pro | studio


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
def billing_status(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    studio = db.get(Studio, ctx.studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    return {
        "plan": studio.subscription_plan,
        "is_active": studio.is_active,
        "plan_expires_at": studio.plan_expires_at.isoformat() if studio.plan_expires_at else None,
        "stripe_customer_id": studio.stripe_customer_id,
        "stripe_subscription_id": studio.stripe_subscription_id,
        "has_active_subscription": bool(studio.stripe_subscription_id),
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

    price_id = PRICE_IDS.get(payload.plan)
    if not price_id:
        raise HTTPException(status_code=400, detail=f"Unknown plan or price not configured: {payload.plan}")

    studio = db.get(Studio, ctx.studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")

    owner = db.scalar(select(User).where(User.studio_id == ctx.studio_id, User.role == "owner"))

    # Create or reuse Stripe customer
    if studio.stripe_customer_id:
        customer_id = studio.stripe_customer_id
    else:
        customer = stripe.Customer.create(
            email=owner.email if owner else None,
            name=studio.name,
            metadata={"studio_id": str(studio.id), "slug": studio.slug},
        )
        studio.stripe_customer_id = customer.id
        db.commit()
        customer_id = customer.id

    # If already has a subscription → redirect to portal
    if studio.stripe_subscription_id:
        portal = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{FRONTEND_URL}/billing",
        )
        return {"url": portal.url, "mode": "portal"}

    # Create new checkout session
    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{FRONTEND_URL}/billing?success=1&plan={payload.plan}",
        cancel_url=f"{FRONTEND_URL}/billing?canceled=1",
        metadata={"studio_id": str(studio.id), "plan": payload.plan},
        subscription_data={"metadata": {"studio_id": str(studio.id), "plan": payload.plan}},
        allow_promotion_codes=True,
        locale="auto",
    )
    return {"url": session.url, "mode": "checkout"}


# ── Customer Portal ───────────────────────────────────────────────────────────

@router.post("/portal")
def customer_portal(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    studio = db.get(Studio, ctx.studio_id)
    if not studio or not studio.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No billing account found")

    session = stripe.billing_portal.Session.create(
        customer=studio.stripe_customer_id,
        return_url=f"{FRONTEND_URL}/billing",
    )
    return {"url": session.url}


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
    data = event["data"]["object"]

    # ── Payment succeeded (new subscription or renewal) ──────────────────────
    if event_type == "checkout.session.completed":
        studio_id = data.get("metadata", {}).get("studio_id")
        plan = data.get("metadata", {}).get("plan", "starter")
        sub_id = data.get("subscription")
        _activate_plan(db, studio_id, plan, sub_id)

    elif event_type == "invoice.paid":
        sub_id = data.get("subscription")
        if sub_id:
            sub = stripe.Subscription.retrieve(sub_id)
            studio_id = sub.get("metadata", {}).get("studio_id")
            plan = sub.get("metadata", {}).get("plan", "starter")
            _activate_plan(db, studio_id, plan, sub_id)

    # ── Subscription cancelled ────────────────────────────────────────────────
    elif event_type in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub_id = data.get("id")
        studio_id = data.get("metadata", {}).get("studio_id")
        if studio_id:
            studio = db.get(Studio, studio_id)
            if studio and studio.stripe_subscription_id == sub_id:
                studio.stripe_subscription_id = None
                db.commit()

    return {"received": True}


def _activate_plan(db: Session, studio_id: str | None, plan: str, sub_id: str | None) -> None:
    if not studio_id:
        return
    studio = db.get(Studio, studio_id)
    if not studio:
        return

    studio.subscription_plan = plan
    studio.is_active = True
    if sub_id:
        studio.stripe_subscription_id = sub_id

    # Extend from current expiry or now
    base = studio.plan_expires_at or datetime.now(timezone.utc)
    if base < datetime.now(timezone.utc):
        base = datetime.now(timezone.utc)
    studio.plan_expires_at = base + timedelta(days=PLAN_DAYS)
    db.commit()
