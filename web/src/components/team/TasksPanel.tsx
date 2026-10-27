"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardList, Plus, Repeat, Trash2, User, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toLocalDateStr } from "@/lib/format";
import { toast } from "@/lib/toast";

import { tx, intl } from "@/lib/i18n";
// The "משימות" tab of the workers center (the owner, 2026-10-27: "in the workers center — make tasks for the workers,
// shared or personal, with alerts"). The calendar's own tasks (app/api/task_routes, services/team_tasks): a personal
// task reaches that worker at once — a push, or WhatsApp without the app — they're reminded every morning until it's
// marked done, and you hear when it is; a shared task is the whole team's. Here: what's late, what's open, what was
// done in the last two weeks — by worker — and a new task.

type Instance = {
    id: string; title: string; date: string; start_time: string | null; end_time: string | null; notes: string | null;
    is_recurring: boolean; assignee_id: string | null; assignee_name: string | null; done: boolean; overdue: boolean;
    kind: string;
};
type Member = { id: string; display_name?: string | null; email?: string | null; role: string; is_active?: boolean };

const BACK_DAYS = 14;
const AHEAD_DAYS = 30;

export default function TasksPanel() {
    const [items, setItems] = useState<Instance[] | null>(null);
    const [team, setTeam] = useState<Member[]>([]);
    const [who, setWho] = useState<string>("all");                 // the list's filter: all | team | a worker's id
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    // a new task
    const today = toLocalDateStr(new Date());
    const [title, setTitle] = useState("");
    const [assignee, setAssignee] = useState<string>("");          // "" — the whole team
    const [date, setDate] = useState(today);
    const [start, setStart] = useState("");
    const [end, setEnd] = useState("");
    const [notes, setNotes] = useState("");
    const [repeat, setRepeat] = useState<"none" | "weekly" | "monthly">("none");
    const [locks, setLocks] = useState(false);

    const load = useCallback(() => {
        const from = new Date(); from.setDate(from.getDate() - BACK_DAYS);
        const to = new Date(); to.setDate(to.getDate() + AHEAD_DAYS);
        apiFetch<Instance[]>(`/api/tasks?from_date=${toLocalDateStr(from)}&to_date=${toLocalDateStr(to)}`)
            .then(r => setItems(r.filter(t => t.kind === "task")))
            .catch(() => setItems([]));
    }, []);
    useEffect(() => {
        load();
        apiFetch<Member[]>("/api/users/artists").then(m => setTeam(m.filter(x => x.is_active !== false))).catch(() => setTeam([]));
    }, [load]);

    const nameOf = (m: Member) => m.display_name || m.email || "";
    const shown = useMemo(() => (items ?? []).filter(t =>
        who === "all" || (who === "team" ? !t.assignee_id : t.assignee_id === who)), [items, who]);
    // late — a personal task past its time (the server's own mark); a shared one has no one to chase (services/team_tasks)
    const late = shown.filter(t => !t.done && t.overdue);
    const ahead = shown.filter(t => !t.done && !t.overdue && t.date >= today);
    const done = shown.filter(t => t.done).reverse();

    const create = async () => {
        if (!title.trim()) { toast.error(tx("כתבו מה המשימה")); return; }
        if (end && !start) { toast.error(tx("שעת סיום בלי שעת התחלה")); return; }
        const day = new Date(date + "T12:00:00");
        setBusy("new");
        try {
            await apiFetch("/api/tasks", {
                method: "POST", body: JSON.stringify({
                    title: title.trim(), task_date: date, start_time: start || null, end_time: end || null,
                    notes: notes.trim() || null, assignee_id: assignee || null, kind: "task",
                    blocks_booking: !!start && !!end && locks,
                    recurrence_type: repeat,
                    recurrence_days_of_week: repeat === "weekly" ? String(day.getDay()) : null,
                    recurrence_day: repeat === "monthly" ? day.getDate() : null,
                }),
            });
            const person = team.find(m => m.id === assignee);
            toast.success(person ? tx("המשימה נשלחה ל{0} — הוא/היא קיבל/ה התראה", { 0: nameOf(person) }) : tx("המשימה נוספה לכל הצוות"));
            setTitle(""); setNotes(""); setStart(""); setEnd(""); setRepeat("none"); setLocks(false); setOpen(false);
            load();
        } catch (e) { toast.error(e instanceof Error ? e.message : tx("הפעולה נכשלה")); }
        finally { setBusy(null); }
    };

    const markDone = async (t: Instance) => {
        setBusy(t.id + t.date);
        try {
            if (t.done) await apiFetch(`/api/tasks/${t.id}/done?date=${t.date}`, { method: "DELETE" });
            else await apiFetch(`/api/tasks/${t.id}/done`, { method: "POST", body: JSON.stringify({ date: t.date }) });
            load();
        } catch (e) { toast.error(e instanceof Error ? e.message : tx("הפעולה נכשלה")); }
        finally { setBusy(null); }
    };

    const remove = async (t: Instance) => {
        if (!confirm(t.is_recurring ? tx("למחוק את המשימה החוזרת — את כל הפעמים שלה?") : tx("למחוק את המשימה?"))) return;
        setBusy(t.id + t.date);
        try {
            await apiFetch(`/api/tasks/${t.id}`, { method: "DELETE" });
            toast.success(tx("המשימה נמחקה"));
            load();
        } catch (e) { toast.error(e instanceof Error ? e.message : tx("הפעולה נכשלה")); }
        finally { setBusy(null); }
    };

    const when = (t: Instance) => {
        const d = new Date(t.date + "T12:00:00").toLocaleDateString(intl(), { weekday: "short", day: "numeric", month: "numeric" });
        return t.start_time ? `${d} · ${t.start_time}${t.end_time ? `–${t.end_time}` : ""}` : d;
    };

    const row = (t: Instance, tone: "late" | "open" | "done") => (
        <li key={t.id + t.date} className="px-4 py-3 flex items-start gap-3">
            <button type="button" onClick={() => markDone(t)} disabled={busy === t.id + t.date}
                aria-label={t.done ? tx("לא בוצעה") : tx("בוצעה")}
                className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition ${t.done
                    ? "bg-emerald-500 border-emerald-500 text-white" : tone === "late" ? "border-rose-400 hover:bg-rose-50" : "border-slate-300 hover:bg-slate-50"}`}>
                {t.done && <Check className="w-3.5 h-3.5" aria-hidden />}
            </button>
            <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold ${t.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                        {t.assignee_id ? <User className="w-3.5 h-3.5" aria-hidden /> : <Users className="w-3.5 h-3.5" aria-hidden />}
                        {t.assignee_name || tx("כל הצוות")}
                    </span>
                    <span className={tone === "late" ? "text-rose-600 font-semibold" : ""}>{when(t)}</span>
                    {t.is_recurring && <span className="inline-flex items-center gap-1"><Repeat className="w-3.5 h-3.5" aria-hidden />{tx("חוזרת")}</span>}
                </div>
                {t.notes && <p className="mt-1 text-xs text-slate-500 whitespace-pre-line">{t.notes}</p>}
            </div>
            <button type="button" onClick={() => remove(t)} disabled={busy === t.id + t.date} aria-label={tx("מחיקה")}
                className="p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition shrink-0">
                <Trash2 className="w-4 h-4" aria-hidden />
            </button>
        </li>
    );

    const block = (head: string, list: Instance[], tone: "late" | "open" | "done", empty: string) => (
        <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
            <h3 className={`px-4 py-3 border-b border-slate-100 font-bold ${tone === "late" ? "text-rose-700" : "text-slate-800"}`}>
                {head} ({list.length})
            </h3>
            {list.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">{empty}</p>
                : <ul className="divide-y divide-slate-100">{list.map(t => row(t, tone))}</ul>}
        </section>
    );

    const field = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-600";
    if (!items) return <div className="h-40 bg-white/60 animate-pulse rounded-2xl" />;
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setOpen(o => !o)}
                    className="inline-flex items-center gap-1.5 min-h-10 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold transition">
                    <Plus className="w-4 h-4" aria-hidden />{tx("משימה חדשה")}
                </button>
                <label className="sr-only" htmlFor="tasks-who">{tx("של מי")}</label>
                <select id="tasks-who" value={who} onChange={e => setWho(e.target.value)}
                    className="min-h-10 bg-white border border-slate-200 rounded-xl px-3 text-sm">
                    <option value="all">{tx("כל המשימות")}</option>
                    <option value="team">{tx("משותפות לכל הצוות")}</option>
                    {team.map(m => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
                </select>
            </div>

            {open && (
                <section className="bg-white rounded-2xl border border-sky-200 shadow-sm p-4 space-y-3">
                    <h3 className="flex items-center gap-2 font-bold text-slate-800"><ClipboardList className="w-5 h-5 text-sky-600" aria-hidden />{tx("משימה חדשה")}</h3>
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder={tx("מה צריך לעשות?")} className={field} maxLength={200} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block text-xs font-semibold text-slate-600">{tx("למי")}
                            <select value={assignee} onChange={e => setAssignee(e.target.value)} className={`${field} mt-1`}>
                                <option value="">{tx("לכל הצוות (משותפת)")}</option>
                                {team.map(m => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
                            </select>
                        </label>
                        <label className="block text-xs font-semibold text-slate-600">{tx("תאריך")}
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${field} mt-1`} />
                        </label>
                        <label className="block text-xs font-semibold text-slate-600">{tx("משעה (לא חובה)")}
                            <input type="time" value={start} onChange={e => setStart(e.target.value)} className={`${field} mt-1`} />
                        </label>
                        <label className="block text-xs font-semibold text-slate-600">{tx("עד שעה (לא חובה)")}
                            <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={`${field} mt-1`} />
                        </label>
                        <label className="block text-xs font-semibold text-slate-600">{tx("חוזרת")}
                            <select value={repeat} onChange={e => setRepeat(e.target.value as typeof repeat)} className={`${field} mt-1`}>
                                <option value="none">{tx("פעם אחת")}</option>
                                <option value="weekly">{tx("כל שבוע באותו יום")}</option>
                                <option value="monthly">{tx("כל חודש באותו תאריך")}</option>
                            </select>
                        </label>
                    </div>
                    {start && end && (
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" checked={locks} onChange={e => setLocks(e.target.checked)} />
                            {tx("לא לקבוע תורים בשעות האלה")}
                        </label>
                    )}
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={tx("פרטים (לא חובה)")} className={field} />
                    <p className="text-xs text-slate-500">
                        {assignee ? tx("העובד/ת יקבל/ה התראה מיד, ותזכורת כל בוקר עד שיסמן/תסמן שבוצעה — ואתה תשמע כשזה נעשה.")
                            : tx("משימה משותפת מופיעה ביומן של כל הצוות.")}
                    </p>
                    <div className="flex gap-2">
                        <button type="button" onClick={create} disabled={busy === "new"}
                            className="min-h-10 px-5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold transition disabled:opacity-60">
                            {busy === "new" ? tx("שומר...") : tx("שמירה ושליחה")}
                        </button>
                        <button type="button" onClick={() => setOpen(false)} className="min-h-10 px-4 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">{tx("ביטול")}</button>
                    </div>
                </section>
            )}

            {block(tx("באיחור"), late, "late", tx("אין משימות באיחור."))}
            {block(tx("פתוחות"), ahead, "open", tx("אין משימות פתוחות — אפשר להוסיף למעלה."))}
            {block(tx("בוצעו בשבועיים האחרונים"), done, "done", tx("עוד לא סומנו משימות כבוצעו."))}
        </div>
    );
}
