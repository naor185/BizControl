"use client";

import { toast } from "@/lib/toast";
import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch, downloadReceipt, getCurrentUserRole } from "@/lib/api";

import Link from "next/link";

type Payment = {
    id: string;
    client_id: string;
    appointment_id: string;
    amount_cents: number;
    currency: string;
    type: string;
    status: string;
    method: string;
    created_at: string;
    notes?: string | null;
    client?: {
        id: string;
        full_name: string | null;
        is_walk_in: boolean;
    } | null;
};

type PosTransaction = {
    id: string;
    client_name: string | null;
    cashier_name: string | null;
    total_cents: number;
    discount_cents: number;
    method: string;
    items_count: number;
    created_at: string;
};

// Unified entry for display
type Entry = {
    id: string;
    amount_cents: number;
    method: string;
    type: string;  // "payment" | "deposit" | "refund" | "pos_sale"
    created_at: string;
    notes?: string | null;
    clientId?: string | null;
    clientName?: string | null;
    isWalkIn?: boolean;
    isPos?: boolean;
    paymentId?: string; // only for regular payments (for receipt/invoice download)
};

const METHODS = [
    { key: "all", label: "הכל", icon: "🧾" },
    { key: "cash", label: "מזומן", icon: "💵" },
    { key: "credit_card", label: "אשראי", icon: "💳" },
    { key: "bit", label: "ביט", icon: "📱" },
    { key: "paybox", label: "פייבוקס", icon: "📲" },
    { key: "bank_transfer", label: "העברה בנקאית", icon: "🏦" },
];

const METHOD_LABELS: Record<string, string> = {
    cash: "מזומן 💵",
    credit_card: "אשראי 💳",
    bit: "ביט 📱",
    paybox: "פייבוקס 📲",
    bank_transfer: "העברה בנקאית 🏦",
    installment: "תשלומים",
    other: "אחר",
};

const METHOD_COLORS: Record<string, string> = {
    cash: "bg-green-100 text-green-800",
    credit_card: "bg-blue-100 text-blue-800",
    bit: "bg-purple-100 text-purple-800",
    paybox: "bg-pink-100 text-pink-800",
    bank_transfer: "bg-amber-100 text-amber-800",
};

const currentMonthKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
})();

export default function Page() {
    const role = getCurrentUserRole();
    const isSuperadmin = role === "superadmin";
    const canCredit = role === "owner" || role === "admin" || role === "superadmin";

    const [entries, setEntries] = useState<Entry[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [creditingId, setCreditingId] = useState<string | null>(null);
    const [isCrediting, setIsCrediting] = useState(false);
    const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set([currentMonthKey]));

    const toggleMonth = (key: string) => {
        setExpandedMonths(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const toggleMethod = (key: string) => {
        if (key === "all") {
            setSelectedMethods(new Set());
            return;
        }
        setSelectedMethods(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const loadPayments = async () => {
        try {
            setLoading(true);
            const [payments, posTxns] = await Promise.all([
                apiFetch<Payment[]>("/api/payments"),
                apiFetch<PosTransaction[]>("/api/pos/history?days=365").catch(() => [] as PosTransaction[]),
            ]);

            const fromPayments: Entry[] = payments.map(p => ({
                id: p.id,
                amount_cents: p.amount_cents,
                method: p.method,
                type: p.type,
                created_at: p.created_at,
                notes: p.notes,
                clientId: p.client?.id ?? p.client_id ?? null,
                clientName: p.client?.full_name ?? null,
                isWalkIn: p.client?.is_walk_in ?? false,
                isPos: false,
                paymentId: p.id,
            }));

            const fromPos: Entry[] = posTxns.map(t => ({
                id: `pos-${t.id}`,
                amount_cents: t.total_cents,
                method: t.method,
                type: "pos_sale",
                created_at: t.created_at,
                notes: t.discount_cents > 0
                    ? `קופה — ${t.items_count} פריטים, הנחה ₪${(t.discount_cents / 100).toFixed(0)}`
                    : `קופה — ${t.items_count} פריטים`,
                clientId: null,
                clientName: t.client_name,
                isWalkIn: false,
                isPos: true,
                paymentId: undefined,
            }));

            const merged = [...fromPayments, ...fromPos].sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            setEntries(merged);
        } catch (e: any) {
            setErr(e?.message || "שגיאה בטעינת תשלומים");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPayments();
    }, []);

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            setIsDeleting(true);
            await apiFetch(`/api/payments/${deletingId}`, { method: "DELETE" });
            setDeletingId(null);
            loadPayments();
        } catch (e: any) {
            toast.error(e?.message || "שגיאה במחיקת תשלום");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleCredit = async () => {
        if (!creditingId) return;
        try {
            setIsCrediting(true);
            await apiFetch(`/api/payments/${creditingId}/credit`, { method: "POST" });
            toast.success("זיכוי הופק בהצלחה");
            setCreditingId(null);
            loadPayments();
        } catch (e: any) {
            toast.error(e?.message || "שגיאה בהפקת זיכוי");
        } finally {
            setIsCrediting(false);
        }
    };

    const fmt = (cents: number) =>
        (cents / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS" });

    // Filter by method (multi-select)
    const filtered = useMemo(() =>
        selectedMethods.size === 0 ? entries : entries.filter(e => selectedMethods.has(e.method)),
        [entries, selectedMethods]
    );

    // Group by month
    const byMonth = useMemo(() => {
        const groups: Record<string, Entry[]> = {};
        for (const e of filtered) {
            const d = new Date(e.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(e);
        }
        return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
    }, [filtered]);

    // Current month totals by method
    const totals = useMemo(() => {
        const t: Record<string, number> = {};
        for (const e of entries) {
            const d = new Date(e.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (key !== currentMonthKey) continue;
            if (e.type === "refund") continue;
            if (e.notes?.startsWith("[מערכת]")) continue;
            t[e.method] = (t[e.method] || 0) + e.amount_cents;
        }
        return t;
    }, [entries]);

    const monthLabel = (key: string) => {
        const [year, month] = key.split("-");
        const d = new Date(Number(year), Number(month) - 1, 1);
        return d.toLocaleDateString("he-IL", { month: "long", year: "numeric" });
    };

    const monthTotal = (es: Entry[]) =>
        es.filter(e => !e.notes?.startsWith("[מערכת]"))
          .reduce((s, e) => s + (e.type === "refund" ? -e.amount_cents : e.amount_cents), 0);

    const monthByMethod = (es: Entry[]) => {
        const t: Record<string, number> = {};
        for (const e of es) {
            if (e.type === "refund") continue;
            if (e.notes?.startsWith("[מערכת]")) continue;
            t[e.method] = (t[e.method] || 0) + e.amount_cents;
        }
        return t;
    };

    return (
        <RequireAuth>
            <AppShell title="תשלומים">
                <div className="space-y-6">

                    {/* Current month totals */}
                    {!loading && !err && entries.length > 0 && (
                        <div>
                            <div className="text-xs text-slate-400 font-semibold mb-2 px-1">
                                📅 {new Date().toLocaleDateString("he-IL", { month: "long", year: "numeric" })} — סיכום חודש נוכחי
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                {METHODS.filter(m => m.key !== "all").map(m => (
                                    <div key={m.key} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                        <div className="text-xl mb-1">{m.icon}</div>
                                        <div className="text-xs text-slate-500 font-medium">{m.label}</div>
                                        <div className="text-lg font-black text-slate-800 mt-1" dir="ltr">
                                            {fmt(totals[m.key] || 0)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
                        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="text-xl font-bold text-slate-800 mb-4">היסטוריית עסקאות לפי חודש 🗓️</h3>

                            {/* Filter buttons */}
                            <div className="flex flex-wrap gap-2">
                                {METHODS.map(m => (
                                    <button
                                        type="button"
                                        key={m.key}
                                        onClick={() => toggleMethod(m.key)}
                                        className={[
                                            "px-4 py-1.5 rounded-full text-sm font-bold transition-all border",
                                            m.key === "all"
                                                ? selectedMethods.size === 0
                                                    ? "bg-sky-600 text-white border-slate-900 shadow-lg"
                                                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                                                : selectedMethods.has(m.key)
                                                    ? "bg-sky-600 text-white border-slate-900 shadow-lg"
                                                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400",
                                        ].join(" ")}
                                    >
                                        {m.icon} {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {loading ? (
                            <div className="p-12 text-center text-slate-400">טוען נתונים...</div>
                        ) : err ? (
                            <div className="p-8 text-rose-500 bg-rose-50 m-6 rounded-2xl border border-rose-100">{err}</div>
                        ) : byMonth.length === 0 ? (
                            <div className="p-12 text-center text-slate-400 italic">לא נמצאו עסקאות</div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {byMonth.map(([monthKey, es]) => {
                                    const mTotal = monthTotal(es);
                                    const mByMethod = monthByMethod(es);
                                    const isCurrentMonth = monthKey === currentMonthKey;
                                    const isExpanded = expandedMonths.has(monthKey);
                                    return (
                                        <div key={monthKey}>
                                            <button
                                                type="button"
                                                onClick={() => toggleMonth(monthKey)}
                                                className={`w-full px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-right transition-colors ${isCurrentMonth ? "bg-sky-50 hover:bg-sky-100/70" : "bg-slate-50 hover:bg-slate-100/70"}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className={`text-lg transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-slate-800 text-base">{monthLabel(monthKey)}</span>
                                                            {isCurrentMonth && <span className="text-[10px] bg-sky-600 text-white px-2 py-0.5 rounded-full font-bold">חודש נוכחי</span>}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 mt-1.5">
                                                            {Object.entries(mByMethod).map(([method, cents]) => (
                                                                <span key={method} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${METHOD_COLORS[method] || "bg-slate-100 text-slate-600"}`}>
                                                                    {METHOD_LABELS[method] || method}: {fmt(cents)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <div className="text-xs text-slate-400 font-medium">סה״כ חודשי</div>
                                                    <div className={`text-xl font-black ${mTotal >= 0 ? "text-emerald-600" : "text-rose-600"}`} dir="ltr">
                                                        {fmt(Math.abs(mTotal))}
                                                    </div>
                                                </div>
                                            </button>

                                            <div className={isExpanded ? "divide-y divide-slate-50" : "hidden"}>
                                                {[...es].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(e => (
                                                    <div key={e.id} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50/60 transition-colors group">
                                                        <div className="flex items-center gap-3 overflow-hidden">
                                                            <div className="text-xs text-slate-400 w-20 shrink-0">
                                                                {new Date(e.created_at).toLocaleDateString("he-IL")}
                                                            </div>
                                                            <div className="flex flex-col min-w-30">
                                                                {e.clientId ? (
                                                                    <Link href={`/clients/${e.clientId}`} className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1 truncate">
                                                                        {e.clientName || "ללא שם"}
                                                                        {e.isWalkIn && <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded font-normal">מזדמן</span>}
                                                                    </Link>
                                                                ) : e.clientName ? (
                                                                    <span className="text-sm font-bold text-slate-700">{e.clientName}</span>
                                                                ) : (
                                                                    <span className="text-sm font-bold text-slate-400 italic">אנונימי</span>
                                                                )}
                                                            </div>
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${METHOD_COLORS[e.method] || "bg-slate-100 text-slate-600"} whitespace-nowrap`}>
                                                                {METHOD_LABELS[e.method] || e.method}
                                                            </span>
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${
                                                                e.type === "refund" ? "bg-rose-100 text-rose-700" :
                                                                e.type === "deposit" ? "bg-amber-100 text-amber-700" :
                                                                e.type === "pos_sale" ? "bg-violet-100 text-violet-700" :
                                                                "bg-emerald-100 text-emerald-700"
                                                            }`}>
                                                                {e.type === "refund" ? "זיכוי" : e.type === "deposit" ? "מקדמה" : e.type === "pos_sale" ? "🛒 קופה" : "תשלום"}
                                                            </span>
                                                            {e.notes && !e.notes.startsWith("[מערכת]") && (
                                                                <span className="text-xs text-slate-400 italic truncate max-w-45 hidden sm:inline">{e.notes}</span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div className={`font-black text-base ${e.type === "refund" ? "text-rose-600" : "text-slate-800"}`} dir="ltr">
                                                                {e.type === "refund" ? "-" : ""}{fmt(e.amount_cents)}
                                                            </div>
                                                            {e.paymentId && (
                                                                <>
                                                                    {/* Download receipt PDF */}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => downloadReceipt(e.paymentId!)}
                                                                        className="text-slate-700 hover:text-blue-600 transition-colors p-1.5 rounded-lg hover:bg-blue-50"
                                                                        title="הורד קבלה PDF"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                                        </svg>
                                                                    </button>
                                                                    {/* Issue credit note — owner/admin/superadmin, only for non-refund entries */}
                                                                    {canCredit && e.type !== "refund" && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setCreditingId(e.paymentId!)}
                                                                            className="text-slate-700 hover:text-amber-600 transition-colors p-1.5 rounded-lg hover:bg-amber-50"
                                                                            title="הוצא זיכוי"
                                                                        >
                                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                                                            </svg>
                                                                        </button>
                                                                    )}
                                                                    {/* Hard delete — superadmin only */}
                                                                    {isSuperadmin && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setDeletingId(e.paymentId!)}
                                                                            className="text-slate-700 hover:text-red-600 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                                                                            title="מחק תשלום לצמיתות (סופר-אדמין)"
                                                                        >
                                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                            </svg>
                                                                        </button>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Credit Note Confirmation Modal */}
                {creditingId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-xl overflow-hidden p-6 text-center animate-in zoom-in-95 duration-200">
                            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">הוצאת זיכוי</h3>
                            <p className="text-sm text-slate-500 mb-6">
                                יופק מסמך זיכוי מול הקבלה המקורית של תשלום זה.
                                <br />
                                <span className="text-amber-600 font-semibold mt-2 block">
                                    הקבלה המקורית תסומן כ"זוכתה" ולא ניתן לבטל פעולה זו.
                                </span>
                            </p>
                            <div className="flex justify-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setCreditingId(null)}
                                    disabled={isCrediting}
                                    className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                                >
                                    ביטול
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCredit}
                                    disabled={isCrediting}
                                    className="px-5 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl shadow-lg ring-1 ring-amber-600 transition-colors disabled:opacity-50"
                                >
                                    {isCrediting ? "מפיק זיכוי..." : "כן, הוצא זיכוי"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Hard Delete Confirmation Modal — superadmin only */}
                {deletingId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-xl overflow-hidden p-6 text-center animate-in zoom-in-95 duration-200">
                            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">מחיקה מלאה — סופר-אדמין</h3>
                            <p className="text-sm text-slate-500 mb-6">
                                פעולה זו תמחק לצמיתות את התשלום, הקבלה/חשבונית, וכל זיכוי מקושר.
                                <br />
                                <span className="text-red-500 font-bold mt-2 block">
                                    לא ניתן לבטל פעולה זו. השתמש רק לצורכי בדיקות ופיתוח.
                                </span>
                            </p>
                            <div className="flex justify-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setDeletingId(null)}
                                    disabled={isDeleting}
                                    className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                                >
                                    ביטול
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-lg ring-1 ring-red-700 transition-colors disabled:opacity-50"
                                >
                                    {isDeleting ? "מוחק..." : "מחק לצמיתות"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
