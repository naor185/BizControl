"""The owner, 2026-10-20: a fresh install of the app opened the calendar without signing in. The screen's own gate
(web RequireAuth) opened it when its check outran 6 seconds — fixed to send to sign-in. This is the other half: the
server gives none of a business's data to a request without a sign-in (or with a made-up one)."""
import pytest

from tests.conftest import register_and_login

READS = ["/api/appointments", "/api/appointments/pending-deposits", "/api/appointments/version", "/api/broadcasts",
         "/api/classes/rooms", "/api/classes/sessions", "/api/classes/settings", "/api/clients", "/api/clients/counts",
         "/api/clients/club/leaderboard", "/api/clients/club/stats", "/api/customer-club/birthday-status",
         "/api/dashboard/daily-payments", "/api/dashboard/loyalty-stats", "/api/dashboard/occupancy",
         "/api/dashboard/pending-gift-cards", "/api/dashboard/pending-payments", "/api/dashboard/today-revenue",
         "/api/invoices", "/api/modules/me", "/api/services", "/api/studio/automation", "/api/tasks", "/api/users/artists",
         "/api/notifications", "/api/auth/me", "/api/viki"]


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer not-a-real-token"}])
def test_no_business_data_without_signing_in(client, db_session, headers):
    register_and_login(client, "gate-shop", "owner@gate-shop.com")          # a business with data exists
    for path in READS:
        r = client.get(path, headers=headers)
        assert r.status_code in (401, 403), (path, r.status_code, r.text[:200])
