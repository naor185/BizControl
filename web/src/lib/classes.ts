// Group classes — the shapes the server returns (app/api/class_routes.py) and Israel-time helpers.
// Every time is shown on the clock in Israel, whatever the device's own zone.

export type Room = { id: string; name: string; capacity: number; is_active: boolean };

export type ClassSession = {
    id: string; template_id: string | null; name: string; color: string; is_course: boolean;
    occurs_on: string; starts_at: string; ends_at: string;
    room_id: string | null; room_name: string | null; instructor_id: string | null; instructor_name: string | null;
    capacity: number; booked: number; status: "scheduled" | "canceled" | "auto_canceled" | "done";
    detached: boolean; cancel_reason: string | null;
    clients?: { id: string; full_name: string; phone: string | null }[];
};

export type ClassTemplate = {
    id: string; name: string; service_id: string | null; color: string | null;
    room_id: string | null; room_name: string | null; instructor_id: string | null; instructor_name: string | null;
    capacity: number; weekdays: number[]; start_time: string; duration_minutes: number;
    starts_on: string; ends_on: string | null; sessions_count: number | null; is_course: boolean; is_active: boolean;
    next_session: string | null; future_sessions: number; future_booked_sessions: number;
    rules: Record<string, number | boolean | string>;
};

export type Clash = { kind: "class" | "appointment"; name: string; starts_at: string };
export type DryRun = {
    clashes: { room: Clash[]; instructor: Clash[] };
    booked: { sessions: number; clients: number };
    sessions?: number;
};

export type StaffMember = { id: string; display_name: string | null; email: string; role: string; is_active?: boolean };

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
