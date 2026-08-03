"""
Subscription state engine + payment-provider abstraction — Generic Plans
Engine step 4. Stripe (or any future provider) is a payment processor that
reports events; it never IS the state. app/models/subscription.py's
Subscription.status is the only thing anything else in the codebase should
read to decide "is this studio's access active."

apply_subscription_event() is the only function allowed to write
Subscription.status/plan_id — called from the Stripe webhook handler,
Super Admin actions, initial signup, and the expiry-sweep cron. Each of
those translates its own event vocabulary (Stripe event types, admin
button clicks, ...) into the same small set of generic event_types here.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.subscription import Subscription, SubscriptionEvent
from app.utils.logger import get_logger

log = get_logger(__name__)

# event_type -> how it changes .status (identity if not overridden below).
# Kept intentionally small and generic — anything provider-specific gets
# translated into one of these before reaching apply_subscription_event().
_STATUS_TRANSITIONS: dict[str, str] = {
    "trial_started": "trial",
    "activated": "active",
    "renewed": "active",
    "payment_failed": "past_due",
    "grace_period_started": "grace_period",
    "suspended": "suspended",
    "canceled": "canceled",
    "reactivated": "active",
    "expired": "expired",
    # upgraded/downgraded/refunded/addon_purchased/overage_recorded don't
    # change status by themselves — plan_id or metadata changes instead.
}


def apply_subscription_event(
    db: Session,
    studio_id,
    event_type: str,
    source: str,
    *,
    plan_id: str | None = None,
    current_period_start: datetime | None = None,
    current_period_end: datetime | None = None,
    trial_ends_at: datetime | None = None,
    cancel_at_period_end: bool | None = None,
    provider_customer_id: str | None = None,
    provider_subscription_id: str | None = None,
    provider_event_id: str | None = None,
    metadata: dict | None = None,
) -> Subscription:
    """
    Apply a generic subscription event, creating the studio's subscription
    row if it doesn't exist yet (e.g. first event for a brand-new signup).
    Idempotent per provider_event_id — replaying the same Stripe webhook
    twice (Stripe's own retry behavior) is a no-op the second time.
    """
    if provider_event_id:
        dup = db.scalar(select(SubscriptionEvent).where(SubscriptionEvent.provider_event_id == provider_event_id))
        if dup:
            log.info("[billing] duplicate provider_event_id=%s ignored", provider_event_id)
            return db.scalar(select(Subscription).where(Subscription.studio_id == studio_id))

    sub = db.scalar(select(Subscription).where(Subscription.studio_id == studio_id))
    from_status = sub.status if sub else None
    from_plan = sub.plan_id if sub else None

    if sub is None:
        sub = Subscription(studio_id=studio_id, plan_id=plan_id or "free", status="trial")
        db.add(sub)
        db.flush()

    sub.status = _STATUS_TRANSITIONS.get(event_type, sub.status)
    if plan_id:
        sub.plan_id = plan_id
    if current_period_start is not None:
        sub.current_period_start = current_period_start
    if current_period_end is not None:
        sub.current_period_end = current_period_end
    if trial_ends_at is not None:
        sub.trial_ends_at = trial_ends_at
    if cancel_at_period_end is not None:
        sub.cancel_at_period_end = cancel_at_period_end
        sub.canceled_at = datetime.now(timezone.utc) if cancel_at_period_end else None
    if provider_customer_id:
        sub.provider_customer_id = provider_customer_id
    if provider_subscription_id:
        sub.provider_subscription_id = provider_subscription_id

    db.add(SubscriptionEvent(
        studio_id=studio_id,
        subscription_id=sub.id,
        event_type=event_type,
        from_status=from_status,
        to_status=sub.status,
        from_plan=from_plan,
        to_plan=sub.plan_id if sub.plan_id != from_plan else None,
        source=source,
        provider_event_id=provider_event_id,
        event_metadata=metadata,
    ))
    db.commit()
    return sub


def record_billable_overage(db: Session, studio_id, quota_key: str, used: int, limit: int) -> None:
    """
    Called by check_quota()'s 'paid_overage' branch. Logs the overage as a
    subscription_event for now — actually reporting it to the payment
    provider (e.g. a Stripe usage record ahead of the next invoice) needs a
    metered-billing product configured on the provider side first, so
    PaymentProvider.report_overage() is defined but not wired in yet.
    """
    sub = db.scalar(select(Subscription).where(Subscription.studio_id == studio_id))
    db.add(SubscriptionEvent(
        studio_id=studio_id,
        subscription_id=sub.id if sub else None,
        event_type="overage_recorded",
        source="system",
        event_metadata={"quota_key": quota_key, "used": used, "limit": limit, "overage": used - limit},
    ))
    db.commit()


# ── Payment provider abstraction ──────────────────────────────────────────────

class PaymentProvider(Protocol):
    """
    Everything billing_routes.py needs from a payment processor. The Plans
    Engine (plans/modules/quotas/subscriptions) never calls Stripe directly
    or imports the `stripe` package — only this interface and its
    implementations do. Adding a second provider means implementing this
    Protocol and mapping its webhook events to apply_subscription_event()'s
    generic event_types; nothing else in the codebase changes.
    """
    def create_checkout(self, studio, plan, success_url: str, cancel_url: str) -> str: ...
    def create_portal_session(self, studio, return_url: str) -> str: ...
    def change_plan(self, subscription: Subscription, new_plan_id: str, prorate: bool = True) -> None: ...
    def cancel(self, subscription: Subscription, at_period_end: bool = True) -> None: ...
    def refund(self, subscription: Subscription, amount_cents: int, reason: str) -> None: ...
    def report_overage(self, subscription: Subscription, quota_key: str, amount: int) -> None: ...


class StripeProvider:
    """Wraps the stripe.* calls that already lived in billing_routes.py —
    same behavior, just behind the PaymentProvider interface."""

    def create_checkout(self, studio, plan, success_url: str, cancel_url: str) -> str:
        import stripe
        if not plan.stripe_price_id:
            raise ValueError(f"Plan '{plan.id}' has no stripe_price_id configured")
        customer_id = self._ensure_customer(studio)
        session = stripe.checkout.Session.create(
            customer=customer_id,
            mode="subscription",
            line_items=[{"price": plan.stripe_price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"studio_id": str(studio.id), "plan": plan.id},
            subscription_data={"metadata": {"studio_id": str(studio.id), "plan": plan.id}},
            allow_promotion_codes=True,
            locale="auto",
        )
        return session.url

    def create_portal_session(self, studio, return_url: str) -> str:
        import stripe
        if not studio.stripe_customer_id:
            raise ValueError("Studio has no stripe_customer_id")
        session = stripe.billing_portal.Session.create(customer=studio.stripe_customer_id, return_url=return_url)
        return session.url

    def change_plan(self, subscription: Subscription, new_plan_id: str, prorate: bool = True) -> None:
        # Left for a future step to resolve the target Plan row and call
        # stripe.Subscription.modify with the new price — not exercised yet
        # (no upgrade/downgrade UI in step 4); documented so that step has a
        # concrete place to implement it rather than reaching into Stripe
        # directly from a route again.
        raise NotImplementedError("Plan changes are not wired to a UI yet — implement when that UI exists")

    def cancel(self, subscription: Subscription, at_period_end: bool = True) -> None:
        import stripe
        if not subscription.provider_subscription_id:
            raise ValueError("Subscription has no provider_subscription_id")
        stripe.Subscription.modify(subscription.provider_subscription_id, cancel_at_period_end=at_period_end)
        if not at_period_end:
            stripe.Subscription.cancel(subscription.provider_subscription_id)

    def refund(self, subscription: Subscription, amount_cents: int, reason: str) -> None:
        import stripe
        if not subscription.provider_subscription_id:
            raise ValueError("Subscription has no provider_subscription_id")
        stripe_sub = stripe.Subscription.retrieve(subscription.provider_subscription_id)
        latest_invoice_id = stripe_sub.get("latest_invoice")
        if not latest_invoice_id:
            raise ValueError("No invoice found to refund against")
        invoice = stripe.Invoice.retrieve(latest_invoice_id)
        payment_intent = invoice.get("payment_intent")
        if not payment_intent:
            raise ValueError("Invoice has no payment_intent to refund")
        stripe.Refund.create(payment_intent=payment_intent, amount=amount_cents, reason="requested_by_customer")

    def report_overage(self, subscription: Subscription, quota_key: str, amount: int) -> None:
        # Requires a Stripe metered-billing price configured for quota_key —
        # not set up yet. record_billable_overage() logs the event either way.
        raise NotImplementedError("Metered billing product not configured in Stripe yet")

    def _ensure_customer(self, studio) -> str:
        """Sets studio.stripe_customer_id as a side effect — caller commits."""
        import stripe
        if studio.stripe_customer_id:
            return studio.stripe_customer_id
        owner = next((u for u in studio.users if u.role == "owner"), None)
        customer = stripe.Customer.create(
            email=owner.email if owner else None,
            name=studio.name,
            metadata={"studio_id": str(studio.id), "slug": studio.slug},
        )
        studio.stripe_customer_id = customer.id
        return customer.id


_PROVIDERS: dict[str, PaymentProvider] = {"stripe": StripeProvider()}


def get_payment_provider(name: str = "stripe") -> PaymentProvider:
    return _PROVIDERS[name]
