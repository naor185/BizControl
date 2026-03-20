"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch, DashboardStats } from "@/lib/api";
import PaymentModal from "@/components/PaymentModal";

// Local DashboardStats removed in favor of @/lib/api version

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

export default function Page() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [dailyPayments, setDailyPayments] = useState<DailyPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedAppt, setSelectedAppt] = useState<DailyPayment | null>(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [statsData, paymentsData] = await Promise.all([
                apiFetch<DashboardStats>("/api/dashboard/stats"),
                apiFetch<DailyPayment[]>("/api/dashboard/daily-payments")
            ]);
            setStats(statsData);
            setDailyPayments(paymentsData);
        } catch (err: any) {
            setError("שגיאה בטעינת נתונים");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handlePaymentSuccess = () => {
        setIsPaymentModalOpen(false);
        fetchData();
    };

    const formatCurrency = (cents: number) => {
        return (cents / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });
    };

    return (
        <RequireAuth>
            <AppShell title="לוח בקרה">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
                    </div>
                ) : error ? (
                    <div className="bg-red-50 text-red-600 p-4 rounded-xl">
                        {error}
                    </div>
                ) : stats ? (
                    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
                        
                        {/* Standard Stats Row - Simplified for Operations */}
                        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">תורים להיום</div>
                                <div className="text-4xl font-bold text-slate-800">{stats.appointments_today}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">לקוחות במועדון</div>
                                <div className="text-4xl font-bold text-slate-800">{stats.total_club_members}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">הודעות ממתינות</div>
                                <div className="text-4xl font-bold text-slate-800">{stats.pending_messages}</div>
                            </div>
                            {stats.pending_payment_verifications > 0 && (
                                <div className="rounded-2xl border-2 border-amber-500 bg-amber-50 p-8 shadow-lg animate-pulse lg:col-span-3">
                                    <div className="text-xs font-bold text-amber-800 uppercase mb-2 tracking-widest">ממתין לאימות תשלום ⚠️</div>
                                    <div className="text-3xl font-black text-amber-900">{stats.pending_payment_verifications} דיווחים שמחכים לאישור שלך</div>
                                    <p className="text-sm text-amber-700 mt-2 font-bold">לקוחות שסימנו "שילמתי" ומחכים לאימות ידני שלך בדוח הגבייה למטה</p>
                                </div>
                            )}
                        </div>

                        {/* Daily Payments Table */}
                        <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
                            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800">דוח גבייה יומי - {new Date().toLocaleDateString('he-IL')}</h3>
                                    <p className="text-sm text-slate-500 mt-1">נהל את התשלומים מול הלקוחות שנכנסו היום לסטודיו</p>
                                </div>
                                <div className="flex gap-2">
                                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">סנכרון חי Active</span>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-right">
                                    <thead>
                                        <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-widest border-b border-slate-100">
                                            <th className="px-8 py-4">לקוח</th>
                                            <th className="px-8 py-4">שעה</th>
                                            <th className="px-8 py-4">מחיר כולל</th>
                                            <th className="px-8 py-4">שולם</th>
                                            <th className="px-8 py-4 text-emerald-600">יתרה לתשלום</th>
                                            <th className="px-8 py-4">פעולות</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {dailyPayments.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="px-8 py-12 text-center text-slate-400 italic">לא נמצאו תורים להיום</td>
                                            </tr>
                                        ) : dailyPayments.map((p) => (
                                            <tr key={p.appointment_id} className="hover:bg-slate-50/80 transition-colors">
                                                <td className="px-8 py-5">
                                                    <div className="font-bold text-slate-800">{p.client_name}</div>
                                                    <div className="text-xs text-slate-400">{p.client_phone}</div>
                                                </td>
                                                <td className="px-8 py-5 text-slate-600 font-medium">
                                                    {new Date(p.starts_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className="px-8 py-5 font-bold text-slate-700" dir="ltr">{formatCurrency(p.total_price_cents)}</td>
                                                <td className="px-8 py-5 text-slate-500" dir="ltr">{formatCurrency(p.paid_cents)}</td>
                                                <td className="px-8 py-5">
                                                    {p.remaining_cents > 0 ? (
                                                        <div className="font-black text-rose-500 bg-rose-50 px-3 py-1 rounded-full inline-block" dir="ltr">
                                                            {formatCurrency(p.remaining_cents)}
                                                        </div>
                                                    ) : (
                                                        <div className="font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full inline-block">שולם במלואו ✨</div>
                                                    )}
                                                </td>
                                                <td className="px-8 py-5">
                                                    <div className="flex flex-col gap-2">
                                                        <a
                                                            href={`/clients/${p.client_id}`}
                                                            className="px-4 py-2 bg-slate-100 text-slate-900 text-center text-xs font-bold rounded-xl hover:bg-slate-200 transition-all shadow-sm"
                                                        >
                                                            פתיחת כרטיס
                                                        </a>
                                                        <button
                                                            onClick={() => {
                                                                setSelectedAppt(p);
                                                                setIsPaymentModalOpen(true);
                                                            }}
                                                            className="px-4 py-2 bg-indigo-600 text-white text-center text-xs font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-sm"
                                                        >
                                                            הקלט תשלום 💳
                                                        </button>
                                                        {p.payment_sent_at && !p.payment_verified_at && (
                                                            <button
                                                                onClick={async () => {
                                                                    if (confirm("האם לאשר שקיבלת את התשלום בביט/פייבוקס?")) {
                                                                        try {
                                                                            await apiFetch(`/api/appointments/${p.appointment_id}/verify-payment`, { method: "POST" });
                                                                            window.location.reload();
                                                                        } catch (err) {
                                                                            alert("שגיאה באימות התשלום");
                                                                        }
                                                                    }
                                                                }}
                                                                className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-md animate-bounce"
                                                            >
                                                                אשר שקיבלתי כסף ✅
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
                    </div>
                ) : null}

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
