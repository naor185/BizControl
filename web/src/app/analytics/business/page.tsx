"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
    ResponsiveContainer, CartesianGrid, Cell, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Kpis {
    revenue_this_month_ils: number;
    revenue_growth_pct: number;
    appts_this_month: number;
    appts_growth_pct: number;
    retention_rate_pct: number;
    ltv_ils: number;
    avg_appt_value_ils: number;
    churn_count: number;
}
interface AdvancedData {
    kpis: Kpis;
    retention_trend: { month: string; new: number; returning: number; total: number; retention_pct: number }[];
    hourly_heatmap: { hour: number; label: string; count: number }[];
    revenue_by_service: { service: string; count: number; revenue_ils: number }[];
    top_clients: { name: string; appointments: number; revenue_ils: number }[];
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
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <KpiCard title="הכנסות החודש" value={fmt(data.kpis.revenue_this_month_ils)}
                                    growth={data.kpis.revenue_growth_pct} icon="💰" color="#7c3aed" />
                                <KpiCard title="תורים החודש" value={String(data.kpis.appts_this_month)}
                                    growth={data.kpis.appts_growth_pct} icon="📅" color="#0ea5e9" />
                                <KpiCard title="שיעור Retention" value={`${data.kpis.retention_rate_pct}%`}
                                    sub="לקוחות חזרו ב-3 חודשים" icon="🔄" color="#10b981" />
                                <KpiCard title="LTV ממוצע ללקוח" value={fmt(data.kpis.ltv_ils)}
                                    sub="הכנסה כוללת ממוצעת" icon="👑" color="#f59e0b" />
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                                <KpiCard title="ממוצע לתור (30 יום)" value={fmt(data.kpis.avg_appt_value_ils)}
                                    icon="🧾" color="#6366f1" />
                                <KpiCard title="לקוחות ב-Churn" value={String(data.kpis.churn_count)}
                                    sub="לא הגיעו 60+ ימים" icon="⚠️" color="#ef4444" />
                            </div>
                        </section>

                        {/* ── Retention Trend ── */}
                        <section>
                            <h2 className="text-base font-bold text-slate-700 mb-3">🔄 לקוחות חדשים מול חוזרים — 6 חודשים</h2>
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={data.retention_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                                        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                                        <Tooltip
                                            formatter={(v, name) => [Number(v), name === "new" ? "חדשים" : "חוזרים"]}
                                            contentStyle={{ borderRadius: 10, fontSize: 12 }}
                                        />
                                        <Legend formatter={v => v === "new" ? "חדשים" : "חוזרים"} />
                                        <Bar dataKey="returning" stackId="a" fill="#7c3aed" radius={[0,0,0,0]} name="returning" />
                                        <Bar dataKey="new" stackId="a" fill="#c4b5fd" radius={[6,6,0,0]} name="new" />
                                    </BarChart>
                                </ResponsiveContainer>
                                {/* Retention % line overlay info */}
                                <div className="flex gap-4 mt-3 flex-wrap">
                                    {data.retention_trend.map(r => (
                                        <div key={r.month} className="text-center">
                                            <div className="text-xs text-slate-400">{r.month}</div>
                                            <div className="text-sm font-bold text-violet-700">{r.retention_pct}%</div>
                                            <div className="text-[10px] text-slate-400">retention</div>
                                        </div>
                                    ))}
                                </div>
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

                        {/* ── Top Clients ── */}
                        <section>
                            <h2 className="text-base font-bold text-slate-700 mb-3">👑 לקוחות מובילים — לפי הכנסה</h2>
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                <table className="w-full text-right text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-b border-slate-100">
                                            <th className="px-5 py-3">#</th>
                                            <th className="px-5 py-3">שם</th>
                                            <th className="px-5 py-3 text-center">תורים</th>
                                            <th className="px-5 py-3">הכנסה כוללת</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {data.top_clients.length === 0 ? (
                                            <tr><td colSpan={4} className="text-center text-slate-400 py-8">אין נתונים</td></tr>
                                        ) : data.top_clients.map((c, i) => (
                                            <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                                                <td className="px-5 py-3">
                                                    <span className={`text-xs font-black w-6 h-6 rounded-full flex items-center justify-center ${i === 0 ? "bg-amber-400 text-white" : i === 1 ? "bg-slate-300 text-slate-700" : i === 2 ? "bg-amber-700/30 text-amber-900" : "bg-slate-100 text-slate-500"}`}>
                                                        {i + 1}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3 font-semibold text-slate-800">{c.name || "—"}</td>
                                                <td className="px-5 py-3 text-center text-slate-500">{c.appointments}</td>
                                                <td className="px-5 py-3 font-bold text-violet-700">{fmt(c.revenue_ils)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
