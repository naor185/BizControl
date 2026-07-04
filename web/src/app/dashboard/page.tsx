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

type PendingPayment = {
    appointment_id: string;
    client_id: string;
    client_name: string;
    client_phone: string;
    starts_at: string;
    total_price_cents: number;
    paid_cents: number;
    remaining_cents: number;
    payment_sent_at: string | null;
};

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

type ConsultationConversion = {
    total_consultations: number;
    converted: number;
    not_converted: number;
    conversion_rate: number;
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
    const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
    const [pendingExpanded, setPendingExpanded] = useState(false);
    const [analytics, setAnalytics] = useState<Analytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"today" | "analytics">("today");
    const [error, setError] = useState<string | null>(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedAppt, setSelectedAppt] = useState<DailyPayment | null>(null);
    const [pendingDeposits, setPendingDeposits] = useState<any[]>([]);
    const [confirmingDeposit, setConfirmingDeposit] = useState<string | null>(null);
    const [waivingDeposit, setWaivingDeposit] = useState<string | null>(null);
    const [depositCashier, setDepositCashier] = useState<{ id: string; amount: number; clientName: string } | null>(null);
    const [depositMethod, setDepositMethod] = useState("bit");
    const [depositSendReceipt, setDepositSendReceipt] = useState(true);
    const [depositReceipt, setDepositReceipt] = useState<{ invoiceId: string; docNum?: number } | null>(null);
    const [consultationConv, setConsultationConv] = useState<ConsultationConversion | null>(null);
    type OccupancyPeriod = { booked_minutes: number; total_minutes: number; percent: number; count: number };
    type OccupancyData = { this_week: OccupancyPeriod; last_week: OccupancyPeriod; this_month: OccupancyPeriod; last_month: OccupancyPeriod; work_hours_per_day: number };
    const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);

    const [bizfindStats, setBizfindStats] = useState<{
        marketplace_visible: boolean;
        studio_slug: string;
        views: { last_7_days: number; last_30_days: number; total: number };
        favorites_count: number;
        booking_requests: { this_month: number; total: number };
        linked_clients: number;
        daily_views: { date: string; count: number }[];
    } | null>(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [statsData, paymentsData, pendingData, depositsData, bfData, occData] = await Promise.all([
                apiFetch<DashboardStats>("/api/dashboard/stats"),
                apiFetch<DailyPayment[]>("/api/dashboard/daily-payments"),
                apiFetch<PendingPayment[]>("/api/dashboard/pending-payments"),
                apiFetch<any[]>("/api/appointments/pending-deposits").catch(() => []),
                apiFetch<any>("/api/marketplace/my/analytics").catch(() => null),
                apiFetch<OccupancyData>("/api/dashboard/occupancy").catch(() => null),
            ]);
            setStats(statsData);
            setDailyPayments(paymentsData);
            setPendingPayments(pendingData);
            setPendingDeposits(depositsData);
            setBizfindStats(bfData);
            setOccupancy(occData);
        } catch {
            setError("שגיאה בטעינת נתונים");
        } finally {
            setLoading(false);
        }
    };

    const [sendingReminder, setSendingReminder] = useState<string | null>(null);

    const sendDepositReminder = async (id: string) => {
        setSendingReminder(id);
        try {
            await apiFetch(`/api/appointments/${id}/send-deposit-reminder`, { method: "POST" });
            setPendingDeposits(prev => prev.map(d =>
                d.appointment_id === id
                    ? { ...d, deposit_reminder_sent: true, deposit_reminder_sent_at: new Date().toISOString() }
                    : d
            ));
        } catch (e: any) {
            alert(e?.message || "שגיאה בשליחת תזכורת");
        } finally {
            setSendingReminder(null);
        }
    };

    const waiveDeposit = async (id: string) => {
        setWaivingDeposit(id);
        try {
            await apiFetch(`/api/appointments/${id}/waive-deposit`, { method: "POST" });
            setPendingDeposits(prev => prev.filter(d => d.appointment_id !== id));
        } catch (e: any) {
            alert(e?.message || "שגיאה");
        } finally {
            setWaivingDeposit(null);
        }
    };

    const openDepositCashier = (d: any) => {
        setDepositMethod("bit");
        setDepositSendReceipt(true);
        setDepositCashier({ id: d.appointment_id, amount: d.deposit_amount_cents, clientName: d.client_name });
    };

    const confirmDeposit = async () => {
        if (!depositCashier) return;
        setConfirmingDeposit(depositCashier.id);
        try {
            const res = await apiFetch<{ invoice_id: string | null }>(`/api/appointments/${depositCashier.id}/verify-payment?method=${depositMethod}&send_receipt=${depositSendReceipt}`, { method: "POST" });
            setPendingDeposits(prev => prev.filter(d => d.appointment_id !== depositCashier.id));
            setDepositCashier(null);
            if (res.invoice_id) setDepositReceipt({ invoiceId: res.invoice_id });
        } catch (e: any) {
            alert(e?.message || "שגיאה באישור");
        } finally {
            setConfirmingDeposit(null);
        }
    };

    const fetchAnalytics = async () => {
        try {
            const [data, convData] = await Promise.all([
                apiFetch<Analytics>("/api/dashboard/analytics"),
                apiFetch<ConsultationConversion>("/api/dashboard/consultation-conversion").catch(() => null),
            ]);
            setAnalytics(data);
            setConsultationConv(convData);
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

                    {/* ── Calendar Occupancy Card ── */}
                    {occupancy && (() => {
                        const R = 52, STROKE = 10;
                        const circ = 2 * Math.PI * R;
                        const arc = (pct: number) => circ * (1 - pct / 100);

                        const DonutChart = ({ pct, color, label, prev, prevLabel, bookedH, totalH, count }: {
                            pct: number; color: string; label: string;
                            prev: number; prevLabel: string;
                            bookedH: number; totalH: number; count: number;
                        }) => {
                            const diff = pct - prev;
                            return (
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="relative w-32 h-32">
                                        <svg width="128" height="128" viewBox="0 0 128 128" className="-rotate-90">
                                            {/* Track */}
                                            <circle cx="64" cy="64" r={R} fill="none" stroke="#f1f5f9" strokeWidth={STROKE} />
                                            {/* Arc */}
                                            <circle cx="64" cy="64" r={R} fill="none" stroke={color}
                                                strokeWidth={STROKE} strokeLinecap="round"
                                                strokeDasharray={circ}
                                                strokeDashoffset={arc(pct)}
                                                style={{ transition: "stroke-dashoffset 0.8s ease" }}
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                                            <span className="text-2xl font-black text-slate-800 leading-none">{pct}%</span>
                                            <span className="text-[10px] text-slate-400 mt-0.5">{label}</span>
                                        </div>
                                    </div>
                                    {/* Comparison badge */}
                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${diff > 0 ? "bg-emerald-50 text-emerald-700" : diff < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"}`}>
                                        {diff > 0 ? `▲ +${diff}%` : diff < 0 ? `▼ ${diff}%` : "= זהה"} {prevLabel}
                                    </span>
                                    {/* Detail line */}
                                    <div className="text-center text-[11px] text-slate-500 leading-snug">
                                        <div className="font-semibold">{bookedH}h מתוך {totalH}h</div>
                                        <div className="text-slate-400">{count} תורים · {prevLabel}: {prev}%</div>
                                    </div>
                                </div>
                            );
                        };

                        const wkColor  = occupancy.this_week.percent  >= 75 ? "#10b981" : occupancy.this_week.percent  >= 40 ? "#0ea5e9" : "#94a3b8";
                        const moColor  = occupancy.this_month.percent >= 75 ? "#10b981" : occupancy.this_month.percent >= 40 ? "#8b5cf6" : "#94a3b8";

                        return (
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5" dir="rtl">
                                <div className="flex items-center justify-between mb-5">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">📅 מילוי יומן</span>
                                    <span className="text-[10px] text-slate-400">{occupancy.work_hours_per_day}h עבודה ביום</span>
                                </div>
                                <div className="flex gap-4 justify-around">
                                    <DonutChart
                                        pct={occupancy.this_week.percent} color={wkColor} label="השבוע"
                                        prev={occupancy.last_week.percent} prevLabel="משבוע שעבר"
                                        bookedH={Math.round(occupancy.this_week.booked_minutes / 60)}
                                        totalH={Math.round(occupancy.this_week.total_minutes / 60)}
                                        count={occupancy.this_week.count}
                                    />
                                    <div className="w-px bg-slate-100" />
                                    <DonutChart
                                        pct={occupancy.this_month.percent} color={moColor} label="החודש"
                                        prev={occupancy.last_month.percent} prevLabel="מחודש שעבר"
                                        bookedH={Math.round(occupancy.this_month.booked_minutes / 60)}
                                        totalH={Math.round(occupancy.this_month.total_minutes / 60)}
                                        count={occupancy.this_month.count}
                                    />
                                </div>
                            </div>
                        );
                    })()}

                    {/* KPI row */}
                    {stats && (
                        <div className="grid gap-4 grid-cols-2">
                            <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">תורים היום</div>
                                <div className="text-4xl font-bold text-slate-800">{stats.appointments_today}</div>
                            </div>
                            <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">לקוחות מועדון</div>
                                <div className="text-4xl font-bold text-slate-800">{stats.total_club_members}</div>
                            </div>
                            {pendingPayments.length > 0 && (
                                <div className="col-span-2 lg:col-span-3 rounded-2xl border-2 border-amber-400 bg-amber-50 overflow-hidden">
                                    <button
                                        onClick={() => setPendingExpanded(o => !o)}
                                        className="w-full p-5 flex items-center gap-4 text-right hover:bg-amber-100/60 transition-colors"
                                    >
                                        <span className="text-3xl">⚠️</span>
                                        <div className="flex-1">
                                            <div className="font-bold text-amber-900">{pendingPayments.length} דיווחי תשלום ממתינים לאישור</div>
                                            <div className="text-sm text-amber-700">לקוחות שסימנו "שילמתי" — לחץ לפירוט</div>
                                        </div>
                                        <span className="text-amber-600 text-sm font-semibold">{pendingExpanded ? "▲ סגור" : "▼ פרוס"}</span>
                                    </button>
                                    {pendingExpanded && (
                                        <div className="border-t border-amber-300 divide-y divide-amber-200">
                                            {pendingPayments.map(p => (
                                                <div key={p.appointment_id} className="px-5 py-3 flex items-center gap-4 bg-white/60">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-semibold text-slate-800">{p.client_name}</div>
                                                        <div className="text-xs text-slate-500">{p.client_phone} · {new Date(p.starts_at).toLocaleDateString("he-IL")}</div>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <div className="font-bold text-rose-600" dir="ltr">{fmt(p.remaining_cents / 100)}</div>
                                                        <div className="text-xs text-slate-400">נותר לתשלום</div>
                                                    </div>
                                                    <div className="flex gap-2 shrink-0">
                                                        <a
                                                            href={`/clients/${p.client_id}`}
                                                            className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition"
                                                        >
                                                            פתח לקוח
                                                        </a>
                                                        <button
                                                            onClick={async () => {
                                                                if (confirm(`לאשר קבלת תשלום מ-${p.client_name}?`)) {
                                                                    await apiFetch(`/api/appointments/${p.appointment_id}/verify-payment`, { method: "POST" });
                                                                    fetchData();
                                                                }
                                                            }}
                                                            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition"
                                                        >
                                                            אשר ✅
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── PENDING DEPOSITS ── */}
                    {pendingDeposits.length > 0 && (
                        <div className="bg-white rounded-2xl border-2 border-amber-300 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
                                <span className="text-xl">💰</span>
                                <div className="flex-1">
                                    <div className="font-bold text-amber-900">ממתינים לאישור מקדמה</div>
                                    <div className="text-xs text-amber-700">{pendingDeposits.length} תורים — ראית אסמכתא בוואטסאפ? לחץ אשר</div>
                                </div>
                            </div>
                            <div className="divide-y divide-slate-100">
                                {pendingDeposits.map(d => (
                                    <div key={d.appointment_id} className="px-5 py-4 flex items-center gap-3 flex-wrap">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-slate-800">{d.client_name}</div>
                                            <div className="text-xs text-slate-500">
                                                {d.title} · {d.starts_at ? new Date(d.starts_at).toLocaleDateString("he-IL") + " " + new Date(d.starts_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "—"}
                                            </div>
                                            <div className="text-xs font-bold text-amber-600 mt-0.5">
                                                מקדמה: ₪{(d.deposit_amount_cents / 100).toLocaleString()}
                                            </div>
                                            {/* Reminder status */}
                                            <div className="mt-1">
                                                {d.deposit_reminder_sent ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                                                        ✅ תזכורת נשלחה{d.deposit_reminder_sent_at ? ` · ${new Date(d.deposit_reminder_sent_at).toLocaleDateString("he-IL")}` : ""}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                                                        🔔 טרם נשלחה תזכורת
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                                            <button
                                                type="button"
                                                onClick={() => sendDepositReminder(d.appointment_id)}
                                                disabled={sendingReminder === d.appointment_id}
                                                className="px-3 py-1.5 text-xs font-semibold text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-50 transition disabled:opacity-50"
                                                title="שלח תזכורת WhatsApp עכשיו"
                                            >
                                                {sendingReminder === d.appointment_id ? "שולח..." : "שלח תזכורת 🔔"}
                                            </button>
                                            <button
                                                onClick={() => waiveDeposit(d.appointment_id)}
                                                disabled={waivingDeposit === d.appointment_id}
                                                className="px-3 py-1.5 text-xs font-semibold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition disabled:opacity-50"
                                                title="נועל את התור ללא גביית מקדמה"
                                            >
                                                {waivingDeposit === d.appointment_id ? "..." : "מאשר ללא מקדמה 🔒"}
                                            </button>
                                            <a href={`https://wa.me/${d.client_phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"
                                                className="px-3 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition">
                                                💬 וואטסאפ
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => openDepositCashier(d)}
                                                className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition"
                                            >
                                                קיבלתי ✅
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── BizFind Analytics Card ── */}
                    {bizfindStats && (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">🔍</span>
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-sm">BizFind — חשיפה בשוק</h3>
                                        <p className="text-xs text-slate-400 mt-0.5">ביצועי הפרופיל שלך באפליקציית החיפוש</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${bizfindStats.marketplace_visible ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                        {bizfindStats.marketplace_visible ? "🟢 גלוי" : "⚪ מוסתר"}
                                    </span>
                                    {bizfindStats.studio_slug && (
                                        <a href={`${process.env.NEXT_PUBLIC_BIZFIND_URL || "https://bizfind.co.il"}/b/${bizfindStats.studio_slug}`}
                                            target="_blank" rel="noopener"
                                            className="text-xs text-violet-600 font-semibold hover:underline">
                                            צפה ←
                                        </a>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-x-reverse divide-slate-100">
                                {[
                                    { label: "צפיות 7 ימים", value: bizfindStats.views.last_7_days, icon: "👁️" },
                                    { label: "צפיות 30 ימים", value: bizfindStats.views.last_30_days, icon: "📈" },
                                    { label: "מועדפים", value: bizfindStats.favorites_count, icon: "❤️" },
                                    { label: "בקשות תור החודש", value: bizfindStats.booking_requests.this_month, icon: "📋" },
                                ].map(({ label, value, icon }) => (
                                    <div key={label} className="px-5 py-4 text-center">
                                        <div className="text-xl mb-1">{icon}</div>
                                        <div className="text-2xl font-black text-slate-800">{value.toLocaleString()}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">{label}</div>
                                    </div>
                                ))}
                            </div>
                            {bizfindStats.daily_views.length > 0 && (
                                <div className="px-5 pb-4">
                                    <div className="text-xs text-slate-400 mb-2 font-semibold">צפיות יומיות — 30 ימים אחרונים</div>
                                    <ResponsiveContainer width="100%" height={60}>
                                        <BarChart data={bizfindStats.daily_views} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                            <Bar dataKey="count" radius={[3, 3, 0, 0]} fill="#7c3aed" opacity={0.85} />
                                            <Tooltip
                                                formatter={(v) => [Number(v), "צפיות"]}
                                                labelFormatter={(l) => new Date(l).toLocaleDateString("he-IL")}
                                                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                            {!bizfindStats.marketplace_visible && (
                                <div className="px-5 py-3 bg-violet-50 border-t border-violet-100 flex items-center justify-between">
                                    <span className="text-xs text-violet-700">הפרופיל שלך לא גלוי ב-BizFind — הפעל כדי לקבל לקוחות חדשים</span>
                                    <a href="/business" className="text-xs font-bold text-violet-700 underline">הגדר ←</a>
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

                                {/* Consultation conversion */}
                                {consultationConv && consultationConv.total_consultations > 0 && (
                                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                                        <h3 className="font-bold text-slate-800 mb-4">אחוזי המרה — יעוצים לתורים</h3>
                                        <div className="flex items-center gap-6 mb-4">
                                            <div className="text-center">
                                                <div className="text-4xl font-bold text-slate-900">{consultationConv.conversion_rate}%</div>
                                                <div className="text-xs text-slate-400 mt-1">אחוז המרה</div>
                                            </div>
                                            <div className="flex-1 space-y-3">
                                                {[
                                                    { label: "קבעו תור אחרי יעוץ", value: consultationConv.converted, color: "bg-slate-900" },
                                                    { label: "לא קבעו עדיין", value: consultationConv.not_converted, color: "bg-slate-200" },
                                                ].map(item => {
                                                    const pct = consultationConv.total_consultations > 0
                                                        ? Math.round((item.value / consultationConv.total_consultations) * 100)
                                                        : 0;
                                                    return (
                                                        <div key={item.label}>
                                                            <div className="flex justify-between text-sm mb-1">
                                                                <span className="text-slate-600">{item.label}</span>
                                                                <span className="font-bold text-slate-800">{item.value} <span className="text-slate-400 font-normal">({pct}%)</span></span>
                                                            </div>
                                                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                                <div className={`h-full ${item.color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="text-xs text-slate-400 border-t border-slate-100 pt-3">
                                            סה״כ {consultationConv.total_consultations} פגישות יעוץ נרשמו במערכת
                                        </div>
                                    </div>
                                )}

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

                {/* ── Deposit Cashier Modal ── */}
                {depositCashier && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setDepositCashier(null)}>
                        <div className="bg-white rounded-t-3xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
                            <div className="text-center mb-5">
                                <div className="text-lg font-black text-slate-800">אישור קבלת מקדמה</div>
                                <div className="text-sm text-slate-500 mt-0.5">{depositCashier.clientName}</div>
                                <div className="text-3xl font-black text-emerald-600 mt-2">
                                    ₪{(depositCashier.amount / 100).toLocaleString()}
                                </div>
                            </div>

                            <div className="mb-5">
                                <div className="text-xs font-bold text-slate-500 mb-2 text-right">באיזה אמצעי קיבלת?</div>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { value: "bit", label: "Bit", icon: "💙" },
                                        { value: "paybox", label: "PayBox", icon: "💜" },
                                        { value: "cash", label: "מזומן", icon: "💵" },
                                        { value: "credit_card", label: "כרטיס", icon: "💳" },
                                        { value: "bank_transfer", label: "העברה", icon: "🏦" },
                                        { value: "check", label: "צ'ק", icon: "📄" },
                                    ].map(m => (
                                        <button
                                            key={m.value}
                                            type="button"
                                            onClick={() => setDepositMethod(m.value)}
                                            className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-xs font-bold transition-all ${
                                                depositMethod === m.value
                                                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                                            }`}
                                        >
                                            <span className="text-lg">{m.icon}</span>
                                            {m.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Send receipt toggle */}
                            <button
                                type="button"
                                onClick={() => setDepositSendReceipt(v => !v)}
                                className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 transition-all mb-4 ${depositSendReceipt ? "bg-sky-50 border-sky-300" : "bg-slate-50 border-slate-200"}`}
                            >
                                <div className={`relative w-10 h-6 rounded-full transition-colors ${depositSendReceipt ? "bg-sky-500" : "bg-slate-300"}`}>
                                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${depositSendReceipt ? "left-4" : "left-0.5"}`} />
                                </div>
                                <span className={`text-sm font-bold ${depositSendReceipt ? "text-sky-700" : "text-slate-500"}`}>
                                    {depositSendReceipt ? "📨 שלח קישור קבלה ללקוח" : "🔕 אל תשלח קישור קבלה"}
                                </span>
                            </button>

                            <div className="flex gap-3">
                                <button type="button" onClick={() => setDepositCashier(null)}
                                    className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold text-sm">
                                    ביטול
                                </button>
                                <button type="button" onClick={confirmDeposit} disabled={!!confirmingDeposit}
                                    className="flex-[2] py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm disabled:opacity-60 hover:bg-emerald-700 transition">
                                    {confirmingDeposit ? "מאשר..." : "✅ אשר וצור קבלה"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Receipt Created Modal ── */}
                {depositReceipt && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDepositReceipt(null)}>
                        <div className="bg-white rounded-3xl w-full max-w-sm p-8 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
                            <div className="text-5xl mb-3">🧾</div>
                            <div className="text-xl font-black text-slate-800 mb-1">קבלה נוצרה!</div>
                            <div className="text-sm text-slate-500 mb-6">המקדמה אושרה והקבלה הופקה בהצלחה</div>
                            <div className="flex gap-3">
                                <button type="button" onClick={() => setDepositReceipt(null)}
                                    className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold text-sm">
                                    סגור
                                </button>
                                <button type="button" onClick={() => {
                                    window.open(`/receipt/${depositReceipt.invoiceId}`, "_blank");
                                }}
                                    className="flex-[2] py-3 rounded-2xl bg-slate-900 text-white font-black text-sm hover:bg-slate-700 transition">
                                    🧾 צפה בקבלה
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
