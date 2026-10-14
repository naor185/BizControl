"""Where a person is signed in — "המכשירים שלי" (owner, 2026-10-14: "why keep 1236 of my devices?").

A login is a chain of refresh tokens: each refresh writes a new row with the login's session_started_at. The list used
to show every row never revoked — the logins long expired (a refresh token lives REFRESH_TOKEN_DAYS) and several rows
of one login: 1,236 "devices" for 13 real ones. Now:
- active(): one line per login, only the logins still alive;
- revoke(): signing a device out ends its whole login, every row of it;
- revoke_others(): "sign out everywhere else" — all but the login of the token given;
- purge_expired(): the rows older than a refresh token can live are deleted every night (their tokens can't be used
  any more). The younger revoked rows stay — /auth/refresh follows them to bring back an app that was closed
  mid-refresh."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.security import REFRESH_TOKEN_DAYS
from app.models.refresh_token import RefreshToken

LIFETIME = timedelta(days=REFRESH_TOKEN_DAYS)


def _login(row: RefreshToken):
    return row.session_started_at or row.id


def active(db: Session, user_id) -> list[RefreshToken]:
    """The newest row of each login that is still alive — newest login first."""
    rows = (db.query(RefreshToken)
            .filter(RefreshToken.user_id == user_id, RefreshToken.is_revoked == False,  # noqa: E712
                    RefreshToken.created_at > datetime.now(timezone.utc) - LIFETIME)
            .order_by(RefreshToken.created_at.desc()).all())
    seen, out = set(), []
    for r in rows:
        if _login(r) not in seen:
            seen.add(_login(r))
            out.append(r)
    return out


def _end(db: Session, user_id, login, now: datetime) -> int:
    q = db.query(RefreshToken).filter(RefreshToken.user_id == user_id, RefreshToken.is_revoked == False)  # noqa: E712
    q = q.filter(RefreshToken.session_started_at == login) if isinstance(login, datetime) else q.filter(RefreshToken.id == login)
    rows = q.all()
    for r in rows:
        r.is_revoked, r.revoked_at = True, now
    return len(rows)


def revoke(db: Session, user_id, session_id) -> bool:
    """Sign one device out — every row of its login. False when it isn't this person's."""
    row = db.query(RefreshToken).filter(RefreshToken.id == session_id, RefreshToken.user_id == user_id).first()
    if row is None:
        return False
    _end(db, user_id, _login(row), datetime.now(timezone.utc))
    db.commit()
    return True


def revoke_others(db: Session, user_id, refresh_token: str) -> int | None:
    """Sign out every device but the one holding this refresh token — how many were signed out; None when the token
    isn't this person's."""
    mine = db.query(RefreshToken).filter(RefreshToken.token == refresh_token, RefreshToken.user_id == user_id).first()
    if mine is None:
        return None
    now = datetime.now(timezone.utc)
    others = {_login(r) for r in active(db, user_id)} - {_login(mine)}
    for login in others:
        _end(db, user_id, login, now)
    db.commit()
    return len(others)


def purge_expired(db: Session) -> int:
    """Delete the rows no token of which can be used any more (older than a refresh token lives, plus a day)."""
    cutoff = datetime.now(timezone.utc) - LIFETIME - timedelta(days=1)
    n = db.execute(delete(RefreshToken).where(RefreshToken.created_at < cutoff)).rowcount or 0
    db.commit()
    return n
