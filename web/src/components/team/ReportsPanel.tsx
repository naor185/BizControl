"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, Settings2, UserX } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

import { tx } from "@/lib/i18n";
// The "דוחות" tab of the workers center (app/services/attendance_report.py — the owner, 2026-10-19): the schedule
// against the clock for a period — per worker hours in the schedule and worked, late arrivals, shifts not come to,
// overtime over the day's limit — the late / not come shifts, and the owner's settings for lateness and its alert.

type Worker = { user_id: string; name: string; scheduled: number; worked: number; shifts: number; late: number;
    late_minutes: number; missed: number; overtime: number };
type Event = { user_id: string; name: string; status: "late" | "missed"; late_min: number; words: string; clock_in: string | null };
type Alerts = { late_after_minutes: number; late_alert: boolean; overtime_after_hours: number };
type Report = { start: string; end: string; settings: Alerts; workers: Worker[]; events: Event[] };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function period(id: string): [string, string] {
    const t = new Date();
    if (id === "week" || id === "last_week") {
        const s = new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay() - (id === "last_week" ? 7 : 0));
        return [ymd(s), ymd(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6))];
    }
    const m = id === "month" ? 0 : -1;
    return [ymd(new Date(t.getFullYear(), t.getMonth() + m, 1)), ymd(new Date(t.getFullYear(), t.getMonth() + m + 1, 0))];
}
const PERIODS = [["week", tx("השבוע")], ["last_week", tx("שבוע שעבר")], ["month", tx("החודש")], ["last_month", tx("חודש שעבר")]] as const;
const card = "bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden";
const hrs = (h: number) => (h ? tx("{0} שע׳", { 0: h.toFixed(1) }) : "—");

function Stat({ label, value, tone = "text-slate-800", ltr }: { label: string; value: string; tone?: string; ltr?: boolean }) {
    return (
        <div className="rounded-xl bg-slate-50 px-2.5 py-2">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className={`text-sm font-bold tabular-nums ${tone}`}>{ltr ? <bdi dir="ltr">{value}</bdi> : value}</div>
        </div>
    );
}

function AlertSettings({ value, onSaved }: { value: Alerts; onSaved: () => void }) {
    const [late, setLate] = useState(String(value.late_after_minutes));
    const [on, setOn] = useState(value.late_alert);
    const [over, setOver] = useState(String(value.overtime_after_hours));
    const save = async () => {
        try {
            await apiFetch("/api/schedule/alerts", { method: "PUT", body: JSON.stringify({
                late_after_minutes: Math.max(0, Math.min(120, parseInt(late) || 0)), late_alert: on,
                overtime_after_hours: Math.max(1, Math.min(24, parseFloat(over) || 9)) }) });
            toast.success(tx("נשמר"));
            onSaved();
        } catch (e) { toast.error(e instanceof Error ? e.message : tx("השמירה נכשלה")); }
    };
    const num = "w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-center tabular-nums";
    return (
        <div className="p-4 space-y-3 text-sm text-slate-700">
            <label className="flex items-center gap-2">{tx("איחור נחשב אחרי")}
                <input type="number" inputMode="numeric" min={0} max={120} value={late} onChange={e => setLate(e.target.value)} className={num} />{tx(" דקות מתחילת המשמרת")}</label>
            <div className="flex items-start gap-3">
                <button type="button" role="switch" aria-checked={on} onClick={() => setOn(!on)} aria-label={tx("התראה על איחור")}
                    className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "start-0.5" : "start-[1.375rem]"}`} />
                </button>
                <span>{tx("התראה כשעובד/ת לא החתים/ה כניסה למשמרת — אצלך בפעמון, ולעובד/ת הודעה בטלפון")}</span>
            </div>
            <label className="flex items-center gap-2">{tx("שעות נוספות: מעל")}
                <input type="number" inputMode="decimal" min={1} max={24} step={0.1} value={over} onChange={e => setOver(e.target.value)} className={num} />{tx(" שעות ביום")}</label>
            <p className="text-xs text-slate-500">{tx("את מספר השעות ביום קובע/ת אתה/את — לפי ההסכם עם העובדים או לפי רואה החשבון.")}</p>
            <button type="button" onClick={save} className="min-h-10 px-5 rounded-xl bg-slate-900 text-white text-sm font-bold">{tx("שמירה")}</button>
        </div>
    );
}

export default function ReportsPanel() {
    const [pid, setPid] = useState<string>("week");
    const [rep, setRep] = useState<Report | null>(null);
    const [openSettings, setOpenSettings] = useState(false);
    const load = useCallback(() => {
        const [start, end] = period(pid);
        apiFetch<Report>(`/api/schedule/report?start=${start}&end=${end}`).then(setRep)
            .catch(e => toast.error(e instanceof Error ? e.message : tx("הדוח לא נטען")));
    }, [pid]);
    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={tx("תקופה")}>
                {PERIODS.map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={pid === id} onClick={() => setPid(id)}
                        className={`min-h-9 px-3 rounded-xl border text-sm font-semibold ${pid === id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{label}</button>
                ))}
                <button type="button" onClick={() => setOpenSettings(!openSettings)} aria-expanded={openSettings}
                    className="ms-auto inline-flex items-center gap-1 min-h-9 px-3 rounded-xl text-sm font-semibold text-slate-600 hover:bg-white">
                    <Settings2 className="w-4 h-4" aria-hidden /> {tx("הגדרות")}
                </button>
            </div>

            {openSettings && rep && (
                <section className={card}>
                    <h3 className="px-4 py-3 border-b border-slate-100 font-bold text-slate-800">{tx("איחורים ושעות נוספות")}</h3>
                    <AlertSettings value={rep.settings} onSaved={() => { setOpenSettings(false); load(); }} />
                </section>
            )}

            {!rep ? <div className="h-40 bg-white/60 animate-pulse rounded-2xl" /> : rep.workers.length === 0 ? (
                <p className={`${card} px-4 py-6 text-center text-sm text-slate-500`}>{tx("אין משמרות בסידור ואין שעות בשעון בתקופה הזו.")}</p>
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {rep.workers.map(w => (
                        <section key={w.user_id} className={`${card} p-4 space-y-2.5`}>
                            <h3 className="font-bold text-slate-800">{w.name} <span className="text-xs font-normal text-slate-500">{w.shifts}{tx(" משמרות בסידור")}</span></h3>
                            <div className="grid grid-cols-3 gap-2">
                                <Stat label={tx("בסידור")} value={hrs(w.scheduled)} />
                                <Stat label={tx("עבד/ה בפועל")} value={hrs(w.worked)} />
                                <Stat label={tx("שעות נוספות")} value={hrs(w.overtime)} tone={w.overtime ? "text-sky-700" : "text-slate-800"} />
                                <Stat label={tx("איחורים")} value={w.late ? tx("{0} · {1} דק׳", { 0: w.late, 1: w.late_minutes }) : "—"} tone={w.late ? "text-amber-700" : "text-slate-800"} />
                                <Stat label={tx("לא הגיע/ה")} value={w.missed ? String(w.missed) : "—"} tone={w.missed ? "text-rose-700" : "text-slate-800"} />
                                <Stat label={tx("הפרש מהסידור")} ltr value={w.scheduled ? `${w.worked - w.scheduled >= 0 ? "+" : "−"}${Math.abs(w.worked - w.scheduled).toFixed(1)}` : "—"} />
                            </div>
                        </section>
                    ))}
                </div>
            )}

            {rep && rep.events.length > 0 && (
                <section className={card}>
                    <h3 className="px-4 py-3 border-b border-slate-100 font-bold text-slate-800">{tx("איחורים והיעדרויות")}</h3>
                    <ul className="divide-y divide-slate-100">
                        {rep.events.map((e, i) => (
                            <li key={i} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
                                {e.status === "late" ? <AlarmClock className="w-4 h-4 text-amber-600" aria-hidden /> : <UserX className="w-4 h-4 text-rose-600" aria-hidden />}
                                <b className="text-slate-800">{e.name}</b>
                                <span className="flex-1 min-w-0 text-slate-600 tabular-nums">{e.words}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.status === "late" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`}>
                                    {e.status === "late" ? tx("איחור {0} דק׳ · נכנס/ה {1}", { 0: e.late_min, 1: e.clock_in }) : tx("לא הגיע/ה")}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
