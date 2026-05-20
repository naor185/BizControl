"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch, DashboardStats } from "@/lib/api";
import PaymentModal from "@/components/PaymentModal";
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
    ResponsiveContainer,
} from "recharts";

type DailyPayment = {
    appointment_id: string;
    client_id: string;
    client_name: string;
    client_phone: string;
    client_loyalty_points: number;
    starts_at: string;
    total_price_cents: number;
    deposit_amount_cents: number;
    paid_cents: number;
    remaining_cents: number;
    status: string;
    payment_sent_at: string | null;
    payment_verified_at: string | null;
};

type Analytics = {
    revenue_by_month: { month: string; revenue: number }[];
    appts_by_month: { month: string; count: number }[];
    artists: { name: string; appointments: number; revenue: number }[];
    busiest_days: { day: string; count: number }[];
    new_vs_returning: { new: number; returning: number };
};

const fmt = (n: number) =>
    n.toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });


export default function Page() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [dailyPayments, setDailyPayments] = useState<DailyPayment[]>([]);
    const [analytics, setAnalytics] = useState<Analytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"today" | "analytics">("today");
    const [error, setError] = useState<string | null>(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedAppt, setSelectedAppt] = useState<DailyPayment | null>(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [statsData, paymentsData] = await Promise.all([
                apiFetch<DashboardStats>("/api/dashboard/stats"),
                apiFetch<DailyPayment[]>("/api/dashboard/daily-payments"),
            ]);
            setStats(statsData);
            setDailyPayments(paymentsData);
        } catch {
            setError("שגיאה בטעינת נתונים");
        } finally {
            setLoading(false);
        }
    };

    const fetchAnalytics = async () => {
        try {
            const data = await apiFetch<Analytics>("/api/dashboard/analytics");
            setAnalytics(data);
        } catch { /* silent */ }
    };

    useEffect(() => { fetchData(); }, []);
    useEffect(() => { if (tab === "analytics" && !analytics) fetchAnalytics(); }, [tab]);

    const handlePaymentSuccess = () => { setIsPaymentModalOpen(false); fetchData(); };

    if (loading) return (
        <RequireAuth><AppShell title="לוח בקרה">
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900" />
            </div>
        </AppShell></RequireAuth>
    );

    if (error) return (
        <RequireAuth><AppShell title="לוח בקרה">
            <div className="bg-red-50 text-red-600 p-4 rounded-xl">{error}</div>
        </AppShell></RequireAuth>
    );

    return (
        <RequireAuth>
            <AppShell title="לוח בקרה">
                <div className="space-y-6 animate-in fade-in duration-300">

                    {/* KPI row */}
                    {stats && (
                        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
                            <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">תורים היום</div>
                                <div className="text-4xl font-bold text-slate-800">{stats.appointments_today}</div>
                            </div>
                            <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">לקוחות מועדון</div>
                                <div className="text-4xl font-bold text-slate-800">{stats.total_club_members}</div>
                            </div>
                            <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm col-span-2 lg:col-span-1">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">הכנסה החודש</div>
                                <div className="text-3xl font-bold text-slate-800" dir="ltr">{fmt(stats.total_revenue_cents / 100)}</div>
                            </div>
                            {stats.pending_payment_verifications > 0 && (
                                <div className="col-span-2 lg:col-span-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 flex items-center gap-4">
                                    <span className="text-3xl">⚠️</span>
                                    <div>
                                        <div className="font-bold text-amber-900">{stats.pending_payment_verifications} דיווחי תשלום ממתינים לאישור</div>
                                        <div className="text-sm text-amber-700">לקוחות שסימנו "שילמתי" — אמת בטאב היומי</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
                        {(["today", "analytics"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                            >
                                {t === "today" ? "📋 גבייה יומית" : "📊 אנליטיקה"}
                            </button>
                        ))}
                    </div>

                    {/* ── TODAY TAB ── */}
                    {tab === "today" && (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                                <div>
                                    <h3 className="font-bold text-slate-800">דוח גבייה יומי — {new Date().toLocaleDateString("he-IL")}</h3>
                                    <p className="text-xs text-slate-500 mt-0.5">ניהול תשלומים לתורים של היום</p>
                                </div>
                                <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">סנכרון חי</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-right text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wide border-b border-slate-100">
                                            <th className="px-6 py-3">לקוח</th>
                                            <th className="px-6 py-3">שעה</th>
                                            <th className="px-6 py-3">סה״כ</th>
                                            <th className="px-6 py-3">שולם</th>
                                            <th className="px-6 py-3 text-emerald-600">יתרה</th>
                                            <th className="px-6 py-3">פעולות</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {dailyPayments.length === 0 ? (
                                            <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400">לא נמצאו תורים להיום</td></tr>
                                        ) : dailyPayments.map(p => (
                                            <tr key={p.appointment_id} className="hover:bg-slate-50/80 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="font-semibold text-slate-800">{p.client_name}</div>
                                                    <div className="text-xs text-slate-400">{p.client_phone}</div>
                                                </td>
                                                <td className="px-6 py-4 text-slate-600">
                                                    {new Date(p.starts_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                                                </td>
                                                <td className="px-6 py-4 font-semibold text-slate-700" dir="ltr">{fmt(p.total_price_cents / 100)}</td>
                                                <td className="px-6 py-4 text-slate-500" dir="ltr">{fmt(p.paid_cents / 100)}</td>
                                                <td className="px-6 py-4">
                                                    {p.remaining_cents > 0
                                                        ? <span className="font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full" dir="ltr">{fmt(p.remaining_cents / 100)}</span>
                                                        : <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">שולם ✨</span>
                                                    }
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col gap-1.5">
                                                        <a href={`/clients/${p.client_id}`} className="px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-semibold rounded-lg text-center hover:bg-slate-200 transition">
                                                            כרטיס לקוח
                                                        </a>
                                                        <button onClick={() => { setSelectedAppt(p); setIsPaymentModalOpen(true); }}
                                                            className="px-3 py-1.5 bg-black text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition">
                                                            הקלט תשלום 💳
                                                        </button>
                                                        {p.payment_sent_at && !p.payment_verified_at && (
                                                            <button onClick={async () => {
                                                                if (confirm("לאשר קבלת תשלום?")) {
                                                                    await apiFetch(`/api/appointments/${p.appointment_id}/verify-payment`, { method: "POST" });
                                                                    fetchData();
                                                                }
                                                            }} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition animate-pulse">
                                                                אשר קבלתי ✅
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ── ANALYTICS TAB ── */}
                    {tab === "analytics" && (
                        analytics ? (
                            <div className="space-y-6">

                                {/* Revenue by month */}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                                    <h3 className="font-bold text-slate-800 mb-4">הכנסה לפי חודש — 6 חודשים אחרונים</h3>
                                    <ResponsiveContainer width="100%" height={220}>
                                        <BarChart data={analytics.revenue_by_month} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                                            <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                                            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={v => `₪${Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + "k" : v}`} />
                                            <Tooltip formatter={(v) => [`₪${Number(v).toLocaleString()}`, "הכנסה"]} />
                                            <Bar dataKey="revenue" radius={[6, 6, 0, 0]} fill="#111827" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* Appointments by month */}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                                    <h3 className="font-bold text-slate-800 mb-4">תורים לפי חודש — 6 חודשים אחרונים</h3>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <LineChart data={analytics.appts_by_month} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                                            <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                                            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                                            <Tooltip formatter={(v) => [Number(v), "תורים"]} />
                                            <Line type="monotone" dataKey="count" stroke="#111827" strokeWidth={2.5} dot={{ r: 4, fill: "#111827" }} activeDot={{ r: 6 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Busiest days */}
                                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                                        <h3 className="font-bold text-slate-800 mb-4">ימים עמוסים — 90 ימים אחרונים</h3>
                                        <ResponsiveContainer width="100%" height={180}>
                                            <BarChart data={analytics.busiest_days} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                                                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                                                <Tooltip formatter={(v) => [Number(v), "תורים"]} />
                                                <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#111827" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>

                                    {/* New vs returning */}
                                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                                        <h3 className="font-bold text-slate-800 mb-4">לקוחות — 30 ימים אחרונים</h3>
                                        <div className="flex flex-col gap-4 mt-2">
                                            {[
                                                { label: "לקוחות חדשים", value: analytics.new_vs_returning.new, color: "bg-slate-900" },
                                                { label: "לקוחות קיימים", value: analytics.new_vs_returning.returning, color: "bg-slate-300" },
                                            ].map(item => {
                                                const total = analytics.new_vs_returning.new + analytics.new_vs_returning.returning;
                                                const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                                                return (
                                                    <div key={item.label}>
                                                        <div className="flex justify-between text-sm mb-1.5">
                                                            <span className="font-medium text-slate-700">{item.label}</span>
                                                            <span className="font-bold text-slate-900">{item.value} <span className="text-slate-400 font-normal">({pct}%)</span></span>
                                                        </div>
                                                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                                            <div className={`h-full ${item.color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {/* Artist performance */}
                                {analytics.artists.length > 0 && (
                                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                        <div className="px-6 py-4 border-b border-slate-100">
                                            <h3 className="font-bold text-slate-800">ביצועי אמנים</h3>
                                        </div>
                                        <div className="divide-y divide-slate-50">
                                            {analytics.artists.map((a, i) => (
                                                <div key={a.name} className="px-6 py-4 flex items-center gap-4">
                                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-500 flex-shrink-0">
                                                        {i + 1}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-semibold text-slate-800 truncate">{a.name}</div>
                                                        <div className="text-xs text-slate-400">{a.appointments} תורים</div>
                                                    </div>
                                                    <div className="text-left" dir="ltr">
                                                        <div className="font-bold text-slate-900">₪{a.revenue.toLocaleString()}</div>
                                                        <div className="text-xs text-slate-400">הכנסה כוללת</div>
                                                    </div>
                                                    <div
                                                        className="w-2 h-8 rounded-full flex-shrink-0"
                                                        style={{ backgroundColor: ["#111827","#374151","#6b7280","#9ca3af","#d1d5db"][Math.min(i, 4)] }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex justify-center items-center h-48">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
                            </div>
                        )
                    )}
                </div>

                <PaymentModal
                    isOpen={isPaymentModalOpen}
                    onClose={() => setIsPaymentModalOpen(false)}
                    onSuccess={handlePaymentSuccess}
                    appointment={selectedAppt}
                />
            </AppShell>
        </RequireAuth>
    );
}
