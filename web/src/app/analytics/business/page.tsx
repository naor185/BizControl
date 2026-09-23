"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
    ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Kpis {
    revenue_this_month_ils: number;
    revenue_growth_pct: number;
    appts_this_month: number;
    appts_growth_pct: number;
    avg_appt_value_ils: number;
}
interface AdvancedData {
    kpis: Kpis;
    hourly_heatmap: { hour: number; label: string; count: number }[];
    revenue_by_service: { service: string; count: number; revenue_ils: number }[];
    avg_value_trend: { month: string; avg_ils: number }[];
}

const fmt = (n: number) => `₪${n.toLocaleString("he-IL")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

function GrowthBadge({ value }: { value: number }) {
    const up = value > 0;
    const zero = value === 0;
    return (
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${zero ? "bg-slate-100 text-slate-500" : up ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {zero ? "0%" : pct(value)}
        </span>
    );
}

function KpiCard({ title, value, sub, growth, icon, color = "#7c3aed" }: {
    title: string; value: string; sub?: string; growth?: number; icon: string; color?: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5" style={{ borderTop: `3px solid ${color}` }}>
            <div className="flex justify-between items-start mb-2">
                <span className="text-2xl">{icon}</span>
                {growth !== undefined && <GrowthBadge value={growth} />}
            </div>
            <div className="text-2xl font-black text-slate-800 mt-1">{value}</div>
            <div className="text-sm font-semibold text-slate-600 mt-0.5">{title}</div>
            {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
        </div>
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function BusinessAnalyticsPage() {
    const [data, setData] = useState<AdvancedData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<AdvancedData>("/api/dashboard/advanced")
            .then(setData)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    return (
        <RequireAuth>
            <AppShell title="📊 Analytics עסקי">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600" />
                    </div>
                ) : !data ? (
                    <div className="text-center text-slate-400 py-16">שגיאה בטעינת הנתונים</div>
                ) : (
                    <div className="space-y-8 pb-12">

                        {/* ── KPIs ── */}
                        <section>
                            <h2 className="text-base font-bold text-slate-700 mb-3">📈 סיכום החודש</h2>
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                <KpiCard title="הכנסות החודש" value={fmt(data.kpis.revenue_this_month_ils)}
                                    growth={data.kpis.revenue_growth_pct} icon="💰" color="#7c3aed" />
                                <KpiCard title="תורים החודש" value={String(data.kpis.appts_this_month)}
                                    growth={data.kpis.appts_growth_pct} icon="📅" color="#0ea5e9" />
                                <KpiCard title="ממוצע לתור (30 יום)" value={fmt(data.kpis.avg_appt_value_ils)}
                                    icon="🧾" color="#6366f1" />
                            </div>
                        </section>

                        {/* ── Hourly Heatmap + Avg Value ── */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <section>
                                <h2 className="text-base font-bold text-slate-700 mb-3">🕐 עומס לפי שעה (90 יום)</h2>
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                    <ResponsiveContainer width="100%" height={180}>
                                        <BarChart data={data.hourly_heatmap} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                                            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                                            <Tooltip formatter={v => [v, "תורים"]} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                                            <Bar dataKey="count" radius={[4,4,0,0]}>
                                                {data.hourly_heatmap.map((entry, i) => {
                                                    const max = Math.max(...data.hourly_heatmap.map(h => h.count));
                                                    const intensity = max > 0 ? entry.count / max : 0;
                                                    const r = Math.round(124 + (intensity * (239-124)));
                                                    const g = Math.round(58 + (intensity * (68-58)));
                                                    const b = Math.round(237 + (intensity * (68-237)));
                                                    return <Cell key={i} fill={`rgb(${r},${g},${b})`} />;
                                                })}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>

                            <section>
                                <h2 className="text-base font-bold text-slate-700 mb-3">💳 ממוצע לתור — מגמה</h2>
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                    <ResponsiveContainer width="100%" height={180}>
                                        <LineChart data={data.avg_value_trend} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                                            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={v => `₪${v}`} />
                                            <Tooltip formatter={v => [`₪${Number(v).toLocaleString()}`, "ממוצע לתור"]}
                                                contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                                            <Line type="monotone" dataKey="avg_ils" stroke="#7c3aed"
                                                strokeWidth={2.5} dot={{ r: 4, fill: "#7c3aed" }} activeDot={{ r: 6 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>
                        </div>

                        {/* ── Revenue by Service ── */}
                        <section>
                            <h2 className="text-base font-bold text-slate-700 mb-3">🛎️ הכנסות לפי שירות — 90 יום אחרונים</h2>
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                {data.revenue_by_service.length === 0 ? (
                                    <div className="text-center text-slate-400 py-8">אין נתונים עדיין</div>
                                ) : (
                                    <>
                                        <ResponsiveContainer width="100%" height={200}>
                                            <BarChart data={data.revenue_by_service} layout="vertical"
                                                margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                                                <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }}
                                                    tickFormatter={v => `₪${Number(v) >= 1000 ? (Number(v)/1000).toFixed(0)+"k" : v}`} />
                                                <YAxis type="category" dataKey="service" width={90}
                                                    tick={{ fontSize: 11, fill: "#334155" }} />
                                                <Tooltip formatter={v => [`₪${Number(v).toLocaleString()}`, "הכנסות"]}
                                                    contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                                                <Bar dataKey="revenue_ils" radius={[0,6,6,0]} fill="#7c3aed" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                        <div className="mt-3 space-y-1">
                                            {data.revenue_by_service.map((s, i) => (
                                                <div key={i} className="flex justify-between items-center text-sm py-1.5 border-b border-slate-50 last:border-0">
                                                    <span className="text-slate-700 font-medium">{s.service}</span>
                                                    <div className="flex gap-4 text-right">
                                                        <span className="text-slate-400 text-xs">{s.count} תורים</span>
                                                        <span className="font-bold text-slate-800">{fmt(s.revenue_ils)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </section>

                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
