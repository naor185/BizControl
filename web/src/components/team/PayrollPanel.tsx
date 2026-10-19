"use client";

import { useEffect, useState } from "react";
import BottomSheet from "@/components/ui/bottom-sheet";
import PickerBox from "@/components/ui/picker-box";
import { apiFetch, getPayroll, downloadPayrollPdf, downloadStaffPaySummaryPdf, PayrollSummary, PayrollItem } from "@/lib/api";
import { toast } from "@/lib/toast";
import { FileDown, ChevronLeft, ChevronRight, Wallet, Pencil, Trash2, Plus } from "lucide-react";
import AccountantCard from "@/components/team/AccountantCard";

import { intl, tx } from "@/lib/i18n";
// The team's pay for a month — a list of the workers; a worker opens their months, each with how the sum was made
// (the owner, 2026-10-12: on a phone the wide table was cut off and the dates half hidden). The "שעות ושכר" tab of the
// workers center (app/team — the owner, 2026-10-19), with the month to the accountant (AccountantCard).

type Month = { year: number; month: number };   // month: 1–12

function range(m: Month) {
    const last = new Date(m.year, m.month, 0).getDate();
    const mm = String(m.month).padStart(2, "0");
    return { start: `${m.year}-${mm}-01T00:00:00`, end: `${m.year}-${mm}-${last}T23:59:59` };
}
function shift(m: Month, by: number): Month {
    const d = new Date(m.year, m.month - 1 + by, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
function monthName(m: Month) {
    return new Date(m.year, m.month - 1, 1).toLocaleDateString(intl(), { month: "long", year: "numeric" });
}
const ils = (n: number) => `₪${Number(n || 0).toLocaleString(intl(), { maximumFractionDigits: 2 })}`;
const PAY_TYPE: Record<PayrollItem["pay_type"], { label: string; cls: string }> = {
    hourly: { label: tx("שעתי"), cls: "bg-blue-50 text-blue-700" },
    commission: { label: tx("עמלות"), cls: "bg-purple-50 text-purple-700" },
    global: { label: tx("משכורת קבועה"), cls: "bg-teal-50 text-teal-700" },
    none: { label: tx("ללא שכר מוגדר"), cls: "bg-slate-100 text-slate-500" },
};

function MonthStepper({ value, onChange, max }: { value: Month; onChange: (m: Month) => void; max: Month }) {
    const atMax = value.year === max.year && value.month === max.month;
    return (
        <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => onChange(shift(value, -1))} aria-label={tx("החודש הקודם")}
                className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
                <ChevronRight className="ltr:-scale-x-100 w-5 h-5" aria-hidden />
            </button>
            <div className="text-lg font-black text-slate-900">{monthName(value)}</div>
            <button type="button" onClick={() => onChange(shift(value, 1))} disabled={atMax} aria-label={tx("החודש הבא")}
                className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-30">
                <ChevronLeft className="ltr:-scale-x-100 w-5 h-5" aria-hidden />
            </button>
        </div>
    );
}

export default function PayrollPanel() {
    const today: Month = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    const [month, setMonth] = useState<Month>(today);
    const [payroll, setPayroll] = useState<PayrollSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [pdfLoading, setPdfLoading] = useState(false);
    const [worker, setWorker] = useState<PayrollItem | null>(null);

    useEffect(() => {
        let gone = false;
        setLoading(true);
        const r = range(month);
        getPayroll(r.start, r.end).then(d => { if (!gone) setPayroll(d); }).catch(console.error).finally(() => { if (!gone) setLoading(false); });
        return () => { gone = true; };
    }, [month]);

    const downloadAll = async () => {
        const r = range(month);
        try { setPdfLoading(true); await downloadPayrollPdf(r.start, r.end); } catch (e) { console.error(e); } finally { setPdfLoading(false); }
    };

    return (
        <>
                <div className="max-w-3xl mx-auto space-y-4">
                    <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                        <MonthStepper value={month} onChange={setMonth} max={today} />
                    </div>

                    {loading ? (
                        <div className="h-48 bg-slate-100 animate-pulse rounded-2xl" />
                    ) : !payroll ? null : (
                        <>
                            <div className="bg-zinc-900 text-white p-5 rounded-2xl shadow-lg flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-zinc-400 text-sm font-semibold">{tx("סה״כ שכר לתשלום החודש")}</div>
                                    <div className="text-3xl font-black mt-0.5 tabular-nums">{ils(payroll.grand_total)}</div>
                                </div>
                                <button type="button" onClick={downloadAll} disabled={pdfLoading}
                                    className="shrink-0 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-bold disabled:opacity-50">
                                    <FileDown className="w-4 h-4" aria-hidden /> {pdfLoading ? tx("מוריד...") : tx("PDF לכולם")}
                                </button>
                            </div>

                            <AccountantCard month={month} />

                            {payroll.items.length === 0 ? (
                                <p className="text-center text-slate-400 py-10">{tx("אין עובדים להציג")}</p>
                            ) : (
                                <ul className="space-y-2" aria-label={tx("העובדים")}>
                                    {payroll.items.map(item => (
                                        <li key={item.user_id}>
                                            <button type="button" onClick={() => setWorker(item)}
                                                className="w-full text-start bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3 hover:border-slate-300 transition-colors">
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold text-slate-900 truncate">{item.display_name}</div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                                                        <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${PAY_TYPE[item.pay_type].cls}`}>{PAY_TYPE[item.pay_type].label}</span>
                                                        <span className="tabular-nums">{item.total_hours.toFixed(1)}{tx(" שעות")}</span>
                                                        {item.commission_pay > 0 && <span className="tabular-nums">{tx("עמלות ")}{ils(item.commission_pay)}</span>}
                                                    </div>
                                                </div>
                                                <div className="text-lg font-black text-emerald-600 tabular-nums">{ils(item.total_pay)}</div>
                                                <ChevronLeft className="ltr:-scale-x-100 w-5 h-5 text-slate-300 shrink-0" aria-hidden />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>

                {worker && <WorkerSheet worker={worker} from={month} onClose={() => setWorker(null)} />}
        </>
    );
}

// ── One worker, month by month ───────────────────────────────────────────────────────────────────────────────────────
function WorkerSheet({ worker, from, onClose }: { worker: PayrollItem; from: Month; onClose: () => void }) {
    const MONTHS = 6;
    const [rows, setRows] = useState<{ m: Month; item: PayrollItem | null }[] | null>(null);
    const [open, setOpen] = useState<string>(`${from.year}-${from.month}`);
    const [pdfFor, setPdfFor] = useState<string | null>(null);
    const [changed, setChanged] = useState(0);

    useEffect(() => {
        const months = Array.from({ length: MONTHS }, (_, i) => shift(from, -i));
        Promise.all(months.map(m => {
            const r = range(m);
            return getPayroll(r.start, r.end)
                .then(d => ({ m, item: d.items.find(i => String(i.user_id) === String(worker.user_id)) ?? null }))
                .catch(() => ({ m, item: null }));
        })).then(setRows);
    }, [worker.user_id, from, changed]);

    const pdf = async (m: Month) => {
        const r = range(m), key = `${m.year}-${m.month}`;
        try { setPdfFor(key); await downloadStaffPaySummaryPdf(String(worker.user_id), worker.display_name, r.start, r.end); }
        catch (e) { console.error(e); } finally { setPdfFor(null); }
    };

    return (
        <BottomSheet open onClose={onClose} title={worker.display_name}>
            <div className="space-y-2">
                <p className="text-sm text-slate-500 mb-1">{tx("השכר ב-")}{MONTHS}{tx(" החודשים האחרונים — לחיצה על חודש מציגה איך חושב הסכום.")}</p>
                {!rows ? (
                    <div className="h-40 bg-slate-100 animate-pulse rounded-xl" />
                ) : rows.map(({ m, item }) => {
                    const key = `${m.year}-${m.month}`;
                    const expanded = open === key;
                    return (
                        <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
                            <button type="button" onClick={() => setOpen(expanded ? "" : key)} aria-expanded={expanded}
                                className="w-full flex items-center justify-between gap-3 px-4 min-h-12 bg-white hover:bg-slate-50 text-start">
                                <span className="font-bold text-slate-800">{monthName(m)}</span>
                                <span className="flex items-center gap-2">
                                    <span className="font-black text-emerald-600 tabular-nums">{ils(item?.total_pay ?? 0)}</span>
                                    <ChevronLeft className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? "-rotate-90" : ""}`} aria-hidden />
                                </span>
                            </button>
                            {expanded && (
                                <div className="px-4 pb-4 pt-1 bg-slate-50 text-sm">
                                    {!item ? <p className="text-slate-500 py-2">{tx("אין נתונים לחודש הזה.")}</p> : (
                                        <dl className="divide-y divide-slate-200">
                                            <Row label={tx("סוג שכר")} value={PAY_TYPE[item.pay_type].label} />
                                            <Row label={tx("שעות עבודה")} value={`${item.total_hours.toFixed(1)}`} />
                                            {item.pay_type === "hourly" && <Row label={tx("שכר לפי שעות ({0} לשעה)", { 0: ils(item.hourly_rate) })} value={ils(item.hourly_pay)} />}
                                            {item.pay_type === "global" && <Row label={tx("משכורת קבועה")} value={ils(item.global_salary)} />}
                                            {(item.pay_type === "commission" || item.commission_pay > 0) && <Row label={tx("עמלות ({0}%)", { 0: item.commission_rate })} value={ils(item.commission_pay)} />}
                                            {item.class_pay_mode !== "none" && <Row label={tx("שיעורים ({0} · {1} משתתפים)", { 0: item.class_count, 1: item.class_participants })} value={ils(item.class_pay)} />}
                                            <Row label={tx("סה״כ לתשלום")} value={ils(item.total_pay)} strong />
                                        </dl>
                                    )}
                                    {item && (
                                        <button type="button" onClick={() => pdf(m)} disabled={pdfFor === key}
                                            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                                            <FileDown className="w-4 h-4" aria-hidden /> {pdfFor === key ? tx("מוריד...") : tx("סיכום שכר PDF — כל המשמרות")}
                                        </button>
                                    )}
                                    <Shifts userId={String(worker.user_id)} month={m} onChange={() => setChanged(c => c + 1)} />
                                </div>
                            )}
                        </div>
                    );
                })}
                <p className="flex items-center gap-1.5 text-xs text-slate-400 pt-2"><Wallet className="w-3.5 h-3.5" aria-hidden />{tx(" סוג השכר והתעריפים נקבעים בעריכת העובד/ת במסך הצוות.")}</p>
            </div>
        </BottomSheet>
    );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2">
            <dt className={strong ? "font-bold text-slate-900" : "text-slate-600"}>{label}</dt>
            <dd className={`tabular-nums ${strong ? "font-black text-emerald-700 text-base" : "font-semibold text-slate-800"}`}>{value}</dd>
        </div>
    );
}

// ── A worker's shifts in a month — the owner and the managers fix them (the owner, 2026-10-13: a forgotten clock-in) ──
type Shift = { id: string; start_time: string; end_time: string | null; paid_from?: string | null; hours: number | null; pay: number; fixed: boolean;
    break_minutes?: number; on_break_since?: string | null };
type Draft = { id?: string; date: string; start: string; end: string; brk: string };

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(intl(), { hour: "2-digit", minute: "2-digit" });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Shifts({ userId, month, onChange }: { userId: string; month: Month; onChange: () => void }) {
    const [shifts, setShifts] = useState<Shift[] | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);

    const load = () => {
        const r = range(month);
        apiFetch<Shift[]>(`/api/staff/shifts?user_id=${userId}&start_date=${r.start}&end_date=${r.end}`).then(setShifts).catch(() => setShifts([]));
    };
    useEffect(load, [userId, month.year, month.month]);   // eslint-disable-line react-hooks/exhaustive-deps

    const save = async () => {
        if (!draft) return;
        // an end before the start is the next morning (a night shift)
        const endDate = draft.end && draft.end <= draft.start ? ymd(new Date(new Date(`${draft.date}T12:00`).getTime() + 86400000)) : draft.date;
        const body = { start_time: `${draft.date}T${draft.start}`, end_time: draft.end ? `${endDate}T${draft.end}` : null,
                       break_minutes: Math.max(0, Math.min(720, parseInt(draft.brk) || 0)) };
        setSaving(true);
        try {
            if (draft.id) await apiFetch(`/api/staff/shifts/${draft.id}`, { method: "PATCH", body: JSON.stringify(body) });
            else await apiFetch("/api/staff/shifts", { method: "POST", body: JSON.stringify({ ...body, user_id: userId }) });
            toast.success(draft.id ? tx("המשמרת תוקנה") : tx("המשמרת נוספה"));
            setDraft(null); load(); onChange();
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה"));
        } finally {
            setSaving(false);
        }
    };
    const remove = async (sh: Shift) => {
        if (!confirm(tx("למחוק את המשמרת?"))) return;
        try { await apiFetch(`/api/staff/shifts/${sh.id}`, { method: "DELETE" }); toast.success(tx("המשמרת נמחקה")); load(); onChange(); }
        catch (e) { toast.error((e as Error)?.message || tx("שגיאה")); }
    };
    const edit = (sh: Shift) => setDraft({ id: sh.id, date: ymd(new Date(sh.start_time)), start: hhmm(sh.start_time), end: sh.end_time ? hhmm(sh.end_time) : "",
                                           brk: String(sh.break_minutes || "") });
    const today = ymd(new Date());
    // a forgotten shift of this month — today if it's this month, else its first day
    const firstOfMonth = ymd(new Date(month.year, month.month - 1, 1));
    const newDate = today.slice(0, 7) === firstOfMonth.slice(0, 7) ? today : firstOfMonth;

    return (
        <div className="mt-4">
            <div className="font-bold text-slate-800 mb-2">{tx("משמרות")}</div>
            {!shifts ? <div className="h-16 bg-slate-100 animate-pulse rounded-lg" /> : shifts.length === 0 && !draft ? (
                <p className="text-slate-500 mb-2">{tx("אין משמרות בחודש הזה.")}</p>
            ) : (
                <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white mb-2">
                    {shifts.map(sh => (
                        <li key={sh.id} className="flex items-center gap-2 px-3 py-2">
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-800">
                                    {new Date(sh.start_time).toLocaleDateString(intl(), { weekday: "short", day: "numeric", month: "numeric" })}
                                    {sh.fixed && <span className="ms-2 text-[11px] font-bold text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5">{tx("תוקן ידנית")}</span>}
                                </div>
                                <div className="text-slate-500 tabular-nums">
                                    {hhmm(sh.start_time)}–{sh.end_time ? hhmm(sh.end_time) : tx("עדיין בעבודה")}
                                    {sh.paid_from && <>{tx(" · נספר מ-")}{hhmm(sh.paid_from)}</>}
                                    {!!sh.break_minutes && <>{tx(" · הפסקות ")}{sh.break_minutes}{tx(" דק׳")}</>}
                                    {sh.on_break_since && <span className="text-amber-700 font-semibold">{tx(" · בהפסקה מ-")}{hhmm(sh.on_break_since)}</span>}
                                    {sh.hours != null && <> · {sh.hours.toFixed(1)}{tx(" שעות")}</>}
                                </div>
                            </div>
                            <button type="button" onClick={() => edit(sh)} aria-label={tx("תיקון המשמרת")} className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><Pencil className="w-4 h-4" aria-hidden /></button>
                            <button type="button" onClick={() => remove(sh)} aria-label={tx("מחיקת המשמרת")} className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-rose-50 text-rose-500"><Trash2 className="w-4 h-4" aria-hidden /></button>
                        </li>
                    ))}
                </ul>
            )}
            {draft ? (
                <div className="rounded-xl border border-sky-200 bg-white p-3 space-y-2">
                    <div className="font-semibold text-slate-800">{draft.id ? tx("תיקון משמרת") : tx("משמרת שנשכחה")}</div>
                    <PickerBox type="date" label={tx("יום המשמרת")} value={draft.date} max={today} clearable={false}
                        onChange={v => setDraft(d => d && { ...d, date: v })} className="rounded-lg border border-slate-200 px-3 py-2.5" />
                    <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0"><div className="text-xs text-slate-500 mb-1">{tx("כניסה")}</div>
                            <PickerBox type="time" label={tx("שעת כניסה")} value={draft.start} onChange={v => setDraft(d => d && { ...d, start: v })} className="rounded-lg border border-slate-200 px-2 py-2.5 font-semibold" /></div>
                        <div className="min-w-0"><div className="text-xs text-slate-500 mb-1">{tx("יציאה (ריק = עדיין בעבודה)")}</div>
                            <PickerBox type="time" label={tx("שעת יציאה")} value={draft.end} onChange={v => setDraft(d => d && { ...d, end: v })} className="rounded-lg border border-slate-200 px-2 py-2.5 font-semibold" /></div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600">{tx("הפסקות")}
                        <input type="number" inputMode="numeric" min={0} max={720} value={draft.brk} placeholder="0"
                            onChange={e => setDraft(d => d && { ...d, brk: e.target.value })}
                            className="w-20 rounded-lg border border-slate-200 px-2 py-2 text-center tabular-nums" />{tx(" דקות (לא נספרות)")}</label>
                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={save} disabled={saving || !draft.date || !draft.start}
                            className="flex-1 min-h-11 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold disabled:opacity-50">{saving ? tx("שומר...") : tx("שמירה")}</button>
                        <button type="button" onClick={() => setDraft(null)} className="min-h-11 px-4 rounded-xl border border-slate-200 text-slate-700 font-semibold">{tx("ביטול")}</button>
                    </div>
                </div>
            ) : (
                <button type="button" onClick={() => setDraft({ date: newDate, start: "09:00", end: "17:00", brk: "" })}
                    className="w-full inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl border border-dashed border-slate-300 bg-white text-sm font-bold text-slate-700 hover:bg-slate-100">
                    <Plus className="w-4 h-4" aria-hidden /> {tx("הוספת משמרת שנשכחה")}
                </button>
            )}
        </div>
    );
}
