"""
Deleting an account from inside the app (Apple requires it: an app where an account can be opened must let it be
deleted). Three kinds:
- a team member deletes their own login — at once: the user is switched off and its e-mail and name wiped (their
  past appointments stay the business's records);
- the owner deletes the business — at once it is closed (nobody can sign in, it leaves BizFind), and after
  GRACE_DAYS everything is erased for good (purge_due, a daily job) — until then the platform can undo it;
- a BizFind customer deletes their BizFind account (api/marketplace_customer_routes: DELETE /auth/me).
purge_studio() is also what the platform's admin uses to delete a business (superadmin_routes.delete_studio).
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.models.refresh_token import RefreshToken
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User

GRACE_DAYS = 30
_log = logging.getLogger("bizcontrol.account_deletion")


def _revoke_logins(db: Session, *, studio_id=None, user_id=None) -> None:
    q = update(RefreshToken).values(is_revoked=True)
    q = q.where(RefreshToken.user_id == user_id) if user_id else q.where(RefreshToken.studio_id == studio_id)
    db.execute(q)


def delete_my_user(db: Session, user: User) -> None:
    """A team member's own login, deleted now. The row stays (their appointments point at it) but nothing of the
    person is left: no e-mail, no name, no password, no two-step code."""
    user.is_active = False
    user.email = f"deleted-{user.id}@deleted.invalid"
    user.display_name = "משתמש/ת שנמחק/ה"
    user.password_hash = f"deleted:{secrets.token_hex(16)}"
    if hasattr(user, "totp_secret"):
        user.totp_secret = None
    _revoke_logins(db, user_id=user.id)


def request_business_deletion(db: Session, studio: Studio) -> datetime:
    """The owner deletes the business: closed now, erased for good after GRACE_DAYS. Returns when."""
    now = datetime.now(timezone.utc)
    studio.deletion_requested_at = now
    studio.is_active = False
    settings = db.get(StudioSettings, studio.id)
    if settings is not None:
        settings.marketplace_visible = False
    _revoke_logins(db, studio_id=studio.id)
    return now + timedelta(days=GRACE_DAYS)


def cancel_business_deletion(db: Session, studio: Studio) -> None:
    """The platform undoes a deletion that has not been erased yet (the owner changed their mind)."""
    studio.deletion_requested_at = None
    studio.is_active = True


# Deleted first, in this order: appointments before users (an appointment's artist cannot be deleted under it);
# every other table goes with the business itself (ON DELETE CASCADE).
_FIRST = ("message_jobs", "payments", "appointments", "booking_requests", "product_sales", "work_sessions",
          "client_points_ledger", "expenses", "monthly_goals", "leads", "clients", "products", "users",
          "studio_notes", "studio_integrations")


def purge_studio(db: Session, studio: Studio) -> None:
    """Erases a business and everything in it (the caller commits)."""
    sid = str(studio.id)
    for table in _FIRST:
        db.execute(text(f"DELETE FROM {table} WHERE studio_id = :sid"), {"sid": sid})
    db.delete(studio)


def purge_due(db: Session) -> int:
    """The daily job: erases every business whose owner deleted it more than GRACE_DAYS ago."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=GRACE_DAYS)
    done = 0
    for studio_id in db.scalars(select(Studio.id).where(Studio.deletion_requested_at.is_not(None),
                                                        Studio.deletion_requested_at <= cutoff)).all():
        try:
            purge_studio(db, db.get(Studio, studio_id))
            db.commit()
            done += 1
        except Exception:
            db.rollback()
            _log.exception("could not erase deleted business %s — left closed for the platform to look at", studio_id)
    return done

