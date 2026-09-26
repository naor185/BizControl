"use client";

import { useState } from "react";
import { Users, X, UserPlus, Crown } from "lucide-react";
import ClientSearch, { type FoundClient } from "@/components/classes/ClientSearch";
import type { Terms } from "@/lib/useTerms";
import {
    type EntriesMode, type FamilyPricing, type MembershipDetail, type MembershipKind, type MembershipType, shekels,
} from "@/lib/classes";

// A family / shared membership (app/services/membership_family.py) — every choice the owner's: how many
// people, how entries count, the price for the number of people, who books, adding people later. The server
// decides and works out the prices; these screens only ask and show.

const choice = (on: boolean) => `text-right rounded-xl border px-3 py-2 text-sm ${on ? "border-indigo-500 bg-indigo-50 text-indigo-800 font-semibold" : "border-slate-200 text-slate-700"}`;
const small = "block mt-1 w-24 min-h-10 rounded-lg border border-slate-200 text-center tabular-nums";

export type FamilyForm = {
    max_members: number | null; entries_mode: EntriesMode; member_cap: number | "";
    pricing: FamilyPricing; extra_member: number | ""; extra_member_percent: number | "";
    booking_by: "each" | "holder"; members_change: "free" | "priced" | "locked";
};

export function familyForm(t: MembershipType | null): FamilyForm {
    return {
        max_members: t ? t.max_members : 1, entries_mode: t?.entries_mode ?? "shared", member_cap: t?.member_cap ?? "",
        pricing: t?.pricing ?? "fixed", extra_member: t ? t.extra_member_cents / 100 : "", extra_member_percent: t?.extra_member_percent ?? "",
        booking_by: t?.booking_by ?? "each", members_change: t?.members_change ?? "free",
    };
}

export function familyPayload(f: FamilyForm) {
    return {
        max_members: f.max_members, entries_mode: f.entries_mode, member_cap: f.member_cap === "" ? null : f.member_cap,
        pricing: f.pricing, extra_member_cents: f.extra_member === "" ? 0 : Math.round(f.extra_member * 100),
        extra_member_percent: f.extra_member_percent === "" ? 0 : f.extra_member_percent,
        booking_by: f.booking_by, members_change: f.members_change,
    };
}

export function familyLine(t: Pick<MembershipType, "max_members" | "entries_mode">): string | null {
    if (t.max_members === 1) return null;
    const who = t.max_members === null ? "משפחתי, בלי הגבלת אנשים" : `משפחתי עד ${t.max_members} אנשים`;
    return `${who} · ${t.entries_mode === "each" ? "יתרה לכל אחד" : t.entries_mode === "shared_capped" ? "יתרה משותפת עם תקרה לאדם" : "יתרה משותפת"}`;
}

const SIZES: { value: number | null; label: string }[] = [
    { value: 1, label: "אדם אחד (רגיל)" }, { value: 2, label: "2" }, { value: 3, label: "3" }, { value: 4, label: "4" },
    { value: 5, label: "5" }, { value: null, label: "בלי הגבלה" },
];

/** The type sheet's part: a membership for several people, and the owner's choices for it. */
export function FamilyOptions({ f, kind, set }: { f: FamilyForm; kind: MembershipKind; set: (p: Partial<FamilyForm>) => void }) {
    const family = f.max_members !== 1;
    const custom = f.max_members !== null && !SIZES.some(x => x.value === f.max_members);
    const unit = kind === "weekly" ? "בשבוע" : "כניסות";
    return (
        <fieldset className="rounded-xl border border-slate-200 p-3 space-y-3">
            <legend className="px-1 text-xs font-semibold text-slate-600 flex items-center gap-1"><Users className="w-3.5 h-3.5" aria-hidden />כמה אנשים במנוי</legend>
            <div className="flex flex-wrap gap-2">
                {SIZES.map(x => (
                    <button key={String(x.value)} type="button" role="radio" aria-checked={f.max_members === x.value} onClick={() => set({ max_members: x.value })}
                        className={`min-h-10 px-3 ${choice(f.max_members === x.value)}`}>{x.label}</button>
                ))}
                <label className="text-xs text-slate-600">אחר
                    <input type="number" min={2} max={100} dir="ltr" value={custom ? f.max_members ?? "" : ""} placeholder="—"
                        onChange={e => e.target.value !== "" && set({ max_members: Math.max(2, Number(e.target.value)) })} className={small} />
                </label>
            </div>
            {family && (
                <>
                    {kind !== "unlimited" && (
                        <div>
                            <p className="text-xs font-semibold text-slate-600 mb-1">איך נספרות הכניסות</p>
                            <div className="grid gap-2">
                                {([["shared", "יתרה משותפת לכולם", `כל מי שמגיע מוריד מאותן ${unit}`],
                                   ["each", "לכל אחד יתרה משלו", `כל אחד מקבל את מספר ה${unit} בנפרד`],
                                   ["shared_capped", "משותפת, ולכל אחד עד מקסימום", "יתרה אחת לכולם, עם תקרה לכל אחד"]] as const).map(([v, title, hint]) => (
                                    <button key={v} type="button" role="radio" aria-checked={f.entries_mode === v} onClick={() => set({ entries_mode: v })} className={choice(f.entries_mode === v)}>
                                        <span className="block">{title}</span><span className="block text-xs font-normal text-slate-500">{hint}</span>
                                    </button>
                                ))}
                            </div>
                            {f.entries_mode === "shared_capped" && (
                                <label className="block mt-2 text-xs text-slate-600">לכל אחד לכל היותר ({unit})
                                    <input type="number" min={1} dir="ltr" value={f.member_cap} onChange={e => set({ member_cap: e.target.value === "" ? "" : Number(e.target.value) })} className={small} />
                                </label>
                            )}
                        </div>
                    )}
                    <div>
                        <p className="text-xs font-semibold text-slate-600 mb-1">איך מחושב המחיר</p>
                        <div className="grid gap-2">
                            {([["fixed", "מחיר קבוע לכל המנוי"], ["per_member", "מחיר לאדם × מספר האנשים"],
                               ["first_plus_extra", "מחיר לראשון + תוספת לכל נוסף"], ["first_plus_discount", "מחיר לראשון + הנחה לכל נוסף"]] as const).map(([v, title]) => (
                                <button key={v} type="button" role="radio" aria-checked={f.pricing === v} onClick={() => set({ pricing: v })} className={choice(f.pricing === v)}>{title}</button>
                            ))}
                        </div>
                        {f.pricing === "first_plus_extra" && (
                            <label className="block mt-2 text-xs text-slate-600">תוספת לכל נוסף (₪)
                                <input type="number" min={0} dir="ltr" value={f.extra_member} onChange={e => set({ extra_member: e.target.value === "" ? "" : Number(e.target.value) })} className={small} />
                            </label>
                        )}
                        {f.pricing === "first_plus_discount" && (
                            <label className="block mt-2 text-xs text-slate-600">הנחה לכל נוסף (%)
                                <input type="number" min={0} max={100} dir="ltr" value={f.extra_member_percent} onChange={e => set({ extra_member_percent: e.target.value === "" ? "" : Math.min(100, Number(e.target.value)) })} className={small} />
                            </label>
                        )}
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-slate-600 mb-1">מי רושם לשיעורים</p>
                        <div className="grid gap-2">
                            {([["each", "כל אחד נרשם בעצמו"], ["holder", "רק בעל/ת המנוי רושם/ת את כולם (למשל הורה לילד)"]] as const).map(([v, title]) => (
                                <button key={v} type="button" role="radio" aria-checked={f.booking_by === v} onClick={() => set({ booking_by: v })} className={choice(f.booking_by === v)}>{title}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-slate-600 mb-1">הוספת אנשים אחרי המכירה</p>
                        <div className="grid gap-2">
                            {([["free", "מותר, בלי שינוי מחיר"], ["priced", "מותר, והמחיר מתעדכן לפי החישוב"], ["locked", "אסור — רק בזמן המכירה"]] as const).map(([v, title]) => (
                                <button key={v} type="button" role="radio" aria-checked={f.members_change === v} onClick={() => set({ members_change: v })} className={choice(f.members_change === v)}>{title}</button>
                            ))}
                        </div>
                    </div>
                    <p className="text-xs text-slate-500">הקפאה, עצירה וביטול חלים על כל המנוי. מנויים שכבר נמכרו שומרים על הכללים שבהם נמכרו.</p>
                </>
            )}
        </fieldset>
    );
}

/** The sale sheet's part: the other people on a family membership, and its price for everyone. */
export function SellMembers({ type, holderId, members, setMembers, terms }: {
    type: MembershipType; holderId: string | null; members: FoundClient[]; setMembers: (m: FoundClient[]) => void; terms: Terms;
}) {
    const [adding, setAdding] = useState(false);
    const room = type.max_members === null || members.length + 1 < type.max_members;
    const price = type.family_prices[members.length];
    return (
        <fieldset className="rounded-xl border border-slate-200 p-3 space-y-2">
            <legend className="px-1 text-xs font-semibold text-slate-600">בני המשפחה במנוי{type.max_members ? ` (עד ${type.max_members} כולל בעל/ת המנוי)` : ""}</legend>
            {members.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 min-h-10">
                    <span className="text-sm text-slate-800">{c.full_name}</span>
                    <button type="button" onClick={() => setMembers(members.filter(x => x.id !== c.id))} aria-label={`הסרת ${c.full_name}`} className="w-8 h-8 flex items-center justify-center text-slate-400">
                        <X className="w-4 h-4" aria-hidden />
                    </button>
                </div>
            ))}
            {room && (adding ? (
                <ClientSearch terms={terms} onPick={c => { if (c.id !== holderId && !members.some(x => x.id === c.id)) setMembers([...members, c]); setAdding(false); }}
                    note={id => (id === holderId ? "בעל/ת המנוי" : members.some(x => x.id === id) ? "כבר במנוי" : null)} />
            ) : (
                <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg border border-dashed border-slate-300 text-sm text-slate-700">
                    <UserPlus className="w-4 h-4" aria-hidden /> הוספת בן/בת משפחה
                </button>
            ))}
            {price !== undefined && <p className="text-xs text-slate-600 tabular-nums">המחיר ל-{members.length + 1} {members.length ? "אנשים" : "אדם"}: {shekels(price)}</p>}
        </fieldset>
    );
}

/** The membership sheet's part: who is on it (the holder, the others), each one's use, adding and removing. */
export function MembershipMembers({ m, terms, canAdd, canRemove, busy, onAdd, onRemove }: {
    m: MembershipDetail; terms: Terms; canAdd: boolean; canRemove: boolean; busy: boolean;
    onAdd: (clientId: string) => void; onRemove: (clientId: string, name: string) => void;
}) {
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<string | null>(null);
    const room = m.max_members === null || m.members.length < m.max_members;
    const locked = m.members_change === "locked";
    return (
        <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Users className="w-3.5 h-3.5" aria-hidden />במנוי ({m.members.length}{m.max_members ? ` מתוך ${m.max_members}` : ""})</p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {m.members.map(p => (
                    <li key={p.client_id} className="px-3 py-2 flex items-center gap-2 min-h-11">
                        <span className="flex-1 min-w-0 text-sm text-slate-900 truncate">{p.full_name}</span>
                        {p.holder && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 rounded-full px-2"><Crown className="w-3 h-3" aria-hidden />בעל/ת המנוי</span>}
                        {p.used !== null && <span className="text-[11px] text-slate-500 tabular-nums">השתמש/ה ב-{p.used}</span>}
                        {canRemove && !locked && !p.holder && (removing === p.client_id ? (
                            <span className="flex items-center gap-1">
                                <button type="button" disabled={busy} onClick={() => { onRemove(p.client_id, p.full_name); setRemoving(null); }}
                                    className="min-h-9 px-2 rounded-lg bg-rose-600 text-white text-xs font-bold">להוציא</button>
                                <button type="button" onClick={() => setRemoving(null)} className="min-h-9 px-2 text-xs text-slate-600">חזרה</button>
                            </span>
                        ) : (
                            <button type="button" onClick={() => setRemoving(p.client_id)} aria-label={`הוצאת ${p.full_name} מהמנוי`} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-700">
                                <X className="w-4 h-4" aria-hidden />
                            </button>
                        ))}
                    </li>
                ))}
            </ul>
            {removing && <p className="text-xs text-slate-500">השיעורים הקרובים שלו/ה במנוי יבוטלו והכניסות יחזרו. המחיר לא משתנה.</p>}
            {canAdd && !locked && room && (adding ? (
                <ClientSearch terms={terms} busy={busy} onPick={c => { onAdd(c.id); setAdding(false); }}
                    note={id => (m.members.some(x => x.client_id === id) ? "במנוי" : null)} />
            ) : (
                <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg border border-dashed border-slate-300 text-sm text-slate-700">
                    <UserPlus className="w-4 h-4" aria-hidden /> הוספת בן/בת משפחה{m.members_change === "priced" ? " (המחיר יתעדכן)" : ""}
                </button>
            ))}
        </div>
    );
}
