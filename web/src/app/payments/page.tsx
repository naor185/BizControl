"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch, downloadReceipt, downloadInvoice } from "@/lib/api";

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

export default function Page() {
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

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
            const data = await apiFetch<Payment[]>("/api/payments");
            setPayments(data);
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
            alert(e?.message || "שגיאה במחיקת תשלום");
        } finally {
            setIsDeleting(false);
        }
    };

    const fmt = (cents: number) =>
        (cents / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS" });

    // Filter by method (multi-select)
    const filtered = useMemo(() =>
        selectedMethods.size === 0 ? payments : payments.filter(p => selectedMethods.has(p.method)),
        [payments, selectedMethods]
    );

    // Group by month
    const byMonth = useMemo(() => {
        const groups: Record<string, Payment[]> = {};
        for (const p of filtered) {
            const d = new Date(p.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(p);
        }
        // Sort months descending
        return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
    }, [filtered]);

    // Overall totals by method (all payments, no filter)
    const totals = useMemo(() => {
        const t: Record<string, number> = {};
        for (const p of payments) {
            if (p.type === "refund") continue;
            t[p.method] = (t[p.method] || 0) + p.amount_cents;
        }
        return t;
    }, [payments]);

    const monthLabel = (key: string) => {
        const [year, month] = key.split("-");
        const d = new Date(Number(year), Number(month) - 1, 1);
        return d.toLocaleDateString("he-IL", { month: "long", year: "numeric" });
    };

    const monthTotal = (ps: Payment[]) =>
        ps.reduce((s, p) => s + (p.type === "refund" ? -p.amount_cents : p.amount_cents), 0);

    const monthByMethod = (ps: Payment[]) => {
        const t: Record<string, number> = {};
        for (const p of ps) {
            if (p.type === "refund") continue;
            t[p.method] = (t[p.method] || 0) + p.amount_cents;
        }
        return t;
    };

    return (
        <RequireAuth>
            <AppShell title="תשלומים">
                <div className="space-y-6">

                    {/* Overall method totals */}
                    {!loading && !err && payments.length > 0 && (
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
                    )}

                    <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
                        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="text-xl font-bold text-slate-800 mb-4">היסטוריית עסקאות לפי חודש 🗓️</h3>

                            {/* Filter buttons */}
                            <div className="flex flex-wrap gap-2">
                                {METHODS.map(m => (
                                    <button
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
                                {byMonth.map(([monthKey, ps]) => {
                                    const mTotal = monthTotal(ps);
                                    const mByMethod = monthByMethod(ps);
                                    return (
                                        <div key={monthKey}>
                                            {/* Month header */}
                                            <div className="px-6 py-4 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                <div>
                                                    <div className="font-bold text-slate-800 text-base">{monthLabel(monthKey)}</div>
                                                    <div className="flex flex-wrap gap-2 mt-1.5">
                                                        {Object.entries(mByMethod).map(([method, cents]) => (
                                                            <span key={method} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${METHOD_COLORS[method] || "bg-slate-100 text-slate-600"}`}>
                                                                {METHOD_LABELS[method] || method}: {fmt(cents)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-xs text-slate-400 font-medium">סה״כ חודשי</div>
                                                    <div className={`text-xl font-black ${mTotal >= 0 ? "text-emerald-600" : "text-rose-600"}`} dir="ltr">
                                                        {fmt(Math.abs(mTotal))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Payments list */}
                                            <div className="divide-y divide-slate-50">
                                                {ps.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(p => (
                                                    <div key={p.id} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50/60 transition-colors group">
                                                        <div className="flex items-center gap-3 overflow-hidden">
                                                            <div className="text-xs text-slate-400 w-20 shrink-0">
                                                                {new Date(p.created_at).toLocaleDateString("he-IL")}
                                                            </div>
                                                            <div className="flex flex-col min-w-[120px]">
                                                                {p.client ? (
                                                                    <Link href={`/clients/${p.client.id}`} className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1 truncate">
                                                                        {p.client.full_name || "ללא שם"}
                                                                        {p.client.is_walk_in && (
                                                                            <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded font-normal">מזדמן</span>
                                                                        )}
                                                                    </Link>
                                                                ) : (
                                                                    <span className="text-sm font-bold text-slate-400 italic">לקוח לא נמצא</span>
                                                                )}
                                                            </div>
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${METHOD_COLORS[p.method] || "bg-slate-100 text-slate-600"} whitespace-nowrap`}>
                                                                {METHOD_LABELS[p.method] || p.method}
                                                            </span>
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${p.type === "refund" ? "bg-rose-100 text-rose-700" :
                                                                p.type === "deposit" ? "bg-amber-100 text-amber-700" :
                                                                    "bg-emerald-100 text-emerald-700"
                                                                }`}>
                                                                {p.type === "refund" ? "זיכוי" : p.type === "deposit" ? "מקדמה" : "תשלום"}
                                                            </span>
                                                            {p.notes && (
                                                                <span className="text-xs text-slate-400 italic truncate max-w-[180px] hidden sm:inline">{p.notes}</span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div className={`font-black text-base ${p.type === "refund" ? "text-rose-600" : "text-slate-800"}`} dir="ltr">
                                                                {p.type === "refund" ? "-" : ""}{fmt(p.amount_cents)}
                                                            </div>
                                                            <button
                                                                onClick={() => downloadReceipt(p.id)}
                                                                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-blue-500 transition-all p-1.5 rounded-lg hover:bg-blue-50"
                                                                title="הורד קבלה PDF"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                                </svg>
                                                            </button>
                                                            <button
                                                                onClick={() => downloadInvoice(p.id)}
                                                                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-purple-500 transition-all p-1.5 rounded-lg hover:bg-purple-50"
                                                                title="הורד חשבונית מס PDF"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                                </svg>
                                                            </button>
                                                            <button
                                                                onClick={() => setDeletingId(p.id)}
                                                                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-50"
                                                                title="מחק תשלום"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                </svg>
                                                            </button>
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

                {/* Deletion Confirmation Modal */}
                {deletingId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-xl overflow-hidden p-6 text-center animate-in zoom-in-95 duration-200">
                            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">מחיקת תשלום</h3>
                            <p className="text-sm text-slate-500 mb-6">
                                האם אתה בטוח שברצונך למחוק תשלום זה?
                                <br />
                                <span className="text-red-500 font-bold mt-2 block">
                                    שים לב: נקודות הקאשבק (Cashback) שניתנו על תשלום זה יבוטלו אוטומטית.
                                </span>
                            </p>
                            <div className="flex justify-center gap-3">
                                <button
                                    onClick={() => setDeletingId(null)}
                                    disabled={isDeleting}
                                    className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                                >
                                    ביטול
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-lg ring-1 ring-red-700 transition-colors disabled:opacity-50"
                                >
                                    {isDeleting ? "מוחק..." : "כן, מחק תשלום"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
