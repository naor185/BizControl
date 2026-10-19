"use client";

import { useCallback, useEffect, useState } from "react";
import { History, LifeBuoy, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

import { intl, tx } from "@/lib/i18n";
// The business's activity log — who did what, and when (owner, 2026-10-13). Owner only; the server writes a line for
// each sensitive action (app/services/activity_log.py) and serves them here (/api/activity).

type Item = { id: string; at: string; person: string; name: string; area: string; text: string };
type Page = { items: Item[]; more: boolean; people: { id: string; name: string }[]; areas: Record<string, string> };

const TZ = "Asia/Jerusalem";
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const timeOf = (iso: string) => new Intl.DateTimeFormat(intl(), { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function dayLabel(key: string): string {
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
    if (key === today) return tx("היום");
    if (key === yesterday) return tx("אתמול");
    const [y, m, d] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(intl(), { weekday: "long", day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
}

export default function ActivityPage() {
    const [items, setItems] = useState<Item[]>([]);
    const [people, setPeople] = useState<Page["people"]>([]);
    const [areas, setAreas] = useState<Record<string, string>>({});
    const [more, setMore] = useState(false);
    const [person, setPerson] = useState("");
    const [area, setArea] = useState("");
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const load = useCallback(async (before?: string) => {
        setLoading(true);
        setErr(null);
        const q = new URLSearchParams();
        if (person) q.set("person", person);
        if (area) q.set("area", area);
        if (before) q.set("before", before);
        try {
            const page = await apiFetch<Page>(`/api/activity?${q}`);
            setItems(prev => before ? [...prev, ...page.items] : page.items);
            setMore(page.more);
            setPeople(page.people);
            setAreas(page.areas);
        } catch (e) {
            setErr((e as Error)?.message || tx("שגיאה בטעינה"));
        } finally {
            setLoading(false);
        }
    }, [person, area]);

    useEffect(() => { load(); }, [load]);

    const days: { key: string; rows: Item[] }[] = [];
    for (const it of items) {
        const key = dayKey(it.at);
        if (days.at(-1)?.key !== key) days.push({ key, rows: [] });
        days.at(-1)!.rows.push(it);
    }

    return (
        <RequireAuth>
            <AppShell title={tx("יומן פעילות")}>
                <div className="p-4 md:p-8 max-w-[860px] mx-auto space-y-6">
                    <div>
                        <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                            <History className="w-7 h-7 text-slate-500" aria-hidden /> {tx("יומן פעילות")}
                        </h1>
                        <p className="mt-2 text-slate-500 leading-relaxed max-w-xl">
                            {tx("מי עשה מה ומתי: קבלות וזיכויים, מחיקות, הנחות בקופה, שינויי הגדרות, הצוות ותיקוני נוכחות. רק אתה רואה את היומן.")}
                        </p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            {tx("מי")}
                            <select value={person} onChange={e => setPerson(e.target.value)}
                                className="flex-1 sm:flex-none sm:min-w-56 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-sky-600">
                                <option value="">{tx("כולם")}</option>
                                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </label>
                        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label={tx("סוג פעולה")}>
                            {[["", tx("הכול")], ...Object.entries(areas)].map(([k, label]) => (
                                <button key={k || "all"} type="button" onClick={() => setArea(k)} aria-pressed={area === k}
                                    className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                                        area === k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                                    {tx(label)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {err && <p className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm font-medium">{err}</p>}

                    {!err && !loading && items.length === 0 && (
                        <p className="bg-white border border-slate-100 rounded-2xl p-6 text-slate-500 text-center">
                            {person || area ? tx("אין פעולות שמתאימות לסינון.") : tx("עוד אין פעולות ביומן. מהיום כל פעולה רגישה נרשמת כאן.")}
                        </p>
                    )}

                    {days.map(day => (
                        <section key={day.key} aria-label={dayLabel(day.key)}>
                            <h2 className="text-xs font-bold text-slate-500 tracking-wide mb-2">{dayLabel(day.key)}</h2>
                            <ul className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
                                {day.rows.map(it => (
                                    <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                                        <span className="text-sm font-semibold text-slate-400 tabular-nums pt-0.5 w-11 shrink-0">{timeOf(it.at)}</span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                                                {it.person === "support" && <LifeBuoy className="w-4 h-4 text-sky-600 shrink-0" aria-hidden />}
                                                {it.name}
                                            </p>
                                            <p className="text-sm text-slate-700 break-words">{it.text}</p>
                                        </div>
                                        <span className="shrink-0 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 mt-0.5">
                                            {areas[it.area] ?? it.area}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}

                    {loading && <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" aria-label={tx("טוען")} />}
                    {!loading && more && (
                        <button type="button" onClick={() => load(items.at(-1)?.at)}
                            className="w-full py-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-slate-400">
                            {tx("הצג עוד")}
                        </button>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
