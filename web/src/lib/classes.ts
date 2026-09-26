// Group classes — the shapes the server returns (app/api/class_routes.py) and Israel-time helpers.
// Every time is shown on the clock in Israel, whatever the device's own zone.

export type Room = { id: string; name: string; capacity: number; is_active: boolean };

export type ClassSession = {
    id: string; template_id: string | null; name: string; color: string; is_course: boolean;
    occurs_on: string; starts_at: string; ends_at: string;
    room_id: string | null; room_name: string | null; instructor_id: string | null; instructor_name: string | null;
    capacity: number; booked: number; status: "scheduled" | "canceled" | "auto_canceled" | "done";
    detached: boolean; cancel_reason: string | null;
    bookings?: Booking[];
    price_cents?: number;        // the class's service price — for a single entry
    waitlist_enabled?: boolean;
    waitlist?: { id: string; client_id: string; full_name: string; position: number; status: "waiting" | "notified"; offer_expires_at: string | null }[];
    spots_left?: number;         // spots minus those held for someone offered from the waitlist
    course_single_ok?: boolean;  // a course: a single session may be booked alone (the owner's rule)
};

export type BookingStatus = "booked" | "attended" | "no_show" | "late_canceled";
export type Booking = {
    id: string; client_id: string; full_name: string; phone: string | null; status: BookingStatus; over_capacity: boolean;
    drop_in: boolean; justified: boolean; membership: string | null;
    fee: { id: string; amount_cents: number; status: "pending" | "paid" | "waived" } | null;
    paid_cents: number;          // paid for a single entry (not counting a fee)
    in_course?: boolean;         // booked by a registration for the whole course
    self_checkin?: boolean;      // marked as attended by scanning the code at the door
};

// ── a course (GET /api/classes/courses/{template_id}) ──
export type CourseEnrollment = {
    id: string; client_id: string; full_name: string; phone: string | null;
    status: "active" | "waiting" | "offered" | "canceled" | "expired";
    price_cents: number; sessions_total: number; paid_cents: number; refunded_cents: number;
    refund_due_cents: number | null;        // what the owner's rule would give back now (null: the owner decides)
    position: number | null; offer_expires_at: string | null; enrolled_at: string | null; canceled_at: string | null;
    cancel_reason: string | null;
};
export type CourseView = {
    template_id: string; name: string; capacity: number; spots: number; waitlist_enabled: boolean;
    price_cents: number | null; price_now_cents: number | null; covered_by_membership: boolean;
    sessions_total: number; sessions_left: number; first_starts_at: string | null; enrolled: number;
    enrollments: CourseEnrollment[];
};

// ── memberships (stage 4) ──
export type MembershipKind = "unlimited" | "weekly" | "punch";
export type MembershipType = {
    id: string; name: string; kind: MembershipKind; kind_label: string; price_cents: number;
    duration_days: number | null; entries: number | null; covers_all: boolean; covered_templates: string[]; is_active: boolean;
    freeze_allowed: boolean; freeze_max_days: number | null; freeze_min_days: number | null; freeze_max_count: number | null;
    freeze_fee_cents: number;
};
export type Balance = { total: number; reserved: number; consumed: number; available: number };
export type MembershipStatus = "pending" | "active" | "frozen" | "ending" | "expired" | "canceled";
export type MembershipRow = {
    id: string; client_id: string; client_name: string; client_phone: string | null; type_id: string | null;
    name: string; kind: MembershipKind; kind_label: string; weekly_limit: number | null; status: MembershipStatus;
    starts_on: string; ends_on: string | null; price_cents: number; balance: Balance | null; notes: string | null;
    paid_cents: number;
    freeze_from: string | null; freeze_until: string | null;      // frozen from, back on
};
export type MembershipDetail = MembershipRow & {
    entries: { at: string; stage: "opening" | "adjust" | "reserve" | "close"; outcome: "consume" | "return" | null; amount: number; reason: string | null; class_name: string | null; class_at: string | null }[];
    bookings: { id: string; class_name: string; starts_at: string; status: string; entry_state: string | null }[];
    payments: { id: string; amount_cents: number; method: string; type: string; created_at: string }[];
    events: { at: string; action: string; from_status: string | null; to_status: string | null; effective_on: string | null;
              days: number | null; fee_cents: number; reason: string | null; by: string | null }[];
    freeze: { allowed: boolean; max_days: number | null; min_days: number | null; max_count: number | null;
              fee_cents: number; used_days: number; count: number };
    coming_bookings: number;
};

/** Payment methods — the same values and words as the appointment payment screen. */
export const PAYMENT_METHODS: { value: string; label: string }[] = [
    { value: "cash", label: "מזומן" }, { value: "credit_card", label: "אשראי" }, { value: "bit", label: "ביט" },
    { value: "paybox", label: "פייבוקס" }, { value: "bank_transfer", label: "העברה בנקאית" },
];
export const methodLabel = (m: string) => PAYMENT_METHODS.find(x => x.value === m)?.label ?? m;
export type PenaltyEvent = "late_cancel" | "no_show";
export type PenaltyAction = "nothing" | "warn" | "consume" | "fixed" | "percent" | "full";
export type PenaltyRule = {
    id?: string; event: PenaltyEvent; from_count: number; within_days: number | null; action: PenaltyAction;
    amount_cents: number | null; percent: number | null;
};
export type Fee = {
    id: string; client_id: string; client_name: string; booking_id: string; event: PenaltyEvent; amount_cents: number;
    reason: string; status: "pending" | "paid" | "waived"; waive_reason: string | null; created_at: string;
};

export const STATUS_LABEL: Record<MembershipStatus, string> = {
    pending: "מתחיל בקרוב", active: "פעיל", frozen: "מוקפא", ending: "נעצר בסוף התקופה", expired: "הסתיים", canceled: "בוטל",
};

/** "₪80" — whole shekels without decimals */
export function shekels(cents: number): string {
    const v = cents / 100;
    return `₪${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

/** "29/12/2026" for a "YYYY-MM-DD" day */
export function fullDate(day: string): string {
    const [y, m, d] = day.split("-").map(Number);
    return `${d}/${m}/${y}`;
}

/** Who may do what with a class — mirrors CLASS_ACTIONS on the server (app/core/permissions.py). */
export function classPermissions(role: string | null, userId: string | null, instructorId: string | null) {
    const manager = role === "owner" || role === "admin" || role === "superadmin";
    return {
        configure: manager,
        change: manager,
        book: manager || role === "staff",
        override: manager,
        mark: manager || role === "staff" || (role === "artist" && !!userId && userId === instructorId),
    };
}

export type ClassTemplate = {
    id: string; name: string; service_id: string | null; color: string | null;
    room_id: string | null; room_name: string | null; instructor_id: string | null; instructor_name: string | null;
    capacity: number; weekdays: number[]; start_time: string; duration_minutes: number;
    starts_on: string; ends_on: string | null; sessions_count: number | null; is_course: boolean; is_active: boolean;
    course_price_cents: number | null;       // a course: the price for all its sessions
    next_session: string | null; future_sessions: number; future_booked_sessions: number;
    rules: Record<string, number | boolean | string>;
};

export type Clash = { kind: "class" | "appointment"; name: string; starts_at: string };
export type DryRun = {
    clashes: { room: Clash[]; instructor: Clash[] };
    booked: { sessions: number; clients: number };
    sessions?: number;
};

export type StaffMember = { id: string; display_name?: string | null; email: string; role?: string; is_active?: boolean };

// 0 = Sunday … 6 = Saturday — the Israeli week
export const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export const DAY_LONG = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const TZ = "Asia/Jerusalem";
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const partsFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function ilTime(iso: string): string {
    return timeFmt.format(new Date(iso));
}

function ilParts(iso: string) {
    const p = Object.fromEntries(partsFmt.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day), weekday: WEEKDAY_INDEX[p.weekday] ?? 0 };
}

/** "6/10" */
export function ilDate(iso: string): string {
    const { d, m } = ilParts(iso);
    return `${d}/${m}`;
}

/** "2026-10-06" — the date on the clock in Israel */
export function ilDay(iso: string): string {
    const { y, m, d } = ilParts(iso);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Sunday of the Israeli week that holds this moment, as "YYYY-MM-DD". */
export function weekStart(iso: string): string {
    const { y, m, d, weekday } = ilParts(iso);
    return shiftDay(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, -weekday);
}

/** A "YYYY-MM-DD" day moved by n days. */
export function shiftDay(day: string, n: number): string {
    const [y, m, d] = day.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
}

/** "יום ראשון 4/10 · 18:00" */
export function whenShort(iso: string): string {
    const { d, m, weekday } = ilParts(iso);
    return `יום ${DAY_LONG[weekday]} ${d}/${m} · ${ilTime(iso)}`;
}

/** The classes a booking could move to (GET /api/classes/bookings/{id}/swap-options). */
export type SwapOptions = {
    allowed: boolean; reason: string | null;
    sessions: { id: string; name: string; starts_at: string; spots_left: number; can_swap: boolean; why_not: string | null }[];
};

/** "6/10" for a "YYYY-MM-DD" day */
export function dayLabel(day: string): string {
    const [, m, d] = day.split("-").map(Number);
    return `${d}/${m}`;
}

export function daysText(weekdays: number[]): string {
    return [...weekdays].sort((a, b) => a - b).map(d => DAY_SHORT[d]).join(", ");
}

export function endTime(start: string, minutes: number): string {
    const [h, m] = start.split(":").map(Number);
    const total = (h * 60 + m + minutes) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function clashLine(c: Clash): string {
    return `${c.name} — ${ilDate(c.starts_at)} ${ilTime(c.starts_at)}`;
}

export function staffName(u: StaffMember): string {
    return u.display_name || u.email;
}
