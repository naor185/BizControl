"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { getPayroll, PayrollSummary } from "@/lib/api";

export default function StaffPage() {
    const [payroll, setPayroll] = useState<PayrollSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(new Date().getMonth() + 1);
    const [year, setYear] = useState(new Date().getFullYear());

    const fetchPayroll = async () => {
        try {
            setLoading(true);
            const lastDay = new Date(year, month, 0).getDate();
            const start = `${year}-${String(month).padStart(2, '0')}-01T00:00:00`;
            const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}T23:59:59`;
            const data = await getPayroll(start, end);
            setPayroll(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPayroll();
    }, [month, year]);

    return (
        <RequireAuth>
            <AppShell title="ניהול צוות ושכר">
                <div className="space-y-8">
                    {/* Filters */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                        <select
                            value={year}
                            onChange={(e) => setYear(parseInt(e.target.value))}
                            className="px-4 py-2 border rounded-xl bg-white font-medium"
                        >
                            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <select
                            value={month}
                            onChange={(e) => setMonth(parseInt(e.target.value))}
                            className="px-4 py-2 border rounded-xl bg-white font-medium"
                        >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                <option key={m} value={m}>
                                    {new Date(2000, m - 1).toLocaleString('he-IL', { month: 'long' })}
                                </option>
                            ))}
                        </select>
                        <div className="mr-auto text-sm text-slate-400 font-bold uppercase tracking-widest">דוח תקופתי</div>
                    </div>

                    {loading ? (
                        <div className="h-64 bg-slate-50 animate-pulse rounded-3xl" />
                    ) : !payroll ? null : (
                        <div className="space-y-6">
                            {/* Summary Card */}
                            <div className="bg-zinc-900 text-white p-8 rounded-3xl shadow-xl flex items-center justify-between">
                                <div>
                                    <h3 className="text-zinc-400 font-bold uppercase tracking-widest text-xs mb-1">סה״כ שכר לתשלום (חודשי)</h3>
                                    <div className="text-4xl font-black" dir="ltr">₪{payroll.grand_total.toLocaleString()}</div>
                                </div>
                                <div className="p-4 bg-white/10 rounded-2xl text-2xl">💰</div>
                            </div>

                            {/* Table */}
                            <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-right">
                                        <thead>
                                            <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-widest border-b border-slate-100">
                                                <th className="px-8 py-4">עובד/ת</th>
                                                <th className="px-8 py-4">סוג שכר</th>
                                                <th className="px-8 py-4">שעות</th>
                                                <th className="px-8 py-4">שכר שעתי</th>
                                                <th className="px-8 py-4">עמלות</th>
                                                <th className="px-8 py-4 text-emerald-600">סה״כ לתשלום</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {payroll.items.map((item) => (
                                                <tr key={item.user_id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-8 py-5 font-bold text-slate-800">{item.display_name}</td>
                                                    <td className="px-8 py-5">
                                                        <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${
                                                            item.pay_type === 'hourly' ? 'bg-blue-50 text-blue-600' : 
                                                            item.pay_type === 'commission' ? 'bg-purple-50 text-purple-600' : 'bg-slate-50 text-slate-400'
                                                        }`}>
                                                            {item.pay_type === 'hourly' ? 'שעתי' : item.pay_type === 'commission' ? 'עמלות' : 'ללא'}
                                                        </span>
                                                    </td>
                                                    <td className="px-8 py-5 text-slate-600 font-mono">{item.total_hours.toFixed(1)}</td>
                                                    <td className="px-8 py-5 text-slate-600" dir="ltr">₪{item.hourly_pay.toLocaleString()}</td>
                                                    <td className="px-8 py-5 text-slate-600" dir="ltr">₪{item.commission_pay.toLocaleString()}</td>
                                                    <td className="px-8 py-5">
                                                        <div className="text-lg font-black text-emerald-600" dir="ltr">₪{item.total_pay.toLocaleString()}</div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
