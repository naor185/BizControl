"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CircleCheck, Target, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

import { tx, intl } from "@/lib/i18n";
// The "יעדים" tab of the workers center (the owner, 2026-10-27: "a sales goal for each worker"): each one's month — what
// they sold (the payments on their appointments and what they sold at the till, less credit notes) against the goal
// the owner sets here, the pace and what's needed a day, their tasks and this week's appointments
// (services/worker_progress). ויקי tells each worker the same about themselves (components/viki/VikiWorkerCard).

type Progress = {
    user_id: string; name: string; year: number; month: number; sales: number; goal: number; percent: number | null;
    projected: number | null; per_day: number | null; days_left: number;
    tasks: { total: number; done: number; on_time: number; late: number };
    week: { done: number; ahead: number };
};

const ils = (n: number) => `₪${Math.round(n).toLocaleString(intl())}`;

export default function GoalsPanel() {
    const [rows, setRows] = useState<Progress[] | null>(null);
    const [denied, setDenied] = useState(false);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(() => {
        apiFetch<Progress[]>("/api/workers/progress").then(setRows).catch(() => { setDenied(true); setRows([]); });
    }, []);
    useEffect(() => { load(); }, [load]);

    const save = async (p: Progress) => {
        const value = Number((draft[p.user_id] ?? "").replace(/[^\d.]/g, ""));
        if (!Number.isFinite(value) || value < 0) { toast.error(tx("סכום לא תקין")); return; }
        setBusy(p.user_id);
        try {
            const next = await apiFetch<Progress>(`/api/workers/${p.user_id}/goal`, { method: "PUT", body: JSON.stringify({ target: value }) });
            setRows(rs => (rs || []).map(r => (r.user_id === p.user_id ? next : r)));
            setDraft(d => { const { [p.user_id]: _, ...rest } = d; return rest; });
            toast.success(tx("היעד של {0} לחודש הזה: {1}", { 0: p.name, 1: ils(value) }));
        } catch (e) { toast.error(e instanceof Error ? e.message : tx("הפעולה נכשלה")); }
        finally { setBusy(null); }
    };

    if (!rows) return <div className="h-40 bg-white/60 animate-pulse rounded-2xl" />;
    if (denied) return <p className="text-sm text-slate-500">{tx("היעדים של הצוות — לבעל העסק ולמי שמנהל את הצוות.")}</p>;
    if (rows.length === 0) return <p className="text-sm text-slate-500">{tx("אין עדיין עובדים בצוות — אחרי שתוסיף, תוכל לקבוע לכל אחד יעד מכירות.")}</p>;

    const monthName = new Date(rows[0].year, rows[0].month - 1, 1).toLocaleDateString(intl(), { month: "long", year: "numeric" });
    return (
        <div className="space-y-3">
            <p className="text-sm text-slate-500">
                {tx("יעד המכירות של כל עובד ל{0} — התשלומים על התורים שלו ומה שמכר בקופה, פחות זיכויים. ויקי מראה לכל עובד את ההתקדמות שלו.", { 0: monthName })}
            </p>
            {rows.map(p => {
                const pct = p.percent ?? 0;
                const bar = Math.min(100, pct);
                const behind = p.projected !== null && p.goal > 0 && p.projected < p.goal * 0.95;
                return (
                    <section key={p.user_id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="font-bold text-slate-800">{p.name}</h3>
                            <div className="flex items-center gap-2">
                                <label className="sr-only" htmlFor={`goal-${p.user_id}`}>{tx("יעד חודשי")}</label>
                                <input id={`goal-${p.user_id}`} inputMode="numeric" dir="ltr"
                                    value={draft[p.user_id] ?? (p.goal ? String(Math.round(p.goal)) : "")}
                                    onChange={e => setDraft(d => ({ ...d, [p.user_id]: e.target.value }))}
                                    placeholder={tx("יעד חודשי ₪")}
                                    className="w-32 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-600" />
                                <button type="button" onClick={() => save(p)} disabled={busy === p.user_id || draft[p.user_id] === undefined}
                                    className="min-h-9 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition disabled:opacity-50">
                                    {tx("שמירת יעד")}
                                </button>
                            </div>
                        </div>

                        {p.goal > 0 ? (
                            <div>
                                <div className="flex items-baseline justify-between text-sm">
                                    <span className="font-semibold text-slate-800">{ils(p.sales)} <span className="text-slate-400 font-normal">{tx("מתוך")} {ils(p.goal)}</span></span>
                                    <span className={`font-bold tabular-nums ${pct >= 100 ? "text-emerald-600" : behind ? "text-amber-600" : "text-sky-700"}`}>{pct}%</span>
                                </div>
                                <div className="mt-1.5 h-2.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                                    <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : behind ? "bg-amber-500" : "bg-sky-500"}`} style={{ width: `${bar}%` }} />
                                </div>
                                <p className="mt-1.5 text-xs text-slate-500">
                                    {pct >= 100 ? tx("עבר/ה את היעד.")
                                        : p.per_day !== null ? tx("נשארו {0} ב-{1} ימי עבודה — בערך {2} ליום.", { 0: ils(p.goal - p.sales), 1: p.days_left, 2: ils(p.per_day) })
                                        : ""}
                                    {p.projected !== null && pct < 100 ? " " + tx("בקצב הזה: בערך {0}.", { 0: ils(p.projected) }) : ""}
                                </p>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-600">{tx("החודש עד עכשיו: {0} מכירות — עוד לא נקבע יעד.", { 0: ils(p.sales) })}</p>
                        )}

                        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                            <li className="inline-flex items-center gap-1">
                                {p.tasks.late ? <TriangleAlert className="w-3.5 h-3.5 text-amber-600" aria-hidden /> : <CircleCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                                {p.tasks.total ? tx("משימות: {0} מתוך {1} בוצעו, {2} באיחור", { 0: p.tasks.done, 1: p.tasks.total, 2: p.tasks.late }) : tx("אין משימות החודש")}
                            </li>
                            <li className="inline-flex items-center gap-1">
                                <CalendarDays className="w-3.5 h-3.5 text-sky-600" aria-hidden />
                                {tx("השבוע: {0} תורים, עוד {1}", { 0: p.week.done, 1: p.week.ahead })}
                            </li>
                            {p.goal > 0 && pct < 100 && behind && (
                                <li className="inline-flex items-center gap-1 text-amber-700">
                                    <Target className="w-3.5 h-3.5" aria-hidden />{tx("מתחת לקצב")}
                                </li>
                            )}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}
