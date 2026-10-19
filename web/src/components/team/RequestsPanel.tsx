"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Check, Plane, Stethoscope, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// The "בקשות" tab of the workers center (app/services/staff_requests.py — the owner, 2026-10-19): swaps and time off
// waiting for a decision — approve (the schedule changes / the calendar is locked) or not, with a word to the worker —
// and the last month's decided ones.

export type StaffRequest = {
    id: string; kind: "swap" | "vacation" | "sick" | "other"; status: string; name: string; target_name: string;
    summary: string; note: string; decision_note: string; created_at: string | null; shifts_during?: string[];
};
type Lists = { waiting?: StaffRequest[]; recent?: StaffRequest[] };

export const STATUS: Record<string, { label: string; cls: string }> = {
    waiting_colleague: { label: "מחכה לתשובת העמית/ה", cls: "bg-slate-100 text-slate-600" },
    waiting_owner: { label: "מחכה לאישור", cls: "bg-amber-50 text-amber-800" },
    approved: { label: "אושרה", cls: "bg-emerald-50 text-emerald-700" },
    rejected: { label: "לא אושרה", cls: "bg-rose-50 text-rose-700" },
    declined: { label: "העמית/ה לא הסכים/ה", cls: "bg-rose-50 text-rose-700" },
    canceled: { label: "בוטלה", cls: "bg-slate-100 text-slate-500" },
};
export const KIND_ICON = { swap: ArrowLeftRight, vacation: Plane, sick: Stethoscope, other: Plane };

export default function RequestsPanel() {
    const [lists, setLists] = useState<Lists | null>(null);
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const load = useCallback(() => { apiFetch<Lists>("/api/requests").then(setLists).catch(() => setLists({ waiting: [], recent: [] })); }, []);
    useEffect(() => { load(); }, [load]);

    const decide = async (r: StaffRequest, approve: boolean) => {
        setBusy(r.id);
        try {
            await apiFetch(`/api/requests/${r.id}/decide`, { method: "POST", body: JSON.stringify({ approve, note: notes[r.id] || "" }) });
            toast.success(approve ? (r.kind === "swap" ? "אושר — הסידור עודכן" : "אושר — היומן ננעל באותם ימים") : "נדחה — העובד/ת קיבל/ה הודעה");
            load();
        } catch (e) { toast.error(e instanceof Error ? e.message : "הפעולה נכשלה"); }
        finally { setBusy(null); }
    };

    if (!lists) return <div className="h-40 bg-white/60 animate-pulse rounded-2xl" />;
    const waiting = lists.waiting ?? [];
    return (
        <div className="space-y-4">
            <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
                <h3 className="px-4 py-3 border-b border-slate-100 font-bold text-slate-800">מחכות לך ({waiting.filter(r => r.status === "waiting_owner").length})</h3>
                {waiting.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">אין בקשות פתוחות.</p> : (
                    <ul className="divide-y divide-slate-100">
                        {waiting.map(r => {
                            const Icon = KIND_ICON[r.kind];
                            return (
                                <li key={r.id} className="px-4 py-3 space-y-2">
                                    <div className="flex items-start gap-2">
                                        <Icon className="w-4 h-4 mt-1 text-slate-500 shrink-0" aria-hidden />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-slate-800">
                                                {r.name}{r.kind === "swap" && <> ← {r.target_name}</>}
                                                <span className={`ms-2 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[r.status]?.cls}`}>{STATUS[r.status]?.label}</span>
                                            </div>
                                            <div className="text-sm text-slate-600">{r.summary}</div>
                                            {r.note && <div className="text-xs text-slate-500">&quot;{r.note}&quot;</div>}
                                            {r.shifts_during && r.shifts_during.length > 0 && (
                                                <div className="mt-1 text-xs text-amber-800 bg-amber-50 rounded-lg px-2 py-1">
                                                    יש לו/ה משמרות בימים האלה — כדאי להעביר אותן בסידור: {r.shifts_during.join(", ")}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {r.status === "waiting_owner" && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input value={notes[r.id] ?? ""} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} maxLength={300}
                                                placeholder="מילה לעובד/ת (לא חובה)" className="flex-1 min-w-[10rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                                            <button type="button" disabled={busy === r.id} onClick={() => decide(r, true)}
                                                className="inline-flex items-center gap-1 min-h-10 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">
                                                <Check className="w-4 h-4" aria-hidden /> אישור
                                            </button>
                                            <button type="button" disabled={busy === r.id} onClick={() => decide(r, false)}
                                                className="inline-flex items-center gap-1 min-h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                                <X className="w-4 h-4" aria-hidden /> לא מאשר/ת
                                            </button>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
            {(lists.recent ?? []).length > 0 && (
                <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
                    <h3 className="px-4 py-3 border-b border-slate-100 font-bold text-slate-800">החודש האחרון</h3>
                    <ul className="divide-y divide-slate-100">
                        {(lists.recent ?? []).map(r => (
                            <li key={r.id} className="px-4 py-2.5 text-sm flex flex-wrap items-center gap-2">
                                <b className="text-slate-800">{r.name}{r.kind === "swap" && <> ← {r.target_name}</>}</b>
                                <span className="text-slate-600">{r.summary}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[r.status]?.cls}`}>{STATUS[r.status]?.label}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
