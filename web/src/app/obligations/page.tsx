"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

type Obligation = {
    id: string;
    title: string;
    counterparty: string | null;
    direction: "incoming" | "outgoing";
    total_amount_cents: number;
    monthly_payment_cents: number;
    day_of_month: number;
    start_date: string;
    months_paid: number;
    months_total: number;
    months_remaining: number;
    amount_paid_cents: number;
    amount_remaining_cents: number;
    status: "active" | "paused" | "completed";
    color: string;
    notes: string | null;
    created_at: string;
};

const fmt = (cents: number) =>
    (cents / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });

const DIRECTION_COLORS = {
    incoming: { bg: "bg-emerald-50", border: "border-emerald-300", badge: "bg-emerald-100 text-emerald-700", label: "מגיע לי", icon: "⬅️" },
    outgoing: { bg: "bg-orange-50", border: "border-orange-300", badge: "bg-orange-100 text-orange-700", label: "אני חייב", icon: "➡️" },
};

const PRESET_COLORS = ["#f97316", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#eab308", "#06b6d4"];

// Reusable day picker — visual grid of days 1–28
function DayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">
                יום בחודש לתשלום <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 28 }, (_, i) => String(i + 1)).map(d => (
                    <button
                        key={d}
                        type="button"
                        onClick={() => onChange(d)}
                        className={`h-8 rounded-lg text-xs font-bold transition-all ${value === d
                            ? "bg-slate-800 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                        {d}
                    </button>
                ))}
            </div>
            {!value && <p className="text-xs text-rose-500 mt-1">יש לבחור יום</p>}
        </div>
    );
}

// Obligation form (shared between create and edit)
function ObligationForm({
    initial,
    onSave,
    onCancel,
    isEdit,
}: {
    initial?: Partial<Obligation>;
    onSave: (data: any) => Promise<void>;
    onCancel: () => void;
    isEdit?: boolean;
}) {
    const [title, setTitle] = useState(initial?.title ?? "");
    const [counterparty, setCounterparty] = useState(initial?.counterparty ?? "");
    const [direction, setDirection] = useState<"incoming" | "outgoing">(initial?.direction ?? "outgoing");
    const [totalAmount, setTotalAmount] = useState(initial ? String((initial.total_amount_cents ?? 0) / 100) : "");
    const [monthlyPayment, setMonthlyPayment] = useState(initial ? String((initial.monthly_payment_cents ?? 0) / 100) : "");
    const [dayOfMonth, setDayOfMonth] = useState(initial?.day_of_month ? String(initial.day_of_month) : "");
    const [startDate, setStartDate] = useState(initial?.start_date ?? new Date().toISOString().slice(0, 10));
    const [color, setColor] = useState(initial?.color ?? "#f97316");
    const [notes, setNotes] = useState(initial?.notes ?? "");
    const [saving, setSaving] = useState(false);

    const predictedMonths = (() => {
        const t = parseFloat(totalAmount);
        const m = parseFloat(monthlyPayment);
        if (!t || !m || m <= 0) return null;
        return Math.ceil(t / m);
    })();

    const handleSave = async () => {
        if (!title.trim() || !totalAmount || !monthlyPayment) {
            toast.error("יש למלא שם, סכום כולל ותשלום חודשי");
            return;
        }
        if (!dayOfMonth) {
            toast.error("יש לבחור יום בחודש לתשלום");
            return;
        }
        const totalCents = Math.round(parseFloat(totalAmount) * 100);
        const monthlyCents = Math.round(parseFloat(monthlyPayment) * 100);
        if (totalCents <= 0 || monthlyCents <= 0) { toast.error("הסכומים חייבים להיות חיוביים"); return; }
        if (monthlyCents > totalCents) { toast.error("התשלום החודשי לא יכול לעלות על הסכום הכולל"); return; }

        setSaving(true);
        try {
            await onSave({
                title: title.trim(),
                counterparty: counterparty.trim() || null,
                direction,
                total_amount_cents: totalCents,
                monthly_payment_cents: monthlyCents,
                day_of_month: parseInt(dayOfMonth),
                start_date: startDate,
                color,
                notes: notes.trim() || null,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-5 space-y-4">
            <div className="text-base font-bold text-slate-800">
                {isEdit ? "✏️ עריכת התחייבות" : "הוסף התחייבות חדשה"}
            </div>

            {/* Direction toggle — only for new */}
            {!isEdit && (
                <div className="flex gap-2">
                    {(["outgoing", "incoming"] as const).map(d => (
                        <button type="button" key={d} onClick={() => setDirection(d)}
                            className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all ${direction === d
                                ? d === "outgoing" ? "bg-orange-500 text-white border-orange-500" : "bg-emerald-500 text-white border-emerald-500"
                                : "bg-white text-slate-600 border-slate-200"}`}>
                            {d === "outgoing" ? "➡️ אני חייב" : "⬅️ מגיע לי"}
                        </button>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">שם ההתחייבות *</label>
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder='למשל: "הלוואה מהבנק"'
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div className="col-span-2">
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">צד שני (אופציונלי)</label>
                    <input value={counterparty} onChange={e => setCounterparty(e.target.value)} placeholder="שם אדם / חברה"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">סכום כולל (₪) *</label>
                    <input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} placeholder="100000"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1 block">תשלום חודשי (₪) *</label>
                    <input type="number" value={monthlyPayment} onChange={e => setMonthlyPayment(e.target.value)} placeholder="5000"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                {!isEdit && (
                    <div className="col-span-2">
                        <label className="text-xs font-semibold text-slate-600 mb-1 block">תאריך התחלה</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                )}
            </div>

            {/* Day picker — prominent */}
            <DayPicker value={dayOfMonth} onChange={setDayOfMonth} />

            {/* Preview */}
            {predictedMonths && dayOfMonth && totalAmount && (
                <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm text-blue-700 border border-blue-100 space-y-1">
                    <div>📅 <strong>{predictedMonths} חודשים</strong> של תשלומים, כל <strong>{dayOfMonth}</strong> לחודש</div>
                    <div>💰 סכום כולל לתשלום: <strong>₪{parseFloat(totalAmount).toLocaleString("he-IL")}</strong></div>
                    {(() => {
                        const totalCents = Math.round(parseFloat(totalAmount) * 100);
                        const monthlyCents = Math.round(parseFloat(monthlyPayment) * 100);
                        const remainder = totalCents % monthlyCents;
                        return remainder > 0 ? (
                            <div className="text-xs text-blue-500">
                                התשלום האחרון: <strong>₪{(remainder / 100).toLocaleString("he-IL")}</strong> (שארית)
                            </div>
                        ) : null;
                    })()}
                </div>
            )}

            {/* Color */}
            <div>
                <label className="text-xs font-semibold text-slate-600 mb-2 block">צבע ביומן</label>
                <div className="flex gap-2 flex-wrap">
                    {PRESET_COLORS.map(c => (
                        <button type="button" key={c} onClick={() => setColor(c)}
                            style={{ backgroundColor: c }}
                            className={`w-7 h-7 rounded-full transition-all ${color === c ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : "hover:scale-105"}`} />
                    ))}
                </div>
            </div>

            <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">הערות</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none" />
            </div>

            <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleSave} disabled={saving}
                    className="flex-1 bg-slate-900 text-white font-bold py-2.5 rounded-xl text-sm hover:bg-slate-700 disabled:opacity-50 transition-colors">
                    {saving ? "שומר..." : isEdit ? "✓ שמור שינויים" : "✓ שמור + סמן ביומן"}
                </button>
                <button type="button" onClick={onCancel}
                    className="px-5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                    ביטול
                </button>
            </div>
        </div>
    );
}

type PayPopup = { id: string; defaultAmount: number; title: string };

// Which obligations are due this month and not yet paid
function calcOverdue(obligations: Obligation[]): Obligation[] {
    const today = new Date();
    return obligations.filter(ob => {
        if (ob.status !== "active") return false;
        const start = new Date(ob.start_date);
        let elapsed = (today.getFullYear() - start.getFullYear()) * 12
            + (today.getMonth() - start.getMonth());
        if (today.getDate() >= ob.day_of_month) elapsed += 1;
        elapsed = Math.max(0, Math.min(elapsed, ob.months_total));
        return ob.months_paid < elapsed;
    });
}

export default function ObligationsPage() {
    const [obligations, setObligations] = useState<Obligation[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingOb, setEditingOb] = useState<Obligation | null>(null);
    const [markingId, setMarkingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [payPopup, setPayPopup] = useState<PayPopup | null>(null);
    const [payAmount, setPayAmount] = useState("");
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const data = await apiFetch<Obligation[]>("/api/obligations");
            setObligations(data);
        } catch { toast.error("שגיאה בטעינה"); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Load dismissed alerts from sessionStorage
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem("ob_alerts_dismissed");
            if (raw) setDismissedAlerts(new Set(JSON.parse(raw)));
        } catch { /* ignore */ }
    }, []);

    const dismissAlert = (id: string) => {
        setDismissedAlerts(prev => {
            const next = new Set(prev).add(id);
            sessionStorage.setItem("ob_alerts_dismissed", JSON.stringify([...next]));
            return next;
        });
    };

    const handleCreate = async (data: any) => {
        await apiFetch<Obligation>("/api/obligations", { method: "POST", body: JSON.stringify(data) });
        toast.success("התחייבות נוספה — תשלומים סומנו ביומן");
        setShowForm(false);
        load();
    };

    const handleEdit = async (data: any) => {
        if (!editingOb) return;
        await apiFetch(`/api/obligations/${editingOb.id}`, { method: "PATCH", body: JSON.stringify(data) });
        toast.success("עודכן — היומן עודכן אוטומטית");
        setEditingOb(null);
        load();
    };

    const openPayPopup = (ob: Obligation) => {
        setPayAmount(String(ob.monthly_payment_cents / 100));
        setPayPopup({ id: ob.id, defaultAmount: ob.monthly_payment_cents / 100, title: ob.title });
    };

    const handleMarkPaid = async (id: string, amountCents?: number) => {
        setMarkingId(id);
        try {
            await apiFetch(`/api/obligations/${id}/mark-paid`, {
                method: "POST",
                body: JSON.stringify({ amount_cents: amountCents ?? null }),
            });
            toast.success("תשלום סומן ✓");
            setPayPopup(null);
            // Clear alert for this obligation
            dismissAlert(id);
            load();
        } catch (e: any) { toast.error(e?.message || "שגיאה"); }
        finally { setMarkingId(null); }
    };

    const submitPayPopup = () => {
        if (!payPopup) return;
        const amount = parseFloat(payAmount);
        if (!amount || amount <= 0) { toast.error("יש להזין סכום חיובי"); return; }
        handleMarkPaid(payPopup.id, Math.round(amount * 100));
    };

    const handleUnmarkPaid = async (id: string) => {
        setMarkingId(id);
        try {
            await apiFetch(`/api/obligations/${id}/unmark-paid`, { method: "POST" });
            load();
        } catch (e: any) { toast.error(e?.message || "שגיאה"); }
        finally { setMarkingId(null); }
    };

    const handleDelete = async (id: string) => {
        try {
            await apiFetch(`/api/obligations/${id}`, { method: "DELETE" });
            toast.success("נמחק");
            setDeletingId(null);
            load();
        } catch { toast.error("שגיאה במחיקה"); }
    };

    const active = obligations.filter(o => o.status !== "completed");
    const completed = obligations.filter(o => o.status === "completed");
    const overdueAlerts = calcOverdue(obligations).filter(o => !dismissedAlerts.has(o.id));

    // ── Monthly cashflow from all active obligations ──────────────────────────
    const monthlyCashflow = useMemo(() => {
        const map: Record<string, {
            out: number; in: number;
            items: { title: string; amount: number; direction: string }[];
        }> = {};

        for (const ob of obligations) {
            if (ob.status === "completed") continue;
            const { total_amount_cents: total, monthly_payment_cents: monthly, months_total, start_date, direction, title } = ob;
            const remainder = total % monthly;
            const [sy, sm] = start_date.split("-").map(Number);

            for (let i = 0; i < months_total; i++) {
                const rawMonth = sm + i;
                const year = sy + Math.floor((rawMonth - 1) / 12);
                const month = ((rawMonth - 1) % 12) + 1;
                const key = `${year}-${String(month).padStart(2, "0")}`;
                const isLast = i === months_total - 1;
                const amount = isLast && remainder > 0 ? remainder : monthly;

                if (!map[key]) map[key] = { out: 0, in: 0, items: [] };
                if (direction === "outgoing") map[key].out += amount;
                else map[key].in += amount;
                map[key].items.push({ title, amount, direction });
            }
        }

        return Object.entries(map)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, data]) => {
                const [y, m] = key.split("-").map(Number);
                return {
                    key,
                    label: new Date(y, m - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" }),
                    out: data.out,
                    inflow: data.in,
                    net: data.in - data.out,
                    items: data.items,
                };
            });
    }, [obligations]);

    return (
        <RequireAuth>
            <AppShell title="התחייבויות">
                <div className="max-w-3xl mx-auto space-y-6 pb-12" dir="rtl">

                    {/* Due-date alert banner */}
                    {overdueAlerts.length > 0 && (
                        <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 space-y-2 shadow-sm">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xl">🔔</span>
                                <span className="font-bold text-amber-800 text-sm">
                                    {overdueAlerts.length === 1
                                        ? "יש לך התחייבות לתשלום החודש שעדיין לא שולמה"
                                        : `יש לך ${overdueAlerts.length} התחייבויות לתשלום החודש שעדיין לא שולמו`}
                                </span>
                            </div>
                            {overdueAlerts.map(ob => (
                                <div key={ob.id} className="flex items-center justify-between gap-3 bg-white rounded-xl px-3 py-2 border border-amber-200">
                                    <div>
                                        <span className="font-semibold text-slate-800 text-sm">{ob.title}</span>
                                        <span className="text-xs text-slate-500 mr-2">• יום {ob.day_of_month} לחודש • {fmt(ob.monthly_payment_cents)}</span>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <button type="button" onClick={() => dismissAlert(ob.id)}
                                            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                                            אחר כך
                                        </button>
                                        <button type="button" onClick={() => openPayPopup(ob)}
                                            className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white font-bold hover:bg-amber-600">
                                            שלם עכשיו
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-black text-slate-800">💳 התחייבויות פיננסיות</h1>
                            <p className="text-sm text-slate-500 mt-0.5">מעקב הלוואות, חובות וגבייה — מסומן אוטומטית ביומן</p>
                        </div>
                        {!showForm && !editingOb && (
                            <button type="button" onClick={() => setShowForm(true)}
                                className="bg-slate-900 text-white font-bold px-4 py-2.5 rounded-xl text-sm hover:bg-slate-700 transition-colors shadow">
                                + הוסף התחייבות
                            </button>
                        )}
                    </div>

                    {/* Summary cards */}
                    {!loading && active.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                                <div className="text-xs text-orange-600 font-semibold mb-1">אני חייב (נשאר)</div>
                                <div className="text-xl font-black text-orange-700" dir="ltr">
                                    {fmt(active.filter(o => o.direction === "outgoing").reduce((s, o) => s + o.amount_remaining_cents, 0))}
                                </div>
                            </div>
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                                <div className="text-xs text-emerald-600 font-semibold mb-1">מגיע לי (נשאר)</div>
                                <div className="text-xl font-black text-emerald-700" dir="ltr">
                                    {fmt(active.filter(o => o.direction === "incoming").reduce((s, o) => s + o.amount_remaining_cents, 0))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Monthly cashflow table */}
                    {!loading && monthlyCashflow.length > 0 && (
                        <MonthlyCashflow rows={monthlyCashflow} />
                    )}

                    {/* Create form */}
                    {showForm && (
                        <ObligationForm
                            onSave={handleCreate}
                            onCancel={() => setShowForm(false)}
                        />
                    )}

                    {/* Edit form */}
                    {editingOb && (
                        <ObligationForm
                            initial={editingOb}
                            onSave={handleEdit}
                            onCancel={() => setEditingOb(null)}
                            isEdit
                        />
                    )}

                    {loading && <div className="text-center py-16 text-slate-400">טוען...</div>}

                    {/* Active obligations */}
                    {!loading && active.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">פעילות</div>
                            {active.map(ob => (
                                <ObligationCard key={ob.id} ob={ob}
                                    onMarkPaid={openPayPopup}
                                    onUnmark={handleUnmarkPaid}
                                    onEdit={() => setEditingOb(ob)}
                                    onDelete={setDeletingId}
                                    markingId={markingId} />
                            ))}
                        </div>
                    )}

                    {/* Completed */}
                    {!loading && completed.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">הושלמו ✓</div>
                            {completed.map(ob => (
                                <ObligationCard key={ob.id} ob={ob}
                                    onMarkPaid={openPayPopup}
                                    onUnmark={handleUnmarkPaid}
                                    onEdit={() => setEditingOb(ob)}
                                    onDelete={setDeletingId}
                                    markingId={markingId} />
                            ))}
                        </div>
                    )}

                    {/* Empty */}
                    {!loading && obligations.length === 0 && !showForm && (
                        <div className="text-center py-20 text-slate-400">
                            <div className="text-5xl mb-3">💳</div>
                            <div className="font-semibold text-slate-500 mb-1">אין התחייבויות עדיין</div>
                            <div className="text-sm">הוסף הלוואה, חוב או גבייה ותראה אותם ביומן</div>
                        </div>
                    )}

                    {/* Pay popup */}
                    {payPopup && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPayPopup(null)}>
                            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full text-right" onClick={e => e.stopPropagation()} dir="rtl">
                                <div className="text-lg font-bold text-slate-800 mb-1">✓ סמן תשלום</div>
                                <div className="text-sm text-slate-500 mb-4">{payPopup.title}</div>
                                <label htmlFor="pay-amount-input" className="text-xs font-semibold text-slate-600 mb-1 block">
                                    סכום ששולם (₪)
                                    <span className="text-slate-400 font-normal mr-1">— ברירת מחדל: {payPopup.defaultAmount.toLocaleString("he-IL")}</span>
                                </label>
                                <input
                                    id="pay-amount-input"
                                    type="number"
                                    value={payAmount}
                                    onChange={e => setPayAmount(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && submitPayPopup()}
                                    placeholder={String(payPopup.defaultAmount)}
                                    autoFocus
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 mb-4"
                                />
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setPayPopup(null)}
                                        className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                                        ביטול
                                    </button>
                                    <button type="button" onClick={submitPayPopup} disabled={markingId === payPopup.id}
                                        className="flex-1 bg-slate-900 text-white font-bold py-2.5 rounded-xl text-sm hover:bg-slate-700 disabled:opacity-50">
                                        {markingId === payPopup.id ? "שומר..." : "✓ אשר תשלום"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Delete confirm */}
                    {deletingId && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeletingId(null)}>
                            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full text-center" onClick={e => e.stopPropagation()} dir="rtl">
                                <div className="text-4xl mb-3">🗑️</div>
                                <div className="font-bold text-slate-800 mb-2">מחיקת התחייבות</div>
                                <p className="text-sm text-slate-500 mb-5">הרשומה והאירוע ביומן יימחקו. לא ניתן לשחזר.</p>
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setDeletingId(null)} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm text-slate-600">ביטול</button>
                                    <button type="button" onClick={() => handleDelete(deletingId)} className="flex-1 bg-red-600 text-white rounded-xl py-2 text-sm font-bold">מחק</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}

type CashflowRow = {
    key: string;
    label: string;
    out: number;
    inflow: number;
    net: number;
    items: { title: string; amount: number; direction: string }[];
};

function MonthlyCashflow({ rows }: { rows: CashflowRow[] }) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const nowKey = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();

    return (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                <div className="text-sm font-bold text-slate-700">📊 תזרים חודשי — יציאות ולכניסות</div>
                <div className="text-xs text-slate-400 mt-0.5">לפי כל ההתחייבויות הפעילות</div>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-4 gap-2 px-4 py-2 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100">
                <div>חודש</div>
                <div className="text-center text-orange-500">יוצא ➡️</div>
                <div className="text-center text-emerald-500">⬅️ נכנס</div>
                <div className="text-center">מאזן</div>
            </div>

            <div className="divide-y divide-slate-50">
                {rows.map(row => {
                    const isCurrent = row.key === nowKey;
                    const isPast = row.key < nowKey;
                    const isOpen = expanded === row.key;
                    return (
                        <div key={row.key}>
                            <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : row.key)}
                                className={`w-full grid grid-cols-4 gap-2 px-4 py-2.5 text-right transition-colors hover:bg-slate-50 ${isCurrent ? "bg-blue-50" : ""}`}
                            >
                                <div className={`text-xs font-semibold ${isPast ? "text-slate-400" : isCurrent ? "text-blue-700 font-bold" : "text-slate-700"}`}>
                                    {isCurrent && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 ml-1 mb-0.5" />}
                                    {row.label}
                                </div>
                                <div className="text-center text-xs font-bold text-orange-600" dir="ltr">
                                    {row.out > 0 ? `−${fmt(row.out)}` : "—"}
                                </div>
                                <div className="text-center text-xs font-bold text-emerald-600" dir="ltr">
                                    {row.inflow > 0 ? `+${fmt(row.inflow)}` : "—"}
                                </div>
                                <div className={`text-center text-xs font-black ${row.net >= 0 ? "text-emerald-700" : "text-rose-600"}`} dir="ltr">
                                    {row.net >= 0 ? "+" : ""}{fmt(row.net)}
                                </div>
                            </button>

                            {/* Breakdown per obligation */}
                            {isOpen && (
                                <div className="bg-slate-50 px-4 py-2 space-y-1 border-t border-slate-100">
                                    {row.items.map((item, i) => (
                                        <div key={i} className="flex justify-between text-xs text-slate-600">
                                            <span className={item.direction === "outgoing" ? "text-orange-600" : "text-emerald-600"}>
                                                {item.direction === "outgoing" ? "➡️" : "⬅️"} {item.title}
                                            </span>
                                            <span className="font-bold" dir="ltr">{fmt(item.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer total */}
            <div className="grid grid-cols-4 gap-2 px-4 py-3 bg-slate-50 border-t border-slate-200">
                <div className="text-xs font-bold text-slate-600">סה״כ כולל</div>
                <div className="text-center text-xs font-black text-orange-700" dir="ltr">
                    −{fmt(rows.reduce((s, r) => s + r.out, 0))}
                </div>
                <div className="text-center text-xs font-black text-emerald-700" dir="ltr">
                    +{fmt(rows.reduce((s, r) => s + r.inflow, 0))}
                </div>
                <div className={`text-center text-xs font-black ${rows.reduce((s, r) => s + r.net, 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`} dir="ltr">
                    {fmt(rows.reduce((s, r) => s + r.net, 0))}
                </div>
            </div>
        </div>
    );
}

function ObligationCard({ ob, onMarkPaid, onUnmark, onEdit, onDelete, markingId }: {
    ob: Obligation;
    onMarkPaid: (ob: Obligation) => void;
    onUnmark: (id: string) => void;
    onEdit: () => void;
    onDelete: (id: string) => void;
    markingId: string | null;
}) {
    const d = DIRECTION_COLORS[ob.direction];
    const pct = ob.months_total > 0 ? Math.round((ob.months_paid / ob.months_total) * 100) : 100;
    const isCompleted = ob.status === "completed";
    const busy = markingId === ob.id;

    return (
        <div className={`rounded-2xl border-2 p-4 ${d.bg} ${d.border} ${isCompleted ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.badge}`}>{d.icon} {d.label}</span>
                        {isCompleted && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">✓ הושלם</span>}
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ob.color }} />
                    </div>
                    <div className="font-bold text-slate-800 text-base mt-1">{ob.title}</div>
                    {ob.counterparty && <div className="text-xs text-slate-500 mt-0.5">{ob.counterparty}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={onEdit} className="text-slate-400 hover:text-blue-500 transition-colors text-sm px-1.5" title="ערוך">✏️</button>
                    <button type="button" onClick={() => onDelete(ob.id)} className="text-slate-300 hover:text-red-400 transition-colors text-xl leading-none px-1" title="מחק">×</button>
                </div>
            </div>

            {/* Progress bar */}
            <div className="mb-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>{ob.months_paid} מתוך {ob.months_total} חודשים שולמו</span>
                    <span className="font-bold">{pct}%</span>
                </div>
                <div className="h-2.5 bg-white/60 rounded-full overflow-hidden border border-white">
                    <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: ob.color }} />
                </div>
            </div>

            {/* Amounts grid */}
            <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-white/70 rounded-xl p-2.5 text-center">
                    <div className="text-[10px] text-slate-500 font-medium">סה״כ</div>
                    <div className="text-sm font-black text-slate-800" dir="ltr">{fmt(ob.total_amount_cents)}</div>
                </div>
                <div className="bg-white/70 rounded-xl p-2.5 text-center">
                    <div className="text-[10px] text-slate-500 font-medium">שולם</div>
                    <div className="text-sm font-black text-emerald-700" dir="ltr">{fmt(ob.amount_paid_cents)}</div>
                </div>
                <div className="bg-white/70 rounded-xl p-2.5 text-center">
                    <div className="text-[10px] text-slate-500 font-medium">נשאר</div>
                    <div className="text-sm font-black text-slate-800" dir="ltr">{fmt(ob.amount_remaining_cents)}</div>
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500">
                    📅 כל <strong>{ob.day_of_month}</strong> לחודש • {fmt(ob.monthly_payment_cents)}/חודש
                    {ob.months_remaining > 0 && <> • עוד <strong>{ob.months_remaining}</strong> חודשים</>}
                </div>
                {!isCompleted && (
                    <div className="flex gap-1.5 shrink-0">
                        {ob.months_paid > 0 && (
                            <button type="button" onClick={() => onUnmark(ob.id)} disabled={busy}
                                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors" title="בטל תשלום אחרון">
                                ↩
                            </button>
                        )}
                        <button type="button" onClick={() => onMarkPaid(ob)} disabled={busy}
                            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-white font-bold hover:bg-slate-700 disabled:opacity-50 transition-colors">
                            {busy ? "..." : "✓ שולם"}
                        </button>
                    </div>
                )}
            </div>

            {ob.notes && <div className="mt-2 text-xs text-slate-500 italic">{ob.notes}</div>}
        </div>
    );
}
