// Group classes on BizFind — the shapes GET /api/marketplace/classes/{slug}/… returns, and Israel-time
// helpers (every time is shown on the clock in Israel, whatever the phone's own zone).

export type MyMembership = {
    name: string; kind: "unlimited" | "weekly" | "punch"; kind_label: string;
    status: "pending" | "active" | "frozen" | "ending"; starts_on: string; ends_on: string | null;
    entries_left: number | null; weekly_limit: number | null;
};

export type ScheduleItem = {
    id: string; name: string; color: string; starts_at: string; ends_at: string;
    room_name: string | null; instructor_name: string | null; spots_left: number;
    my_booking: { id: string; status: "booked" | "attended" | "no_show" | "late_canceled" } | null;
    can_book: boolean; why_not: string | null; free_cancel_until: string; late_if_cancel_now: boolean;
};

export type Schedule = {
    studio: { name: string; slug: string }; is_client: boolean; week: string;
    memberships: MyMembership[]; sessions: ScheduleItem[];
};

export type MineItem = {
    id: string; session_id: string; name: string; starts_at: string; ends_at: string; room_name: string | null;
    status: "booked" | "attended" | "no_show" | "late_canceled"; free_cancel_until?: string; late_if_cancel_now?: boolean;
};
export type Mine = { is_client: boolean; memberships: MyMembership[]; upcoming: MineItem[]; history: MineItem[] };

export const DAY_LONG = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const TZ = "Asia/Jerusalem";
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const ilTime = (iso: string) => timeFmt.format(new Date(iso));
export const ilDay = (iso: string) => dayFmt.format(new Date(iso));                 // "2026-10-04"
export function dayLabel(day: string): string {                                      // "4/10"
    const [, m, d] = day.split("-").map(Number);
    return `${d}/${m}`;
}
export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export function shiftDay(day: string, n: number): string {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** "יום ראשון 4/10 בשעה 18:00" */
export function whenText(iso: string): string {
    const day = ilDay(iso);
    return `יום ${DAY_LONG[weekdayOf(day)]} ${dayLabel(day)} בשעה ${ilTime(iso)}`;
}
export function fullDate(day: string): string {
    const [y, m, d] = day.split("-").map(Number);
    return `${d}/${m}/${y}`;
}
