"""
Shared login logic for business-owner authentication — used by both
BizControl's own login (app/api/auth_routes.py) and BizFind's business-owner
login (app/api/marketplace_routes.py), so the two don't drift into
duplicate/inconsistent behavior. They did before this module existed:
marketplace_routes.py's login had no 2FA support at all and a narrower role
filter than auth_routes.py's /login-by-email, purely because each had its
own copy-pasted version of the same logic.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import HTTPException
from sqlalchemy import text as _text
from sqlalchemy.orm import Session
from jose import jwt as jose_jwt

from app.core.security import create_access_token, create_refresh_token, JWT_SECRET, JWT_ALG
from app.models.user import User
from app.models.refresh_token import RefreshToken
from app.schemas.auth_schemas import TokenResponse
from app.utils.logger import get_logger

log = get_logger(__name__)
ph = PasswordHasher()

LOGIN_FAILURE_THRESHOLD = 5
LOGIN_FAILURE_WINDOW = timedelta(minutes=30)
LOGIN_ALERT_COOLDOWN = timedelta(hours=1)
LOGIN_LOCKOUT_DURATION = timedelta(minutes=15)
PENDING_TOKEN_MINUTES = 5


def find_login_candidates(db: Session, email: str, password: str) -> list[User]:
    """
    Every active User row sharing this email whose password matches.

    Email is NOT globally unique — app/models/user.py's UniqueConstraint is
    (studio_id, email), not email alone — so one person can have a separate
    User row (own password) per studio they belong to. Checking the
    password against every row sharing the email (instead of arbitrarily
    picking the oldest one by created_at, which is what both call sites did
    before this) is what makes the match count a correct signal:
      0 matches  → wrong email or wrong password, indistinguishable on purpose
      1 match    → log straight into that studio
      >1 matches → same person, same password, multiple businesses — the
                   caller should let them choose which one (see
                   create_studio_selection_token below)
    """
    email = email.lower().strip()
    rows = db.query(User).filter(User.email == email, User.is_active == True).all()  # noqa: E712
    matched = []
    for row in rows:
        try:
            ph.verify(row.password_hash, password)
            matched.append(row)
        except VerifyMismatchError:
            continue
    return matched


def track_login_failure(db: Session, user: User, reason: str) -> None:
    """Count repeated failed login attempts against a real account, lock the
    ACCOUNT (not the caller's IP — trivially defeated by switching VPN/proxy)
    once the threshold is crossed, and email the studio owner(s). Best-effort
    — must never break the login flow itself."""
    try:
        now = datetime.now(timezone.utc)
        studio_id = str(user.studio_id)
        email = user.email

        row = db.execute(
            _text("SELECT failure_count, first_failure_at, last_alerted_at, locked_until FROM login_failure_tracking WHERE studio_id = :sid AND email = :email"),
            {"sid": studio_id, "email": email},
        ).fetchone()

        # A lock that has run out starts a fresh count — otherwise the first try after it locks again at once.
        lock_over = bool(row and row[3] and row[3] <= now)
        if row and row[1] and (now - row[1]) < LOGIN_FAILURE_WINDOW and not lock_over:
            new_count = row[0] + 1
            first_failure_at = row[1]
        else:
            new_count = 1
            first_failure_at = now
        last_alerted_at = row[2] if row else None

        if new_count >= LOGIN_FAILURE_THRESHOLD:
            locked_until = now + LOGIN_LOCKOUT_DURATION
        else:
            locked_until = row[3] if row and not lock_over else None

        db.execute(
            _text("""
                INSERT INTO login_failure_tracking (studio_id, email, failure_count, first_failure_at, last_failure_at, last_alerted_at, locked_until)
                VALUES (:sid, :email, :cnt, :first, :now, :alerted, :locked)
                ON CONFLICT (studio_id, email)
                DO UPDATE SET failure_count = :cnt, first_failure_at = :first, last_failure_at = :now, locked_until = :locked
            """),
            {"sid": studio_id, "email": email, "cnt": new_count, "first": first_failure_at, "now": now, "alerted": last_alerted_at, "locked": locked_until},
        )
        db.commit()

        if new_count >= LOGIN_FAILURE_THRESHOLD and (not last_alerted_at or (now - last_alerted_at) >= LOGIN_ALERT_COOLDOWN):
            db.execute(
                _text("UPDATE login_failure_tracking SET last_alerted_at = :now WHERE studio_id = :sid AND email = :email"),
                {"now": now, "sid": studio_id, "email": email},
            )
            db.commit()
            _send_login_alert(db, user, new_count, reason)
    except Exception:
        log.exception("[login-alert] failed to track/alert on login failure")


def _get_lockout(db: Session, user: User) -> datetime | None:
    """Returns the lockout expiry if this account is currently locked, else None."""
    try:
        row = db.execute(
            _text("SELECT locked_until FROM login_failure_tracking WHERE studio_id = :sid AND email = :email"),
            {"sid": str(user.studio_id), "email": user.email},
        ).fetchone()
        if row and row[0] and row[0] > datetime.now(timezone.utc):
            return row[0]
    except Exception:
        log.exception("[login-alert] failed to check lockout status")
    return None


def raise_if_locked(db: Session, user: User) -> None:
    """Call once credentials (password and/or 2FA) have already verified
    correct — only at that point does distinguishing 'locked' from 'invalid
    credentials' not leak anything an attacker doesn't already know."""
    locked_until = _get_lockout(db, user)
    if locked_until:
        minutes_left = max(1, int((locked_until - datetime.now(timezone.utc)).total_seconds() // 60) + 1)
        raise HTTPException(status_code=423, detail=f"account_locked:{minutes_left}")


def _send_login_alert(db: Session, user: User, failure_count: int, reason: str) -> None:
    owners = db.query(User).filter(
        User.studio_id == user.studio_id, User.role == "owner", User.is_active == True,  # noqa: E712
    ).all()
    if not owners:
        return
    from app.services.email_center import send_email as _ec_send_email
    lockout_minutes = int(LOGIN_LOCKOUT_DURATION.total_seconds() // 60)
    html = f"""
    <div dir="rtl" style="font-family:Arial,sans-serif;padding:20px">
        <h2 style="color:#dc2626">🔒 ניסיונות התחברות כושלים חוזרים — החשבון ננעל זמנית</h2>
        <p>זוהו <b>{failure_count}</b> ניסיונות התחברות כושלים ({reason}) עבור החשבון <b>{user.email}</b> ב-30 הדקות האחרונות.</p>
        <p>החשבון ננעל אוטומטית ל-{lockout_minutes} דקות — גם אם הסיסמה הנכונה תוזן, ההתחברות תיחסם עד שהנעילה תפוג או עד שהסיסמה תאופס. הנעילה חלה על החשבון עצמו ולא תלויה בכתובת ה-IP או ה-VPN של מי שמנסה, כך שלא ניתן לעקוף אותה במעבר לרשת אחרת.</p>
        <p style="color:#64748b;font-size:12px">אם זה לא היית אתה — כדאי לשקול לאפס סיסמה לחשבון זה. התראה זו לא תישלח שוב על אותו חשבון למשך שעה.</p>
    </div>
    """
    for owner in owners:
        try:
            _ec_send_email(
                db, to_email=owner.email, subject=f"🔒 BizControl: ניסיונות התחברות כושלים חוזרים — {user.email}",
                html_content=html, from_name="BizControl Security", email_type="system",
            )
        except Exception:
            log.exception("[login-alert] failed to send alert email to owner")


def reset_login_failures(db: Session, user: User) -> None:
    try:
        db.execute(
            _text("DELETE FROM login_failure_tracking WHERE studio_id = :sid AND email = :email"),
            {"sid": str(user.studio_id), "email": user.email},
        )
        db.commit()
    except Exception:
        log.exception("[login-alert] failed to reset login failure tracking")


def create_pending_token(user_id: str, studio_id: str) -> str:
    """Step 2 of a 2FA login — proves password already verified, without a
    full access token yet. See app/api/auth_routes.py's /2fa/verify."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=PENDING_TOKEN_MINUTES)
    return jose_jwt.encode(
        {"type": "2fa_pending", "user_id": user_id, "studio_id": studio_id, "exp": exp},
        JWT_SECRET, algorithm=JWT_ALG,
    )


def create_studio_selection_token(candidate_user_ids: list[str]) -> str:
    """
    Issued when find_login_candidates() returns more than one match — proves
    password already verified against every one of these specific User rows,
    without picking one yet. The client can only ever pick a studio_id that
    traces back to a user_id in THIS signed list (see
    app/api/auth_routes.py's /select-studio) — never an arbitrary client-
    supplied studio_id.
    """
    exp = datetime.now(timezone.utc) + timedelta(minutes=PENDING_TOKEN_MINUTES)
    return jose_jwt.encode(
        {"type": "studio_selection_pending", "user_ids": candidate_user_ids, "exp": exp},
        JWT_SECRET, algorithm=JWT_ALG,
    )


def issue_full_tokens(user: User, db: Session, user_agent: str | None = None) -> TokenResponse:
    access = create_access_token({"user_id": str(user.id), "studio_id": str(user.studio_id), "role": user.role})
    refresh = create_refresh_token({"user_id": str(user.id), "studio_id": str(user.studio_id)})
    db.add(RefreshToken(
        id=uuid.uuid4(), studio_id=user.studio_id, user_id=user.id, token=refresh, is_revoked=False,
        user_agent=user_agent, session_started_at=datetime.now(timezone.utc),
    ))
    db.commit()
    return TokenResponse(access_token=access, refresh_token=refresh)


def studio_label(user: User) -> dict:
    """Small display payload for the studio-selection screen — name + role,
    never anything an attacker couldn't already infer from a valid login."""
    studio = user.studio
    return {
        "studio_id": str(user.studio_id),
        "studio_name": studio.name if studio else None,
        "role": user.role,
    }


# ── What's left before the lock (owner, 2026-10-11) ────────────────────────────────────────────────────────────
# A user who got it wrong ~8 times reset the password and was still locked for 14 minutes: the lock only showed up
# once the right password came, and resetting didn't lift it. Now every wrong password says how many tries are left,
# a locked account says so at once, and a successful reset (or change) lifts the lock — the reset proves it's them.

_NO_ACCOUNT: dict[str, tuple[int, datetime, datetime | None]] = {}   # e-mail → (tries, first, locked until)


def _state(db: Session, user: User) -> tuple[int, datetime | None]:
    try:
        row = db.execute(_text("SELECT failure_count, locked_until FROM login_failure_tracking WHERE studio_id = :sid AND email = :email"),
                         {"sid": str(user.studio_id), "email": user.email}).fetchone()
    except Exception:
        log.exception("[login-alert] failed to read login failure tracking")
        db.rollback()
        return 0, None
    return (row[0], row[1]) if row else (0, None)


def login_failed(db: Session, email: str, reason: str, users: list[User] | None = None) -> tuple[int, int | None]:
    """A wrong password: counted on the account(s) — every active one with this e-mail unless `users` is given — and
    (tries left, minutes locked or None). An e-mail with no account gets the same answers from a counter in memory,
    so the answer never tells whether an account exists."""
    email = (email or "").lower().strip()
    now = datetime.now(timezone.utc)
    if users is None:
        users = db.query(User).filter(User.email == email, User.is_active == True).all()  # noqa: E712
    if users:
        for u in users:
            track_login_failure(db, u, reason)
        states = [_state(db, u) for u in users]
        count = max(c for c, _ in states)
        locks = [lk for _, lk in states if lk and lk > now]
        locked_until = max(locks) if locks else None
    else:
        count, first, lock = _NO_ACCOUNT.get(email, (0, now, None))
        if lock and lock <= now:
            count, first, lock = 0, now, None
        elif now - first >= LOGIN_FAILURE_WINDOW:
            count, first = 0, now
        count += 1
        if count >= LOGIN_FAILURE_THRESHOLD and not (lock and lock > now):
            lock = now + LOGIN_LOCKOUT_DURATION
        if len(_NO_ACCOUNT) > 5000:
            _NO_ACCOUNT.clear()
        _NO_ACCOUNT[email] = (count, first, lock)
        locked_until = lock if lock and lock > now else None
    if locked_until:
        return 0, max(1, int((locked_until - now).total_seconds() // 60) + 1)
    return max(0, LOGIN_FAILURE_THRESHOLD - count), None


def login_failed_error(db: Session, email: str, reason: str, users: list[User] | None = None) -> HTTPException:
    """The answer to a wrong password, for the business sign-in screen: "invalid_credentials:{left}" (401) or
    "account_locked:{minutes}" (423) — web/src/app/login/page.tsx turns both into words."""
    left, minutes = login_failed(db, email, reason, users)
    if minutes:
        return HTTPException(status_code=423, detail=f"account_locked:{minutes}")
    return HTTPException(status_code=401, detail=f"invalid_credentials:{left}")
