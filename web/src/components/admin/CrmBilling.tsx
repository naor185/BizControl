"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, MessageCircle, Plus, Undo2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatCurrency, whatsappNumber } from "@/lib/format";

// The businesses' payments to BizControl — the superadmin's CRM, part ג (app/services/platform_billing.py,
// /api/admin/crm/billing|payments|payment-options). Until card clearing is connected a payment is recorded by hand,
// and it extends the business's period: monthly one month, annual twelve.

type Collect = {
    id: string; name: string; owner_name: string; owner_phone: string | null; plan_id: string; plan_label: string;
    days_left: number; state: "due_soon" | "overdue" | "trial_ending" | "trial_ended"; cycle: Cycle; amount_ils: number;
};
type Overview = { monthly_ils: number; received_this_month_ils: number; due_soon_ils: number; overdue_ils: number; collect: Collect[] };
type Payment = {
    id: string; studio_id: string; studio_name: string; plan_label: string; cycle: Cycle; amount_ils: number;
    method: string; paid_at: string | null; period_end: string | null; note: string | null;
    undone_at: string | null; can_undo: boolean;      // undoing — the business's last payment only
};
type Options = { plans: { id: string; label: string; monthly_ils: number; annual_ils: number }[]; methods: Record<string, string> };
type Cycle = "monthly" | "annual";
export type PayFor = { id: string; name: string; plan_id?: string; cycle?: Cycle };

const STATE: Record<Collect["state"], { label: string; cls: string }> = {
    due_soon:     { label: "מגיע תשלום",       cls: "bg-amber-50 text-amber-800 border-amber-200" },
    overdue:      { label: "באיחור",            cls: "bg-rose-50 text-rose-700 border-rose-200" },
    trial_ending: { label: "חודש חינם נגמר",    cls: "bg-slate-50 text-slate-700 border-slate-200" },
    trial_ended:  { label: "לא בחר מסלול",      cls: "bg-rose-50 text-rose-700 border-rose-200" },
};
const CYCLE: Record<Cycle, string> = { monthly: "חודשי", annual: "שנתי" };
const input = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-slate-300";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("he-IL") : "—");
const today = () => new Date().toLocaleDateString("en-CA");      // yyyy-mm-dd, the local day

function when(c: Collect): string {
    const n = Math.abs(c.days_left);
    if (c.days_left < 0) return n === 1 ? "נגמר אתמול" : `נגמר לפני ${n} ימים`;
    return c.days_left === 0 ? "נגמר היום" : n === 1 ? "נגמר מחר" : `נגמר בעוד ${n} ימים`;
}

export function RecordPayment({ business, onClose, onSaved }: { business: PayFor; onClose: () => void; onSaved: () => void }) {
    const [opts, setOpts] = useState<Options | null>(null);
    const [planId, setPlanId] = useState(business.plan_id ?? "");
    const [cycle, setCycle] = useState<Cycle>(business.cycle ?? "monthly");
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState("bank");
    const [paidOn, setPaidOn] = useState(today);
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [until, setUntil] = useState<string | null>(null);

    // the price of the plan and cycle chosen; the superadmin can change the amount (a discount, a partial month)
    const priceOf = useCallback((o: Options | null, id: string, c: Cycle) => {
        const p = o?.plans.find(x => x.id === id);
        return p ? String(c === "annual" ? p.annual_ils : p.monthly_ils) : "";
    }, []);

    useEffect(() => {
        apiFetch<Options>("/api/admin/crm/payment-options").then(o => {
            setOpts(o);
            const id = o.plans.some(p => p.id === business.plan_id) ? business.plan_id! : (o.plans[0]?.id ?? "");
            setPlanId(id);
            setAmount(priceOf(o, id, business.cycle ?? "monthly"));
        }).catch(e => setErr(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, [business.plan_id, business.cycle, priceOf]);

    const choose = (id: string, c: Cycle) => { setPlanId(id); setCycle(c); setAmount(priceOf(opts, id, c)); };
    const save = async () => {
        setSaving(true); setErr(null);
        try {
            const r = await apiFetch<{ period_end: string }>("/api/admin/crm/payments", {
                method: "POST",
                body: JSON.stringify({ studio_id: business.id, plan_id: planId, cycle, amount_ils: Number(amount), method, paid_on: paidOn, note }),
            });
            setUntil(r.period_end);
            onSaved();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "הרישום נכשל");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[90dvh] flex flex-col shadow-xl" dir="rtl">
                <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100">
                    <div>
                        <h3 className="font-black text-lg text-slate-900">רישום תשלום</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{business.name}</p>
                    </div>
                    <button onClick={onClose} aria-label="סגירה" className="text-slate-400 hover:text-slate-900"><X className="h-5 w-5" /></button>
                </div>

                {until ? (
                    <div className="p-6 space-y-4">
                        <div className="flex items-center gap-2 text-emerald-700 font-bold"><Check className="h-5 w-5" /> התשלום נרשם</div>
                        <p className="text-sm text-slate-700">המנוי של {business.name} בתוקף עד <b>{day(until)}</b>.</p>
                        <button onClick={onClose} className="w-full bg-slate-900 text-white font-bold py-2.5 rounded-xl">סגירה</button>
                    </div>
                ) : (
                    <>
                        <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4 space-y-4">
                            {!opts && !err && <p className="text-center text-slate-400 py-6">טוען...</p>}
                            {opts && <>
                                <div>
                                    <p className="text-xs font-semibold text-slate-500 mb-1.5">מסלול</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {opts.plans.map(p => (
                                            <button key={p.id} type="button" onClick={() => choose(p.id, cycle)} aria-pressed={planId === p.id}
                                                className={`py-2 rounded-xl text-sm font-semibold border ${planId === p.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"}`}>
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-slate-500 mb-1.5">על איזו תקופה</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {(["monthly", "annual"] as Cycle[]).map(c => (
                                            <button key={c} type="button" onClick={() => choose(planId, c)} aria-pressed={cycle === c}
                                                className={`py-2 rounded-xl text-sm font-semibold border ${cycle === c ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"}`}>
                                                {c === "monthly" ? "חודש" : "שנה (12 חודשים)"}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className="block">
                                        <span className="text-xs font-semibold text-slate-500">סכום ששולם (₪)</span>
                                        <input type="number" min={0} step="1" inputMode="decimal" className={`${input} mt-1 tabular-nums`} value={amount} onChange={e => setAmount(e.target.value)} />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-semibold text-slate-500">תאריך התשלום</span>
                                        <input type="date" className={`${input} mt-1`} value={paidOn} max={today()} onChange={e => setPaidOn(e.target.value)} />
                                    </label>
                                </div>
                                <label className="block">
                                    <span className="text-xs font-semibold text-slate-500">איך שילם</span>
                                    <select className={`${input} mt-1`} value={method} onChange={e => setMethod(e.target.value)}>
                                        {Object.entries(opts.methods).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="text-xs font-semibold text-slate-500">הערה (לא חובה)</span>
                                    <input className={`${input} mt-1`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="למשל: מספר אסמכתא" />
                                </label>
                                <p className="text-xs text-slate-500">המנוי יוארך ב{cycle === "annual" ? "-12 חודשים" : "חודש"} — מהיום, או מסוף התקופה הנוכחית אם עוד לא נגמרה.</p>
                            </>}
                            {err && <p className="text-sm text-rose-600">{err}</p>}
                        </div>
                        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
                            <button onClick={save} disabled={saving || !opts || !planId || amount === "" || Number(amount) < 0}
                                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl disabled:opacity-40">
                                {saving ? "רושם..." : "רישום והארכת המנוי"}
                            </button>
                            <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm">ביטול</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export function CrmPayments({ studioId, reload = 0, onChanged }: { studioId?: string; reload?: number; onChanged?: () => void }) {
    const [rows, setRows] = useState<Payment[] | null>(null);
    const [undone, setUndone] = useState(0);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<Payment[]>(`/api/admin/crm/payments${studioId ? `?studio_id=${studioId}` : ""}`).then(setRows).catch(() => setRows([]));
    }, [studioId, reload, undone]);

    const undo = async (p: Payment) => {
        if (!window.confirm(`לבטל את התשלום של ${p.studio_name} (${formatCurrency(p.amount_ils)})? המנוי יחזור לתאריך שהיה לפניו.`)) return;
        setErr(null);
        try {
            await apiFetch(`/api/admin/crm/payments/${p.id}/undo`, { method: "POST" });
            setUndone(n => n + 1);
            onChanged?.();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "הביטול נכשל");
        }
    };

    const box = "bg-white border border-slate-200 rounded-2xl";
    if (rows === null) return <p className={`${box} text-center text-sm text-slate-400 py-8`}>טוען...</p>;
    if (rows.length === 0) return <p className={`${box} text-center text-sm text-slate-400 py-8`}>עוד לא נרשמו תשלומים{studioId ? " מהעסק הזה" : ""}</p>;
    return (
        <div className={`${box} overflow-x-auto`}>
            {err && <p className="px-4 pt-3 text-sm text-rose-600">{err}</p>}
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-slate-500 border-b border-slate-100">
                        {["תאריך", ...(studioId ? [] : ["עסק"]), "מסלול", "סכום", "איך שילם", "בתוקף עד", "הערה", ""].map(h => (
                            <th key={h} className="text-right font-semibold px-4 py-3 whitespace-nowrap">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(p => (
                        <tr key={p.id} className={`border-b border-slate-50 last:border-0 ${p.undone_at ? "opacity-50 line-through" : ""}`}>
                            <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-600">{day(p.paid_at)}</td>
                            {!studioId && <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{p.studio_name}</td>}
                            <td className="px-4 py-3 whitespace-nowrap text-slate-700">{p.plan_label} · {CYCLE[p.cycle]}</td>
                            <td className="px-4 py-3 whitespace-nowrap tabular-nums font-semibold text-slate-900">{formatCurrency(p.amount_ils)}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-slate-600">{p.method}</td>
                            <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-600">{day(p.period_end)}</td>
                            <td className="px-4 py-3 text-slate-500">{p.note ?? ""}</td>
                            <td className="px-4 py-3 text-left whitespace-nowrap">
                                {p.undone_at ? <span className="text-xs text-slate-500 no-underline">בוטל</span>
                                    : p.can_undo && (
                                        <button onClick={() => undo(p)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600">
                                            <Undo2 className="h-3.5 w-3.5" aria-hidden /> ביטול רישום
                                        </button>
                                    )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function CrmBilling() {
    const [data, setData] = useState<Overview | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [paying, setPaying] = useState<PayFor | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        apiFetch<Overview>("/api/admin/crm/billing").then(d => { setData(d); setErr(null); })
            .catch(e => setErr(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, [reload]);

    if (!data) return err ? <p className="text-sm text-rose-600">{err}</p> : <p className="text-center text-slate-400 py-12">טוען...</p>;
    const dueSoon = data.collect.filter(c => c.state === "due_soon").length;
    const overdue = data.collect.filter(c => c.state === "overdue").length;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                    { label: "צפי הכנסה חודשי", value: formatCurrency(data.monthly_ils), sub: "מנויים פעילים, שנתי מחולק ל-12" },
                    { label: "התקבל החודש", value: formatCurrency(data.received_this_month_ils), tone: "text-emerald-700" },
                    { label: "מגיע ב-7 הימים הקרובים", value: formatCurrency(data.due_soon_ils), sub: `${dueSoon} עסקים`, tone: dueSoon ? "text-amber-700" : undefined },
                    { label: "באיחור", value: formatCurrency(data.overdue_ils), sub: `${overdue} עסקים`, tone: overdue ? "text-rose-700" : undefined },
                ].map(t => (
                    <div key={t.label} className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
                        <div className={`text-2xl font-black tabular-nums ${t.tone ?? "text-slate-900"}`}>{t.value}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{t.label}{t.sub ? ` · ${t.sub}` : ""}</div>
                    </div>
                ))}
            </div>

            <section className="space-y-2">
                <h2 className="font-bold text-slate-900">לגבייה</h2>
                <p className="text-xs text-slate-500">עסקים שהמנוי שלהם נגמר בשבוע הקרוב או נגמר בחודש האחרון בלי תשלום, וחודש חינם שנגמר. עסק שביטל בסוף התקופה לא מופיע.</p>
                {data.collect.length === 0 ? (
                    <p className="bg-white border border-slate-200 rounded-2xl text-center text-sm text-slate-400 py-8">אין כרגע מה לגבות</p>
                ) : (
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-slate-500 border-b border-slate-100">
                                    {["עסק", "מסלול", "סכום", "מתי", "מצב", ""].map((h, i) => (
                                        <th key={i} className="text-right font-semibold px-4 py-3 whitespace-nowrap">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.collect.map(c => (
                                    <tr key={c.id} className="border-b border-slate-50 last:border-0 align-top">
                                        <td className="px-4 py-3">
                                            <div className="font-bold text-slate-900">{c.name}</div>
                                            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                                {c.owner_name}
                                                {c.owner_phone && (
                                                    <a href={`https://wa.me/${whatsappNumber(c.owner_phone)}`} target="_blank" rel="noopener"
                                                        className="inline-flex items-center gap-1 text-emerald-700 hover:underline" dir="ltr">
                                                        <MessageCircle className="h-3.5 w-3.5" aria-hidden /> {c.owner_phone}
                                                    </a>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-slate-700">{c.plan_label}{c.amount_ils ? ` · ${CYCLE[c.cycle]}` : ""}</td>
                                        <td className="px-4 py-3 whitespace-nowrap tabular-nums font-semibold text-slate-900">{c.amount_ils ? formatCurrency(c.amount_ils) : "—"}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{when(c)}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full border ${STATE[c.state].cls}`}>{STATE[c.state].label}</span>
                                        </td>
                                        <td className="px-4 py-3 text-left">
                                            <button onClick={() => setPaying({ id: c.id, name: c.name, plan_id: c.plan_id, cycle: c.cycle })}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap">
                                                <Plus className="h-3.5 w-3.5" /> רישום תשלום
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="space-y-2">
                <h2 className="font-bold text-slate-900">תשלומים שנרשמו</h2>
                <CrmPayments reload={reload} onChanged={() => setReload(n => n + 1)} />
            </section>

            {paying && <RecordPayment business={paying} onClose={() => setPaying(null)} onSaved={() => setReload(n => n + 1)} />}
        </div>
    );
}
