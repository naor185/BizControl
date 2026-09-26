"use client";

import { useEffect, useState } from "react";
import { PauseCircle, Check, X, Loader2, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { fullDate, shekels } from "@/lib/classes";

// Freeze requests clients sent from BizFind (GET /api/classes/freeze-requests). Each is checked against the
// membership's rules as of now — the server says when one can no longer be approved. Approve = the freeze is
// made as if the staff made it (the client gets the usual message); reject = the client is told, with the
// reason when one is written. Shown only while requests wait.

export type FreezeRequest = {
    id: string; membership_id: string; client_name: string; client_phone: string | null; membership_name: string | null;
    from_on: string; until_on: string; days: number; note: string | null; created_at: string; fee_cents: number;
    problem: string | null;
};

export default function FreezeRequests({ onChanged }: { onChanged: () => void }) {
    const [rows, setRows] = useState<FreezeRequest[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [rejecting, setRejecting] = useState<string | null>(null);
    const [reason, setReason] = useState("");

    useEffect(() => {
        apiFetch<FreezeRequest[]>("/api/classes/freeze-requests").then(setRows).catch(() => setRows([]));
    }, []);

    const act = async (r: FreezeRequest, verb: "approve" | "reject") => {
        setBusy(r.id);
        try {
            setRows(await apiFetch<FreezeRequest[]>(`/api/classes/freeze-requests/${r.id}/${verb}`, {
                method: "POST", body: verb === "reject" ? JSON.stringify({ reason: reason.trim() || null }) : undefined,
            }));
            toast.success(verb === "approve" ? `המנוי של ${r.client_name} הוקפא` : `הבקשה של ${r.client_name} נדחתה`);
            setRejecting(null);
            setReason("");
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(null);
        }
    };

    if (!rows || rows.length === 0) return null;
    return (
        <section className="rounded-2xl border border-cyan-200 bg-cyan-50/50 p-3 space-y-2" aria-labelledby="freeze-requests-title">
            <h3 id="freeze-requests-title" className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <PauseCircle className="w-4 h-4 text-cyan-700" aria-hidden /> בקשות הקפאה ({rows.length})
            </h3>
            <ul className="space-y-2">
                {rows.map(r => (
                    <li key={r.id} className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900">{r.client_name}{r.membership_name ? ` · ${r.membership_name}` : ""}</p>
                                <p className="text-xs text-slate-600 mt-0.5">
                                    מ-{fullDate(r.from_on)} עד {fullDate(r.until_on)} · {r.days} ימים
                                    {r.fee_cents > 0 ? ` · דמי הקפאה ${shekels(r.fee_cents)}` : ""}
                                </p>
                                {r.note && <p className="text-xs text-slate-500 mt-1">״{r.note}״</p>}
                            </div>
                            {rejecting !== r.id && (
                                <div className="flex gap-2 shrink-0">
                                    <button type="button" disabled={busy !== null || !!r.problem} onClick={() => act(r, "approve")}
                                        className="inline-flex items-center gap-1 min-h-10 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-40">
                                        {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Check className="w-4 h-4" aria-hidden />} לאשר
                                    </button>
                                    <button type="button" disabled={busy !== null} onClick={() => { setRejecting(r.id); setReason(""); }}
                                        className="inline-flex items-center gap-1 min-h-10 px-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:border-slate-400">
                                        <X className="w-4 h-4" aria-hidden /> לדחות
                                    </button>
                                </div>
                            )}
                        </div>
                        {r.problem && (
                            <p className="flex items-start gap-1.5 text-xs text-amber-900 bg-amber-50 rounded-lg px-2 py-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
                                <span>אי אפשר לאשר כרגע: {r.problem}</span>
                            </p>
                        )}
                        {rejecting === r.id && (
                            <div className="space-y-2">
                                <label htmlFor={`reject-${r.id}`} className="block text-xs font-semibold text-slate-600">סיבה (תישלח ללקוח/ה, לא חובה)</label>
                                <input id={`reject-${r.id}`} value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
                                    className="w-full rounded-xl border border-slate-200 px-3 min-h-11 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                    placeholder="למשל: בחודש הראשון אין הקפאות" />
                                <div className="flex gap-2">
                                    <button type="button" disabled={busy !== null} onClick={() => act(r, "reject")}
                                        className="min-h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-40">
                                        לדחות את הבקשה
                                    </button>
                                    <button type="button" onClick={() => setRejecting(null)} className="min-h-10 px-3 text-sm text-slate-600">חזרה</button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
