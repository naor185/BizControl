"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Lock } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// A worker's own screen for the shift schedule (app/services/schedule.py — the owner, 2026-10-19): their shifts this week
// and next (once published), and their constraints for next week — until the deadline the owner set.

type Shift = { id: string; date: string; start: string; end: string; note: string };
type Constraint = { date: string; kind: "off" | "morning" | "evening"; note: string };
type Week = { week_start: string; published_at: string | null; deadline: string; can_send: boolean; shifts: Shift[]; constraints: Constraint[] };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const CHOICES: { kind: "" | Constraint["kind"]; label: string }[] = [
    { kind: "", label: "יכול/ה" }, { kind: "off", label: "לא יכול/ה" }, { kind: "morning", label: "רק בוקר" }, { kind: "evening", label: "רק ערב" },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const thisSunday = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return ymd(d); };

function ShiftsOf({ week, title }: { week: Week | null; title: string }) {
    if (!week) return <div className="h-24 bg-white/60 animate-pulse rounded-2xl" />;
    return (
        <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
            <h2 className="px-4 py-3 border-b border-slate-100 font-bold text-slate-800">{title} <span className="font-normal text-slate-500">{ddmm(week.week_start)}–{ddmm(addDays(week.week_start, 6))}</span></h2>
            {!week.published_at ? <p className="px-4 py-3 text-sm text-slate-500">הסידור לשבוע הזה עוד לא פורסם.</p>
                : week.shifts.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">אין לך משמרות בשבוע הזה.</p> : (
                <ul className="divide-y divide-slate-100">
                    {week.shifts.map(s => (
                        <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="flex-1 font-semibold text-slate-800">יום {DAYS[new Date(`${s.date}T12:00:00`).getDay()]} <span className="font-normal text-slate-500">{ddmm(s.date)}</span>
                                {s.note && <span className="block text-xs font-normal text-slate-500">{s.note}</span>}</span>
                            <span className="tabular-nums font-bold text-sky-700">{s.start}–{s.end}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function MyShifts() {
    const [now, setNow] = useState<Week | null>(null);
    const [next, setNext] = useState<Week | null>(null);
    const nextStart = addDays(thisSunday(), 7);

    const load = useCallback(() => {
        apiFetch<Week>(`/api/schedule/week?start=${thisSunday()}`).then(setNow).catch(() => {});
        apiFetch<Week>(`/api/schedule/week?start=${nextStart}`).then(setNext).catch(() => {});
    }, [nextStart]);
    useEffect(() => { load(); }, [load]);

    const setConstraint = async (date: string, kind: string, note = "") => {
        try {
            await apiFetch("/api/schedule/constraints", { method: "PUT", body: JSON.stringify({ date, kind, note }) });
            load();
        } catch (e) { toast.error(e instanceof Error ? e.message : "השמירה נכשלה"); }
    };
    const due = next ? new Date(next.deadline) : null;

    return (
        <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-4">
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><CalendarClock className="w-6 h-6 text-sky-600" aria-hidden /> המשמרות שלי</h1>
            <ShiftsOf week={now} title="השבוע" />
            <ShiftsOf week={next} title="השבוע הבא" />

            {next && (
                <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <h2 className="font-bold text-slate-800">אילוצים לשבוע הבא</h2>
                        <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1">
                            {!next.can_send && <Lock className="w-3.5 h-3.5" aria-hidden />}
                            {next.can_send && due ? `אפשר להגיש עד יום ${DAYS[due.getDay()]} ${due.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`
                                : "המועד להגשת אילוצים עבר — לשינוי מדברים עם בעל העסק"}
                        </p>
                    </div>
                    <ul className="divide-y divide-slate-100">
                        {DAYS.map((d, i) => {
                            const date = addDays(next.week_start, i);
                            const c = next.constraints.find(x => x.date === date);
                            return (
                                <li key={date} className="px-4 py-2.5 space-y-1.5">
                                    <div className="font-semibold text-slate-800">יום {d} <span className="font-normal text-slate-500">{ddmm(date)}</span></div>
                                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`יום ${d}`}>
                                        {CHOICES.map(ch => {
                                            const on = (c?.kind ?? "") === ch.kind;
                                            return (
                                                <button key={ch.kind || "ok"} type="button" role="radio" aria-checked={on} disabled={!next.can_send}
                                                    onClick={() => setConstraint(date, ch.kind, ch.kind ? c?.note ?? "" : "")}
                                                    className={`min-h-9 px-3 rounded-xl border text-sm font-semibold disabled:opacity-60 ${on ? "border-sky-600 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-600"}`}>
                                                    {ch.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {c && next.can_send && (
                                        <input defaultValue={c.note} maxLength={200} placeholder="הערה (לא חובה) — למשל: עד 12:00"
                                            onBlur={e => e.target.value !== c.note && setConstraint(date, c.kind, e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}
        </div>
    );
}

export default function MyShiftsPage() {
    return <RequireAuth><AppShell title="המשמרות שלי"><MyShifts /></AppShell></RequireAuth>;
}
