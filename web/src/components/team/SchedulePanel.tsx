"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Loader2, Plus, Send, Settings2, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// The "סידור עבודה" tab of the workers center (app/services/schedule.py — the owner, 2026-10-19): a week, day by day —
// the workers' constraints on each day, the shifts (tap one to change it), "+ משמרת" with the ready shifts; copy the week
// before; publish — each worker with shifts hears of them. The ready shifts and the constraints' deadline at the bottom.

type Shift = { id: string; user_id: string; date: string; start: string; end: string; note: string };
type Constraint = { user_id: string; date: string; kind: "off" | "morning" | "evening"; note: string };
type Template = { name: string; start: string; end: string };
type Week = {
    week_start: string; published_at: string | null; changed: boolean; deadline: string;
    templates: Template[]; deadline_day: number; deadline_hour: string;
    shifts: Shift[]; constraints: Constraint[]; workers: { id: string; name: string; color: string | null }[];
};
type Draft = { id?: string; date: string; user_id: string; start: string; end: string; note: string };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const KIND = { off: { label: "לא יכול/ה", cls: "bg-rose-50 text-rose-700 border-rose-100" },
               morning: { label: "רק בוקר", cls: "bg-amber-50 text-amber-800 border-amber-100" },
               evening: { label: "רק ערב", cls: "bg-amber-50 text-amber-800 border-amber-100" } };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const thisSunday = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return ymd(d); };

export default function SchedulePanel() {
    const [start, setStart] = useState(() => addDays(thisSunday(), 7));      // next week — the one usually being planned
    const [week, setWeek] = useState<Week | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const load = useCallback(() => {
        apiFetch<Week>(`/api/schedule/week?start=${start}`).then(setWeek).catch(e => toast.error(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, [start]);
    useEffect(() => { setWeek(null); load(); }, [load]);

    const act = async (fn: () => Promise<unknown>, done?: string) => {
        setBusy(true);
        try { await fn(); if (done) toast.success(done); load(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "הפעולה נכשלה"); }
        finally { setBusy(false); }
    };
    const save = () => draft && act(async () => {
        const body = JSON.stringify({ user_id: draft.user_id, date: draft.date, start: draft.start, end: draft.end, note: draft.note });
        await apiFetch(draft.id ? `/api/schedule/shifts/${draft.id}` : "/api/schedule/shifts", { method: draft.id ? "PATCH" : "POST", body });
        setDraft(null);
    });
    const remove = (s: Shift) => act(() => apiFetch(`/api/schedule/shifts/${s.id}`, { method: "DELETE" }));
    const copy = () => act(async () => {
        const r = await apiFetch<{ copied: number }>("/api/schedule/week/copy", { method: "POST", body: JSON.stringify({ start }) });
        toast.success(r.copied ? `הועתקו ${r.copied} משמרות מהשבוע הקודם` : "אין מה להעתיק מהשבוע הקודם");
    });
    const publish = () => act(async () => {
        const r = await apiFetch<{ told: number }>("/api/schedule/week/publish", { method: "POST", body: JSON.stringify({ start }) });
        toast.success(`הסידור פורסם — ${r.told} עובדים קיבלו הודעה`);
    });

    if (!week) return <div className="h-40 bg-white/60 animate-pulse rounded-2xl" />;
    const name = (id: string) => week.workers.find(w => w.id === id)?.name ?? "";
    const color = (id: string) => week.workers.find(w => w.id === id)?.color || "#94a3b8";
    const status = !week.published_at ? { t: "טיוטה — העובדים עוד לא רואים", c: "bg-slate-100 text-slate-600" }
        : week.changed ? { t: "יש שינויים שלא פורסמו", c: "bg-amber-50 text-amber-800" } : { t: "פורסם", c: "bg-emerald-50 text-emerald-700" };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setStart(addDays(start, -7))} aria-label="השבוע הקודם" className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50"><ChevronRight className="w-5 h-5" aria-hidden /></button>
                <div className="flex-1 min-w-[8rem] text-center">
                    <div className="font-bold text-slate-900">{ddmm(start)}–{ddmm(addDays(start, 6))}</div>
                    <span className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${status.c}`}>{status.t}</span>
                </div>
                <button type="button" onClick={() => setStart(addDays(start, 7))} aria-label="השבוע הבא" className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50"><ChevronLeft className="w-5 h-5" aria-hidden /></button>
                <div className="w-full sm:w-auto flex gap-2">
                    <button type="button" onClick={copy} disabled={busy} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 min-h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        <Copy className="w-4 h-4" aria-hidden /> העתקה מהשבוע הקודם
                    </button>
                    <button type="button" onClick={publish} disabled={busy || week.shifts.length === 0} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 min-h-10 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-50">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />} {week.published_at ? "פרסום מחדש" : "פרסום הסידור"}
                    </button>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {DAYS.map((dayName, i) => {
                    const date = addDays(week.week_start, i);
                    const shifts = week.shifts.filter(s => s.date === date);
                    const cons = week.constraints.filter(c => c.date === date);
                    return (
                        <section key={date} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
                            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                                <h3 className="font-bold text-slate-800">{dayName} <span className="font-normal text-slate-500">{ddmm(date)}</span></h3>
                                <button type="button" onClick={() => setDraft({ date, user_id: week.workers[0]?.id ?? "", start: week.templates[0]?.start ?? "08:00", end: week.templates[0]?.end ?? "14:00", note: "" })}
                                    className="inline-flex items-center gap-1 min-h-9 px-2.5 rounded-lg text-sm font-semibold text-sky-700 hover:bg-sky-50">
                                    <Plus className="w-4 h-4" aria-hidden /> משמרת
                                </button>
                            </div>
                            {cons.length > 0 && (
                                <div className="px-3 pt-2 flex flex-wrap gap-1.5">
                                    {cons.map(c => (
                                        <span key={c.user_id} title={c.note || undefined} className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${KIND[c.kind].cls}`}>
                                            {name(c.user_id)}: {KIND[c.kind].label}{c.note ? " · " + c.note : ""}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <ul className="p-2 space-y-1">
                                {shifts.length === 0 && <li className="px-1 py-1 text-sm text-slate-400">אין משמרות</li>}
                                {shifts.map(s => (
                                    <li key={s.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                                        <button type="button" onClick={() => setDraft({ ...s })} className="flex-1 min-w-0 flex items-center gap-2 text-right">
                                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color(s.user_id) }} aria-hidden />
                                            <span className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-800">{name(s.user_id)}</span>
                                            <span className="text-sm tabular-nums text-slate-600">{s.start}–{s.end}</span>
                                        </button>
                                        <button type="button" onClick={() => remove(s)} aria-label={`מחיקת המשמרת של ${name(s.user_id)}`} className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"><Trash2 className="w-4 h-4" aria-hidden /></button>
                                    </li>
                                ))}
                            </ul>
                            {draft && draft.date === date && (
                                <div className="m-2 mt-0 rounded-xl border border-sky-200 bg-sky-50/40 p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <b className="text-sm text-slate-800">{draft.id ? "שינוי משמרת" : "משמרת חדשה"}</b>
                                        <button type="button" onClick={() => setDraft(null)} aria-label="סגירה" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white"><X className="w-4 h-4" aria-hidden /></button>
                                    </div>
                                    <select value={draft.user_id} onChange={e => setDraft({ ...draft, user_id: e.target.value })} aria-label="עובד/ת"
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm">
                                        {week.workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                    <div className="flex flex-wrap gap-1.5">
                                        {week.templates.map(t => (
                                            <button key={t.name} type="button" onClick={() => setDraft({ ...draft, start: t.start, end: t.end })}
                                                className={`min-h-8 px-2.5 rounded-lg border text-xs font-semibold ${draft.start === t.start && draft.end === t.end ? "border-sky-400 bg-white text-sky-800" : "border-slate-200 bg-white text-slate-600"}`}>
                                                {t.name} {t.start}–{t.end}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="text-xs text-slate-500">התחלה<input type="time" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900" /></label>
                                        <label className="text-xs text-slate-500">סיום<input type="time" value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900" /></label>
                                    </div>
                                    <input value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} maxLength={200} placeholder="הערה (לא חובה)"
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" />
                                    <button type="button" onClick={save} disabled={busy || !draft.user_id}
                                        className="w-full min-h-10 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-50">{busy ? "שומר..." : "שמירה"}</button>
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>

            <ScheduleSettings week={week} open={settingsOpen} setOpen={setSettingsOpen} onSaved={load} />
        </div>
    );
}

function ScheduleSettings({ week, open, setOpen, onSaved }: { week: Week; open: boolean; setOpen: (v: boolean) => void; onSaved: () => void }) {
    const [templates, setTemplates] = useState<Template[]>(week.templates);
    const [day, setDay] = useState(week.deadline_day);
    const [hour, setHour] = useState(week.deadline_hour);
    const save = async () => {
        try {
            await apiFetch("/api/schedule/settings", { method: "PUT", body: JSON.stringify({ templates: templates.filter(t => t.name.trim()), deadline_day: day, deadline_hour: hour }) });
            toast.success("נשמר");
            onSaved();
        } catch (e) { toast.error(e instanceof Error ? e.message : "השמירה נכשלה"); }
    };
    return (
        <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm">
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center gap-2 px-4 py-3 text-right">
                <Settings2 className="w-4 h-4 text-slate-500" aria-hidden />
                <span className="flex-1 font-semibold text-slate-700">משמרות מוכנות ומועד הגשת אילוצים</span>
                <ChevronLeft className={`w-4 h-4 text-slate-400 transition ${open ? "-rotate-90" : ""}`} aria-hidden />
            </button>
            {open && (
                <div className="px-4 pb-4 space-y-3">
                    <div className="space-y-2">
                        {templates.map((t, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <input value={t.name} onChange={e => setTemplates(templates.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} maxLength={30} aria-label="שם המשמרת"
                                    className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                                <input type="time" value={t.start} onChange={e => setTemplates(templates.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} aria-label="התחלה" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                                <input type="time" value={t.end} onChange={e => setTemplates(templates.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} aria-label="סיום" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                                <button type="button" onClick={() => setTemplates(templates.filter((_, j) => j !== i))} aria-label="הסרה" className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"><Trash2 className="w-4 h-4" aria-hidden /></button>
                            </div>
                        ))}
                        {templates.length < 8 && (
                            <button type="button" onClick={() => setTemplates([...templates, { name: "", start: "08:00", end: "16:00" }])} className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700"><Plus className="w-4 h-4" aria-hidden /> משמרת מוכנה</button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                        העובדים מגישים אילוצים לשבוע הבא עד יום
                        <select value={day} onChange={e => setDay(Number(e.target.value))} aria-label="היום" className="rounded-lg border border-slate-200 px-2 py-1.5">
                            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                        </select>
                        בשעה
                        <input type="time" value={hour} onChange={e => setHour(e.target.value)} aria-label="השעה" className="rounded-lg border border-slate-200 px-2 py-1.5" />
                    </div>
                    <button type="button" onClick={save} className="min-h-10 px-4 rounded-xl bg-slate-900 text-white text-sm font-bold">שמירה</button>
                </div>
            )}
        </section>
    );
}
