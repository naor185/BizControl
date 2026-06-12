"use client";

import { useState, useEffect, useCallback } from "react";
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
    incoming: { bg: "bg-emerald-50", border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-700", label: "מגיע לי", icon: "⬅️" },
    outgoing: { bg: "bg-orange-50", border: "border-orange-200", badge: "bg-orange-100 text-orange-700", label: "אני חייב", icon: "➡️" },
};

const PRESET_COLORS = ["#f97316", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#eab308", "#06b6d4"];

export default function ObligationsPage() {
    const [obligations, setObligations] = useState<Obligation[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [markingId, setMarkingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Form state
    const [title, setTitle] = useState("");
    const [counterparty, setCounterparty] = useState("");
    const [direction, setDirection] = useState<"incoming" | "outgoing">("outgoing");
    const [totalAmount, setTotalAmount] = useState("");
    const [monthlyPayment, setMonthlyPayment] = useState("");
    const [dayOfMonth, setDayOfMonth] = useState("1");
    const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [color, setColor] = useState("#f97316");
    const [notes, setNotes] = useState("");

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const data = await apiFetch<Obligation[]>("/api/obligations");
            setObligations(data);
        } catch { toast.error("שגיאה בטעינה"); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const resetForm = () => {
        setTitle(""); setCounterparty(""); setDirection("outgoing");
        setTotalAmount(""); setMonthlyPayment(""); setDayOfMonth("1");
        setStartDate(new Date().toISOString().slice(0, 10));
        setColor("#f97316"); setNotes("");
    };

    const handleSave = async () => {
        if (!title.trim() || !totalAmount || !monthlyPayment) {
            toast.error("יש למלא שם, סכום כולל ותשלום חודשי");
            return;
        }
        const totalCents = Math.round(parseFloat(totalAmount) * 100);
        const monthlyCents = Math.round(parseFloat(monthlyPayment) * 100);
        if (totalCents <= 0 || monthlyCents <= 0) { toast.error("הסכומים חייבים להיות חיוביים"); return; }
        if (monthlyCents > totalCents) { toast.error("התשלום החודשי לא יכול לעלות על הסכום הכולל"); return; }

        setSaving(true);
        try {
            await apiFetch<Obligation>("/api/obligations", {
                method: "POST",
                body: JSON.stringify({
                    title: title.trim(),
                    counterparty: counterparty.trim() || null,
                    direction,
                    total_amount_cents: totalCents,
                    monthly_payment_cents: monthlyCents,
                    day_of_month: parseInt(dayOfMonth),
                    start_date: startDate,
                    color,
                    notes: notes.trim() || null,
                }),
            });
            toast.success("התחייבות נוספה — תשלומים סומנו ביומן");
            setShowForm(false);
            resetForm();
            load();
        } catch (e: any) { toast.error(e?.message || "שגיאה"); }
        finally { setSaving(false); }
    };

    const handleMarkPaid = async (id: string) => {
        setMarkingId(id);
        try {
            await apiFetch(`/api/obligations/${id}/mark-paid`, { method: "POST" });
            toast.success("תשלום סומן ✓");
            load();
        } catch (e: any) { toast.error(e?.message || "שגיאה"); }
        finally { setMarkingId(null); }
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

    const predictedMonths = (() => {
        const t = parseFloat(totalAmount);
        const m = parseFloat(monthlyPayment);
        if (!t || !m || m <= 0) return null;
        return Math.ceil(t / m);
    })();

    const active = obligations.filter(o => o.status === "active");
    const completed = obligations.filter(o => o.status === "completed");

    return (
        <RequireAuth>
            <AppShell title="התחייבויות">
                <div className="max-w-3xl mx-auto space-y-6 pb-12" dir="rtl">

                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-black text-slate-800">💳 התחייבויות פיננסיות</h1>
                            <p className="text-sm text-slate-500 mt-0.5">מעקב הלוואות, חובות וגבייה — מסומן אוטומטית ביומן</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setShowForm(true); resetForm(); }}
                            className="bg-slate-900 text-white font-bold px-4 py-2.5 rounded-xl text-sm hover:bg-slate-700 transition-colors shadow"
                        >
                            + הוסף התחייבות
                        </button>
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

                    {/* Add form */}
                    {showForm && (
                        <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-5 space-y-4">
                            <div className="text-base font-bold text-slate-800">הוסף התחייבות חדשה</div>

                            {/* Direction toggle */}
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
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">יום בחודש לתשלום</label>
                                    <input type="number" min="1" max="28" value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">תאריך התחלה</label>
                                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                                </div>
                            </div>

                            {/* Preview */}
                            {predictedMonths && (
                                <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-600 border border-slate-100">
                                    📅 <strong>{predictedMonths} חודשים</strong> של תשלומים •
                                    סה״כ ישולם: <strong>{fmt(Math.round(parseFloat(monthlyPayment) * predictedMonths * 100))}</strong>
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
                                    {saving ? "שומר..." : "✓ שמור + סמן ביומן"}
                                </button>
                                <button type="button" onClick={() => setShowForm(false)}
                                    className="px-5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                                    ביטול
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div className="text-center py-16 text-slate-400">טוען...</div>
                    )}

                    {/* Active obligations */}
                    {!loading && active.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">פעילות</div>
                            {active.map(ob => <ObligationCard key={ob.id} ob={ob} onMarkPaid={handleMarkPaid} onUnmark={handleUnmarkPaid} onDelete={setDeletingId} markingId={markingId} />)}
                        </div>
                    )}

                    {/* Completed */}
                    {!loading && completed.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">הושלמו ✓</div>
                            {completed.map(ob => <ObligationCard key={ob.id} ob={ob} onMarkPaid={handleMarkPaid} onUnmark={handleUnmarkPaid} onDelete={setDeletingId} markingId={markingId} />)}
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

                    {/* Delete confirm */}
                    {deletingId && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeletingId(null)}>
                            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
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

function ObligationCard({ ob, onMarkPaid, onUnmark, onDelete, markingId }: {
    ob: Obligation;
    onMarkPaid: (id: string) => void;
    onUnmark: (id: string) => void;
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
                <button type="button" onClick={() => onDelete(ob.id)} className="text-slate-300 hover:text-red-400 transition-colors text-xl leading-none shrink-0">×</button>
            </div>

            {/* Progress bar */}
            <div className="mb-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>{ob.months_paid} מתוך {ob.months_total} חודשים שולמו</span>
                    <span>{pct}%</span>
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
                    📅 כל {ob.day_of_month} לחודש • {fmt(ob.monthly_payment_cents)}/חודש
                    {ob.months_remaining > 0 && <> • עוד <strong>{ob.months_remaining}</strong> חודשים</>}
                </div>
                {!isCompleted && (
                    <div className="flex gap-1.5 shrink-0">
                        {ob.months_paid > 0 && (
                            <button type="button" onClick={() => onUnmark(ob.id)} disabled={busy}
                                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                                ↩
                            </button>
                        )}
                        <button type="button" onClick={() => onMarkPaid(ob.id)} disabled={busy}
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
