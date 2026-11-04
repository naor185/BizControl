import { tx } from "@/lib/i18n";

// Lucky Club — raffles among the business's own clients (app/services/lucky_draw; the owner, 2026-11-04). A draw goes
// draft → locked → done (or canceled); the server picks the winners, the screens only show them.

export type Audience = "club" | "regular" | "all" | "manual";
export type DrawStatus = "draft" | "locked" | "done" | "canceled";

export type Prize = { place: number; title: string; description?: string | null };
export type Winner = {
    id: string; place: number; client_id: string | null; participant_id: string; full_name: string; phone: string | null;
    prize_title: string; status: "pending" | "redeemed"; redeemed_at: string | null; redeemed_by_name: string | null;
};
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
