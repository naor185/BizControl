"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, CalendarClock, Check, Lock, Plane, X } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { STATUS, type StaffRequest } from "@/components/team/RequestsPanel";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// A worker's own screen for the shift schedule (app/services/schedule.py — the owner, 2026-10-19): their shifts this week
// and next (once published) — each can be offered to a colleague (a swap — services/staff_requests); their constraints
// for next week until the deadline; asking for time off; a colleague's swap asked of them; their own requests.

type Shift = { id: string; date: string; start: string; end: string; note: string };
type Constraint = { date: string; kind: "off" | "morning" | "evening"; note: string };
type Week = { week_start: string; published_at: string | null; deadline: string; can_send: boolean; shifts: Shift[]; constraints: Constraint[] };
type Colleague = { id: string; name: string; shifts: { id: string; words: string }[] };
type Lists = { mine: StaffRequest[]; to_me: StaffRequest[] };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const CHOICES: { kind: "" | Constraint["kind"]; label: string }[] = [
    { kind: "", label: "יכול/ה" }, { kind: "off", label: "לא יכול/ה" }, { kind: "morning", label: "רק בוקר" }, { kind: "evening", label: "רק ערב" },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const thisSunday = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return ymd(d); };
const card = "bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden";
const errText = (e: unknown) => (e instanceof Error ? e.message : "הפעולה נכשלה");

function SwapForm({ shift, onDone }: { shift: Shift; onDone: () => void }) {
    const [list, setList] = useState<Colleague[] | null>(null);
    const [who, setWho] = useState("");
    const [trade, setTrade] = useState("");
    const [note, setNote] = useState("");
    useEffect(() => {
        apiFetch<Colleague[]>(`/api/requests/colleagues?shift_id=${shift.id}`).then(l => { setList(l); setWho(l[0]?.id ?? ""); })
            .catch(e => { toast.error(errText(e)); onDone(); });
    }, [shift.id, onDone]);
    const send = async () => {
        try {
            await apiFetch("/api/requests/swap", { method: "POST", body: JSON.stringify({ shift_id: shift.id, target_user_id: who, target_shift_id: trade || null, note }) });
            toast.success("הבקשה נשלחה לעמית/ה — אחרי שיסכים/תסכים, בעל העסק מאשר");
            onDone();
        } catch (e) { toast.error(errText(e)); }
    };
    if (!list) return <p className="px-4 pb-3 text-sm text-slate-500">טוען…</p>;
    const theirs = list.find(c => c.id === who)?.shifts ?? [];
    return (
        <div className="mx-4 mb-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3 space-y-2">
            <label className="block text-xs text-slate-600">מי ייקח/תיקח את המשמרת
                <select value={who} onChange={e => { setWho(e.target.value); setTrade(""); }} className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm">
                    {list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </label>
            {theirs.length > 0 && (
                <label className="block text-xs text-slate-600">בתמורה למשמרת שלו/ה (לא חובה)
                    <select value={trade} onChange={e => setTrade(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm">
                        <option value="">בלי — רק מחליף/ה אותי</option>
                        {theirs.map(s => <option key={s.id} value={s.id}>{s.words}</option>)}
                    </select>
                </label>
            )}
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="סיבה (לא חובה)" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" />
            <div className="flex gap-2">
                <button type="button" onClick={send} disabled={!who} className="flex-1 min-h-10 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-50">שליחת הבקשה</button>
                <button type="button" onClick={onDone} className="min-h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-600">ביטול</button>
            </div>
        </div>
    );
}

function ShiftsOf({ week, title, onAsked }: { week: Week | null; title: string; onAsked: () => void }) {
    const [swapping, setSwapping] = useState<string | null>(null);
    const [now] = useState(() => Date.now());
    const done = useCallback(() => { setSwapping(null); onAsked(); }, [onAsked]);
    if (!week) return <div className="h-24 bg-white/60 animate-pulse rounded-2xl" />;
    return (
        <section className={card}>
            <h2 className="px-4 py-3 border-b border-slate-100 font-bold text-slate-800">{title} <span className="font-normal text-slate-500">{ddmm(week.week_start)}–{ddmm(addDays(week.week_start, 6))}</span></h2>
            {!week.published_at ? <p className="px-4 py-3 text-sm text-slate-500">הסידור לשבוע הזה עוד לא פורסם.</p>
                : week.shifts.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">אין לך משמרות בשבוע הזה.</p> : (
                <ul className="divide-y divide-slate-100">
                    {week.shifts.map(s => (
                        <li key={s.id}>
                            <div className="flex items-center gap-3 px-4 py-2.5">
                                <span className="flex-1 font-semibold text-slate-800">יום {DAYS[new Date(`${s.date}T12:00:00`).getDay()]} <span className="font-normal text-slate-500">{ddmm(s.date)}</span>
                                    {s.note && <span className="block text-xs font-normal text-slate-500">{s.note}</span>}</span>
                                <span className="tabular-nums font-bold text-sky-700">{s.start}–{s.end}</span>
                                {new Date(`${s.date}T${s.start}:00`).getTime() > now && swapping !== s.id && (
                                    <button type="button" onClick={() => setSwapping(s.id)} aria-label="בקשת החלפה"
                                        className="inline-flex items-center gap-1 min-h-9 px-2 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                                        <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden /> החלפה
                                    </button>
                                )}
                            </div>
                            {swapping === s.id && <SwapForm shift={s} onDone={done} />}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function TimeOffForm({ onDone }: { onDone: () => void }) {
    const today = ymd(new Date());
    const [kind, setKind] = useState<"vacation" | "sick" | "other">("vacation");
    const [from, setFrom] = useState(today);
    const [to, setTo] = useState(today);
    const [note, setNote] = useState("");
    const send = async () => {
        try {
            await apiFetch("/api/requests/time-off", { method: "POST", body: JSON.stringify({ kind, date_from: from, date_to: to < from ? from : to, note }) });
            toast.success("הבקשה נשלחה לבעל העסק");
            onDone();
        } catch (e) { toast.error(errText(e)); }
    };
    return (
        <div className="p-4 space-y-2">
            <div className="flex gap-1.5" role="radiogroup" aria-label="סוג">
                {([["vacation", "חופשה"], ["sick", "מחלה"], ["other", "אחר"]] as const).map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                        className={`min-h-9 px-3 rounded-xl border text-sm font-semibold ${kind === k ? "border-sky-600 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-600"}`}>{l}</button>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-500">מתאריך<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900" /></label>
                <label className="text-xs text-slate-500">עד תאריך<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900" /></label>
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="הערה (לא חובה)" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            <button type="button" onClick={send} className="w-full min-h-10 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold">שליחה לבעל העסק</button>
        </div>
    );
}

function Requests({ lists, reload }: { lists: Lists | null; reload: () => void }) {
    const [asking, setAsking] = useState(false);
    const act = async (path: string, body?: object) => {
        try { await apiFetch(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }); reload(); }
        catch (e) { toast.error(errText(e)); }
    };
    if (!lists) return null;
    return (
        <>
            {lists.to_me.length > 0 && (
                <section className={card}>
                    <h2 className="px-4 py-3 border-b border-slate-100 font-bold text-slate-800">מבקשים ממך להחליף</h2>
                    <ul className="divide-y divide-slate-100">
                        {lists.to_me.map(r => (
                            <li key={r.id} className="px-4 py-3 space-y-2">
                                <div className="text-sm text-slate-700"><b>{r.name}</b>: {r.summary}{r.note && <span className="text-slate-500"> — &quot;{r.note}&quot;</span>}</div>
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => act(`/api/requests/${r.id}/answer`, { accept: true })} className="inline-flex items-center gap-1 min-h-10 px-3 rounded-xl bg-emerald-600 text-white text-sm font-bold"><Check className="w-4 h-4" aria-hidden /> מסכים/ה</button>
                                    <button type="button" onClick={() => act(`/api/requests/${r.id}/answer`, { accept: false })} className="inline-flex items-center gap-1 min-h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700"><X className="w-4 h-4" aria-hidden /> לא יכול/ה</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            <section className={card}>
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                    <h2 className="flex-1 font-bold text-slate-800">הבקשות שלי</h2>
                    {!asking && <button type="button" onClick={() => setAsking(true)} className="inline-flex items-center gap-1 min-h-9 px-3 rounded-lg text-sm font-semibold text-sky-700 hover:bg-sky-50"><Plane className="w-4 h-4" aria-hidden /> חופשה / מחלה</button>}
                </div>
                {asking && <TimeOffForm onDone={() => { setAsking(false); reload(); }} />}
                {lists.mine.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">אין בקשות.</p> : (
                    <ul className="divide-y divide-slate-100">
                        {lists.mine.map(r => (
                            <li key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
                                <span className="flex-1 min-w-0 text-slate-700">{r.summary}{r.kind === "swap" && r.target_name && <> · {r.target_name}</>}
                                    {r.decision_note && <span className="block text-xs text-slate-500">{r.decision_note}</span>}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[r.status]?.cls}`}>{STATUS[r.status]?.label}</span>
                                {(r.status === "waiting_colleague" || r.status === "waiting_owner") && (
                                    <button type="button" onClick={() => act(`/api/requests/${r.id}/cancel`)} className="text-xs font-semibold text-slate-500 underline">ביטול</button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </>
    );
}

function MyShifts() {
    const [now, setNow] = useState<Week | null>(null);
    const [next, setNext] = useState<Week | null>(null);
    const [lists, setLists] = useState<Lists | null>(null);
    const nextStart = addDays(thisSunday(), 7);

    const load = useCallback(() => {
        apiFetch<Week>(`/api/schedule/week?start=${thisSunday()}`).then(setNow).catch(() => {});
        apiFetch<Week>(`/api/schedule/week?start=${nextStart}`).then(setNext).catch(() => {});
        apiFetch<Lists>("/api/requests").then(setLists).catch(() => {});
    }, [nextStart]);
    useEffect(() => { load(); }, [load]);

    const setConstraint = async (date: string, kind: string, note = "") => {
        try {
            await apiFetch("/api/schedule/constraints", { method: "PUT", body: JSON.stringify({ date, kind, note }) });
            load();
        } catch (e) { toast.error(errText(e)); }
    };
    const due = next ? new Date(next.deadline) : null;

    return (
        <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-4">
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><CalendarClock className="w-6 h-6 text-sky-600" aria-hidden /> המשמרות שלי</h1>
            <ShiftsOf week={now} title="השבוע" onAsked={load} />
            <ShiftsOf week={next} title="השבוע הבא" onAsked={load} />
            <Requests lists={lists} reload={load} />

            {next && (
                <section className={card}>
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
