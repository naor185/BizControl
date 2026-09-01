import type { Page } from "@playwright/test";

// Deliberately extreme content — the whole point is to stress the exact
// classes of element that caused real horizontal-overflow bugs in this app:
// a name/email long enough to force a naive flex row wider than the phone,
// and one completely unbreakable (no-space) token that can't wrap at all.
export const LONG_NAME = "אוריאל־בן־דוד כהן־לוינסון מוחמד עבדאללה אלחנוני ואן דר ברג פרננדז הרננדז";
export const LONG_EMAIL = "this.is.a.deliberately.extremely.long.test.email.address.for.overflow@some-very-long-subdomain-example.co.il";
export const NO_SPACE_TOKEN = "SupercalifragilisticTestTokenWithNoSpacesWhatsoeverToStressTruncationXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
export const BIG_NUMBER = 987654321;

function fakeToken(): string {
    const b64url = (obj: unknown) =>
        Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const header = b64url({ alg: "none", typ: "JWT" });
    const payload = b64url({
        studio_id: "00000000-0000-0000-0000-000000000001",
        user_id: "00000000-0000-0000-0000-000000000002",
        role: "owner",
        exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
    });
    // Signature is never verified — every /api/** call is mocked, nothing
    // reaches a real backend that could reject a fake signature.
    return `${header}.${payload}.fake-signature-never-verified`;
}

/** Auth token in localStorage before any page script runs, so RequireAuth passes immediately. */
export async function injectAuth(page: Page) {
    const token = fakeToken();
    await page.addInitScript((t) => {
        window.localStorage.setItem("bizcontrol_token", t);
    }, token);
}

const EXTREME_MEMBER = {
    id: "client-extreme-1",
    full_name: LONG_NAME,
    phone: "0501234567",
    points: BIG_NUMBER,
    joined_at: "2026-01-01T00:00:00Z",
    birth_date: "1990-06-15",
    source: "manual" as const,
};

const EXTREME_LEADER = {
    id: "client-extreme-1",
    full_name: LONG_NAME,
    phone: "0501234567",
    is_club_member: true,
    loyalty_points: BIG_NUMBER,
    visit_count: BIG_NUMBER,
    total_paid_cents: BIG_NUMBER * 100,
};

const EXTREME_CLIENT = {
    id: "client-extreme-1",
    full_name: LONG_NAME,
    phone: "0501234567",
    email: LONG_EMAIL,
    created_at: "2026-01-01T00:00:00Z",
    is_club_member: true,
    birth_date: "1990-06-15",
    whatsapp_opted_out: false,
};

const EXTREME_APPOINTMENT = {
    id: "appt-extreme-1",
    title: NO_SPACE_TOKEN,
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: "scheduled",
    client_id: "client-extreme-1",
    client_name: LONG_NAME,
    artist_name: "Artist Test",
    artist_color: "#0ea5e9",
    notes: NO_SPACE_TOKEN,
    total_price_cents: BIG_NUMBER,
    deposit_amount_cents: 0,
    paid_cents: 0,
    remaining_cents: BIG_NUMBER,
    client_loyalty_points: BIG_NUMBER,
};

/** Exact-path mocks — checked before the catch-all. Order doesn't matter (Map). */
function exactMocks(): Record<string, unknown> {
    return {
        "/api/auth/me": { id: "u1", studio_id: "s1", role: "owner", email: LONG_EMAIL, display_name: LONG_NAME, email_verified: true },
        "/api/security/pin/status": { has_pin: false, is_locked: false },
        "/api/modules/me": {},
        "/api/auth/studio-info": { subscription_plan: "pro", plan_expires_at: null },
        "/api/whatsapp/status": { connected: true, status: "authorized" },
        "/api/appointments/version": { version: "1:2026-01-01T00:00:00Z" },
        // Object-wrapped, not a bare array, despite the plural-sounding
        // name — the generic list-shaped fallback below would otherwise
        // hand AIAssistant (mounted globally, on every route) an array
        // where it expects { suggestions: [...] }, crashing on
        // suggestions.length since arrays have no .suggestions property.
        "/api/ai/suggestions": { suggestions: [] },
        "/api/staff/clock-status": { is_clocked_in: false },
        "/api/nfc/presence": [],
        "/api/notifications/unread-count": { count: 0 },
        "/api/clients/counts": { total: 1, club_members: 1 },
        "/api/clients/club/stats": { total: 1, this_month: 1, via_landing: 0, via_manual: 1, members: [EXTREME_MEMBER] },
        "/api/dashboard/loyalty-stats": { total_points_awarded: BIG_NUMBER, total_points_redeemed: BIG_NUMBER, total_points_redeemed_ils: BIG_NUMBER, total_outstanding_points: BIG_NUMBER, total_outstanding_ils: BIG_NUMBER, clients_with_points: BIG_NUMBER },
        "/api/clients/club/leaderboard": { top_payers: [EXTREME_LEADER], top_visitors: [EXTREME_LEADER] },
        "/api/users/artists": [{ id: "artist-1", email: "artist@test.com", display_name: "Artist Test", calendar_color: "#0ea5e9" }],
        "/api/studio/automation": {},
        "/api/products/": [{ id: "p1", name: LONG_NAME, price_cents: BIG_NUMBER, is_active: true, stock_qty: BIG_NUMBER }],
        "/api/inbox/conversations": [{ phone: "0501234567", contact_name: LONG_NAME, last_message: NO_SPACE_TOKEN, last_message_at: new Date().toISOString(), unread_count: BIG_NUMBER, channel: "whatsapp" }],
        "/api/quick-replies": [],
        "/api/dashboard/stats": {
            appointments_today: BIG_NUMBER, total_clients: BIG_NUMBER, total_club_members: BIG_NUMBER,
            total_revenue_cents: BIG_NUMBER * 100, pending_messages: BIG_NUMBER, pending_payment_verifications: BIG_NUMBER,
            financials: { vat_amount_cents: BIG_NUMBER, income_tax_cents: BIG_NUMBER, social_security_cents: BIG_NUMBER, net_income_cents: BIG_NUMBER, gross_income_cents: BIG_NUMBER, vat_rate: 17 },
        },
        "/api/dashboard/daily-payments": [{ appointment_id: "a1", client_id: "c1", client_name: LONG_NAME, client_phone: "0501234567", client_loyalty_points: BIG_NUMBER, starts_at: new Date().toISOString(), total_price_cents: BIG_NUMBER, deposit_amount_cents: 0, paid_cents: BIG_NUMBER, remaining_cents: 0, status: "done", payment_sent_at: null, payment_verified_at: null }],
        "/api/dashboard/pending-payments": [],
        "/api/dashboard/occupancy": null,
        "/api/dashboard/today-revenue": { appointment_payments_cents: BIG_NUMBER, pos_revenue_cents: BIG_NUMBER, total_today_cents: BIG_NUMBER, deposits_today: [], date: new Date().toISOString() },
        "/api/dashboard/pending-gift-cards": [],
        "/api/dashboard/analytics": { revenue_by_month: [], appts_by_month: [], artists: [], busiest_days: [], new_vs_returning: { new: 0, returning: 0 } },
        "/api/dashboard/consultation-conversion": null,
        "/api/marketplace/my/analytics": null,
        "/api/payments": [
            {
                id: "pay-extreme-1", client_id: "client-extreme-1", appointment_id: "appt-1",
                amount_cents: BIG_NUMBER, currency: "ILS", type: "payment", status: "paid", method: "paybox",
                created_at: new Date().toISOString(), notes: NO_SPACE_TOKEN,
                client: { id: "client-extreme-1", full_name: LONG_NAME, is_walk_in: false },
            },
        ],
        "/api/pos/history": [
            {
                id: "pos-extreme-1", client_name: LONG_NAME, cashier_name: "Cashier Test",
                total_cents: BIG_NUMBER, discount_cents: 0, method: "bit", items_count: 1,
                created_at: new Date().toISOString(),
            },
        ],
    };
}

/**
 * Intercepts every /api/** request so the test never touches the real
 * (production, per next.config.ts's rewrite) backend. Exact-path matches
 * come from exactMocks(); anything else — including the many
 * ?query=string variants (clients list, appointments range, tasks range,
 * customer-club birthday-status, etc.) — falls back to a shape-guessing
 * catch-all: routes containing a plural-ish/list-shaped path return an
 * array (with one extreme-content record for the ones this suite actually
 * asserts on), everything else returns {}.
 */
export async function installApiMocks(page: Page) {
    const exact = exactMocks();

    await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;

        if (path in exact) {
            return route.fulfill({ json: exact[path] });
        }

        if (path === "/api/clients" || path === "/api/clients/") {
            return route.fulfill({ json: [EXTREME_CLIENT] });
        }
        if (path === "/api/appointments") {
            return route.fulfill({ json: [EXTREME_APPOINTMENT] });
        }
        if (path === "/api/customer-club/birthday-status") {
            return route.fulfill({
                json: { clients: [{ client_id: "client-extreme-1", full_name: LONG_NAME, birth_date: "1990-06-15", is_club_member: true, whatsapp_opted_out: false, coupon_status: "active", message_sent: true, redeemed_at: null }] },
            });
        }

        // Broad, low-risk fallbacks for everything not asserted on directly —
        // list-shaped paths (plural segment, or a query string like a date
        // range) get [], everything else gets {}, so pages render their
        // normal empty/loading state instead of crashing on unmocked data.
        const looksLikeList = /s(\/|$)/.test(path) || url.search.length > 0;
        return route.fulfill({ json: looksLikeList ? [] : {} });
    });
}
