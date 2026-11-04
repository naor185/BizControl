import { tx } from "@/lib/i18n";

// Lucky Club — raffles among the business's own clients (app/services/lucky_draw; the owner, 2026-11-04). A draw goes
// draft → locked → done (or canceled); the server picks the winners, the screens only show them.

export type Audience = "club" | "regular" | "all" | "manual";
export type DrawStatus = "draft" | "locked" | "done" | "canceled";
// a prize: a gift (its words), points into the club card, or a percent off — a personal code (the owner, 2026-11-04)
export type PrizeKind = "gift" | "points" | "percent";
export type PrizeStatus = "pending" | "redeemed" | "expired";

export type Prize = {
    place: number; title: string; description?: string | null; kind: PrizeKind; value: number | null; valid_days: number | null;
};
// a prize as given — on the draw's winners and on the client's card
export type WonPrize = {
    id: string; place: number; prize_title: string; prize_kind: PrizeKind; prize_value: number | null; code: string | null;
    status: PrizeStatus; expires_on: string | null; redeemed_at: string | null; points_expired: number | null;
    notified_at: string | null;
};
export type Winner = WonPrize & {
    client_id: string | null; participant_id: string; full_name: string; phone: string | null; redeemed_by_name: string | null;
};
export type ClientPrize = WonPrize & { draw_id: string; draw_name: string; in_history: boolean; drawn_at: string | null };
export type Participant = { id: string; client_id: string | null; full_name: string; was_club_member: boolean };
export type ChosenClient = { id: string; full_name: string; phone: string | null; is_club_member: boolean };

export type Draw = {
    id: string; name: string; description: string | null; image_url: string | null; terms: string | null;
    scheduled_at: string | null; audience: Audience; winners_count: number; status: DrawStatus;
    participants_count: number; locked_at: string | null; locked_by_name: string | null;
    drawn_at: string | null; drawn_by_name: string | null; canceled_at: string | null; created_at: string | null;
    prizes: Prize[]; winners: Winner[];
    participants?: Participant[]; manual_clients?: ChosenClient[];
};

export const MAX_WINNERS = 3;          // the server's MAX_WINNERS

export const AUDIENCES: { key: Audience; label: string; hint: string }[] = [
    { key: "club", label: tx("חברי מועדון"), hint: tx("רק מי שחבר/ה במועדון") },
    { key: "regular", label: tx("לא חברי מועדון"), hint: tx("רק לקוחות שאינם במועדון") },
    { key: "all", label: tx("כל הלקוחות"), hint: tx("כל הלקוחות של העסק") },
    { key: "manual", label: tx("בחירה ידנית"), hint: tx("את/ה בוחר/ת מי משתתף") },
];

export const audienceLabel = (a: Audience) => AUDIENCES.find(x => x.key === a)?.label ?? a;

export const STATUS: Record<DrawStatus, { label: string; chip: string }> = {
    draft: { label: tx("טיוטה"), chip: "bg-slate-100 text-slate-700" },
    locked: { label: tx("נעולה — מוכנה להגרלה"), chip: "bg-amber-100 text-amber-800" },
    done: { label: tx("בוצעה"), chip: "bg-emerald-100 text-emerald-800" },
    canceled: { label: tx("בוטלה"), chip: "bg-rose-100 text-rose-700" },
};

export const placeLabel = (place: number) => tx("מקום {0}", { 0: place });

export const PRIZE_KINDS: { key: PrizeKind; label: string }[] = [
    { key: "gift", label: tx("מתנה") },
    { key: "points", label: tx("נקודות") },
    { key: "percent", label: tx("אחוז הנחה") },
];

export const PRIZE_STATUS: Record<PrizeStatus, { label: string; chip: string }> = {
    pending: { label: tx("ממתין למימוש"), chip: "bg-amber-50 text-amber-700" },
    redeemed: { label: tx("מומש"), chip: "bg-emerald-50 text-emerald-700" },
    expired: { label: tx("פג תוקף"), chip: "bg-slate-100 text-slate-500" },
};

/** "21.11.2026" — a prize's last day, the date's own day */
export const dayLabel = (iso: string | null) => iso ? iso.slice(0, 10).split("-").reverse().join(".") : "";

/** Days left to use a prize — from today to its last day (0: today is the last) */
export function daysLeft(iso: string | null): number | null {
    if (!iso) return null;
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const now = new Date();
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
}

/** What a winner's prize is, beyond its title — the code, the points, until when */
export function prizeDetails(p: WonPrize): string[] {
    const out: string[] = [];
    if (p.prize_kind === "percent" && p.code) out.push(tx("קוד הנחה: {0}", { 0: p.code }));
    if (p.prize_kind === "points") out.push(tx("נכנסו לכרטיס המועדון"));
    if (p.expires_on) out.push(tx("לממש עד {0}", { 0: dayLabel(p.expires_on) }));
    if (p.points_expired) out.push(tx("{0} נקודות שלא נוצלו ירדו", { 0: p.points_expired }));
    return out;
}
