"use client";

import { useEffect, useState } from "react";
import { Crown, Repeat, UserMinus, type LucideIcon } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { apiFetch } from "@/lib/api";

interface ClientAnalytics {
    kpis: { retention_rate_pct: number; ltv_ils: number; churn_count: number };
    retention_trend: { month: string; new: number; returning: number; total: number; retention_pct: number }[];
}

interface ConsultationConversion {
    total_consultations: number;
    converted: number;
    not_converted: number;
    conversion_rate: number;
}

type ConsultPeriod = "week" | "month" | "2months";

const PERIODS: { key: ConsultPeriod; label: string }[] = [
    { key: "week", label: "שבוע" },
    { key: "month", label: "חודש" },
    { key: "2months", label: "חודשיים" },
];

function KpiCard({ icon: Icon, value, title, sub }: { icon: LucideIcon; value: string; title: string; sub: string }) {
    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mb-3" style={{ color: "var(--foreground)" }}>
                <Icon className="h-5 w-5" />
            </div>
            <div className="text-2xl font-black text-slate-800">{value}</div>
            <div className="text-sm font-semibold text-slate-600 mt-0.5">{title}</div>
            <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
        </div>
    );
}

export default function ClientAnalyticsTab() {
    const [data, setData] = useState<ClientAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [convState, setConvState] = useState<{ period: ConsultPeriod; data: ConsultationConversion | null } | null>(null);
    const [period, setPeriod] = useState<ConsultPeriod>("month");
    const conv = convState?.data ?? null;
    const convLoading = convState?.period !== period;

    useEffect(() => {
        apiFetch<ClientAnalytics>("/api/clients/analytics")
            .then(setData)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        let alive = true;
        apiFetch<ConsultationConversion>(`/api/dashboard/consultation-conversion?period=${period}`)
            .then(d => { if (alive) setConvState({ period, data: d }); })
            .catch(() => { if (alive) setConvState({ period, data: null }); });
        return () => { alive = false; };
    }, [period]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-400" />
            </div>
        );
    }
    if (!data) return <div className="text-center text-slate-400 py-16">שגיאה בטעינת הנתונים</div>;

    return (
        <div className="space-y-6 pb-10">
            <section>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <KpiCard icon={Repeat} value={`${data.kpis.retention_rate_pct}%`} title="שיעור שימור" sub="לקוחות שחזרו לתור נוסף ב-90 הימים האחרונים" />
                    <KpiCard icon={Crown} value={`₪${data.kpis.ltv_ils.toLocaleString("he-IL")}`} title="ערך ממוצע ללקוח" sub="סך התשלומים הממוצע של לקוח, כל הזמנים" />
                    <KpiCard icon={UserMinus} value={String(data.kpis.churn_count)} title="לקוחות שנעלמו" sub="לא הגיעו לתור יותר מ-60 יום" />
                </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h3 className="font-bold text-slate-800 mb-1">לקוחות חדשים מול חוזרים</h3>
                <p className="text-xs text-slate-400 mb-4">חדש = הלקוח הגיע לתור הראשון שלו אי פעם באותו חודש. 6 חודשים אחרונים.</p>
                <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.retention_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                        <Tooltip
                            formatter={(v, name) => [Number(v), name === "new" ? "חדשים" : "חוזרים"]}
                            contentStyle={{ borderRadius: 10, fontSize: 12 }}
                        />
                        <Legend formatter={v => (v === "new" ? "חדשים" : "חוזרים")} />
                        <Bar dataKey="returning" stackId="a" fill="var(--primary)" name="returning" />
                        <Bar dataKey="new" stackId="a" fill="var(--primary-200)" radius={[6, 6, 0, 0]} name="new" />
                    </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-3 flex-wrap">
                    {data.retention_trend.map(r => (
                        <div key={r.month} className="text-center">
                            <div className="text-xs text-slate-400">{r.month}</div>
                            <div className="text-sm font-bold text-slate-700">{r.retention_pct}%</div>
                            <div className="text-[10px] text-slate-400">חוזרים</div>
                        </div>
                    ))}
                </div>
            </section>

            <section className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-6 transition-opacity ${convLoading ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <h3 className="font-bold text-slate-800">אחוזי המרה — יעוצים לתורים</h3>
                    <div className="flex bg-slate-50 border border-slate-200 rounded-xl overflow-hidden text-xs">
                        {PERIODS.map(p => (
                            <button
                                key={p.key}
                                onClick={() => setPeriod(p.key)}
                                className={`px-3 py-1.5 font-semibold transition-colors ${period === p.key ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
                {!conv ? (
                    <div className="text-center text-slate-400 text-sm py-8">{convLoading ? "טוען..." : "שגיאה בטעינת הנתונים"}</div>
                ) : conv.total_consultations === 0 ? (
                    <div className="text-center text-slate-400 text-sm py-8">אין פגישות יעוץ בתקופה שנבחרה</div>
                ) : (
                    <>
                        <div className="flex items-center gap-6 mb-4">
                            <div className="text-center">
                                <div className="text-4xl font-bold text-slate-900">{conv.conversion_rate}%</div>
                                <div className="text-xs text-slate-400 mt-1">אחוז המרה</div>
                            </div>
                            <div className="flex-1 space-y-3">
                                {[
                                    { label: "קבעו תור אחרי יעוץ", value: conv.converted, color: "bg-slate-900" },
                                    { label: "לא קבעו עדיין", value: conv.not_converted, color: "bg-slate-200" },
                                ].map(item => {
                                    const pct = Math.round((item.value / conv.total_consultations) * 100);
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
                            סה״כ {conv.total_consultations} פגישות יעוץ נרשמו בתקופה שנבחרה
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
