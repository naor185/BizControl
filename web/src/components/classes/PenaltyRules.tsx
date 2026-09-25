"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { PenaltyAction, PenaltyEvent, PenaltyRule } from "@/lib/classes";

// The owner's late-cancel and no-show rules for one level — the business, a class, or a membership
// type (GET/PUT /api/classes/penalty-rules). The most specific level that has rules wins; an empty level
// follows the one above. Of the rules that match, the one with the highest "from the Nth time" applies.

const EVENTS: { value: PenaltyEvent; label: string }[] = [
    { value: "late_cancel", label: "ביטול מאוחר" },
    { value: "no_show", label: "אי-הגעה" },
];
const ACTIONS: { value: PenaltyAction; label: string }[] = [
    { value: "nothing", label: "כלום (הכניסה חוזרת)" },
    { value: "warn", label: "אזהרה בהודעה" },
    { value: "consume", label: "ניצול הכניסה" },
    { value: "fixed", label: "חיוב בסכום קבוע" },
    { value: "percent", label: "חיוב באחוז ממחיר השיעור" },
    { value: "full", label: "חיוב מלא (מחיר השיעור)" },
];

type Draft = PenaltyRule & { key: number };
const field = "min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";

export default function PenaltyRules({ scopeType = "studio", scopeId, canEdit, emptyNote }: {
    scopeType?: "studio" | "class_template" | "membership_type"; scopeId?: string; canEdit: boolean; emptyNote: string;
}) {
    const [rules, setRules] = useState<Draft[] | null>(null);
    const [saved, setSaved] = useState("[]");
    const [busy, setBusy] = useState(false);
    const query = `scope_type=${scopeType}${scopeId ? `&scope_id=${scopeId}` : ""}`;

    useEffect(() => {
        apiFetch<PenaltyRule[]>(`/api/classes/penalty-rules?${query}`)
            .then(r => { const d = r.map((x, i) => ({ ...x, key: i })); setRules(d); setSaved(JSON.stringify(strip(d))); })
            .catch(() => setRules([]));
    }, [query]);

    if (rules === null) return <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" aria-label="טוען" />;
    const dirty = JSON.stringify(strip(rules)) !== saved;
    const set = (key: number, patch: Partial<PenaltyRule>) => setRules(rs => rs!.map(r => (r.key === key ? { ...r, ...patch } : r)));

    const save = async () => {
        setBusy(true);
        try {
            const next = await apiFetch<PenaltyRule[]>("/api/classes/penalty-rules", {
                method: "PUT", body: JSON.stringify({ scope_type: scopeType, scope_id: scopeId ?? null, rules: strip(rules) }),
            });
            const d = next.map((x, i) => ({ ...x, key: i }));
            setRules(d);
            setSaved(JSON.stringify(strip(d)));
            toast.success("הכללים נשמרו");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            {rules.length === 0 ? (
                <p className="text-sm text-slate-500">{emptyNote}</p>
            ) : (
                <ul className="space-y-2">
                    {rules.map(r => (
                        <li key={r.key} className="rounded-xl border border-slate-200 p-3 flex flex-wrap items-end gap-2">
                            <label className="text-xs text-slate-600">אירוע
                                <select value={r.event} disabled={!canEdit} onChange={e => set(r.key, { event: e.target.value as PenaltyEvent })} className={`${field} block mt-1`}>
                                    {EVENTS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                                </select>
                            </label>
                            <label className="text-xs text-slate-600">מהפעם ה-
                                <input type="number" min={1} max={50} value={r.from_count} disabled={!canEdit} dir="ltr"
                                    onChange={e => set(r.key, { from_count: Number(e.target.value) || 1 })} className={`${field} block mt-1 w-16 text-center tabular-nums`} />
                            </label>
                            <label className="text-xs text-slate-600">בתוך (ימים)
                                <input type="number" min={1} max={365} value={r.within_days ?? ""} placeholder="תמיד" disabled={!canEdit} dir="ltr"
                                    onChange={e => set(r.key, { within_days: e.target.value ? Number(e.target.value) : null })} className={`${field} block mt-1 w-20 text-center tabular-nums`} />
                            </label>
                            <label className="text-xs text-slate-600 flex-1 min-w-[10rem]">מה קורה
                                <select value={r.action} disabled={!canEdit} onChange={e => set(r.key, { action: e.target.value as PenaltyAction })} className={`${field} block mt-1 w-full`}>
                                    {ACTIONS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                                </select>
                            </label>
                            {r.action === "fixed" && (
                                <label className="text-xs text-slate-600">סכום (₪)
                                    <input type="number" min={1} value={r.amount_cents != null ? r.amount_cents / 100 : ""} disabled={!canEdit} dir="ltr"
                                        onChange={e => set(r.key, { amount_cents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })}
                                        className={`${field} block mt-1 w-20 text-center tabular-nums`} />
                                </label>
                            )}
                            {r.action === "percent" && (
                                <label className="text-xs text-slate-600">אחוז
                                    <input type="number" min={1} max={100} value={r.percent ?? ""} disabled={!canEdit} dir="ltr"
                                        onChange={e => set(r.key, { percent: e.target.value ? Number(e.target.value) : null })}
                                        className={`${field} block mt-1 w-16 text-center tabular-nums`} />
                                </label>
                            )}
                            {canEdit && (
                                <button type="button" onClick={() => setRules(rs => rs!.filter(x => x.key !== r.key))} aria-label="הסרת הכלל"
                                    className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-700">
                                    <Trash2 className="w-4 h-4" aria-hidden />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {rules.length > 1 && <p className="text-xs text-slate-500">כשכמה כללים מתאימים — חל זה עם &quot;מהפעם ה-&quot; הגבוה ביותר.</p>}
            {canEdit && (
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={rules.length >= 20}
                        onClick={() => setRules(rs => [...rs!, { key: Date.now(), event: "late_cancel", from_count: 1, within_days: null, action: "warn", amount_cents: null, percent: null }])}
                        className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-700 hover:border-indigo-400">
                        <Plus className="w-4 h-4" aria-hidden /> כלל
                    </button>
                    {dirty && (
                        <button type="button" onClick={save} disabled={busy}
                            className="inline-flex items-center gap-2 min-h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-40">
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} שמירת הכללים
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function strip(rs: Draft[]): PenaltyRule[] {
    return rs.map(({ event, from_count, within_days, action, amount_cents, percent }) => ({ event, from_count, within_days, action, amount_cents, percent }));
}
