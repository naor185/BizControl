"use client";
import { useEffect, useState } from "react";
import { CalendarCheck, Receipt, Wallet, type LucideIcon } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { useTerms } from "@/lib/useTerms";
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
    ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";

// The business's analytics in one place (the owner, 2026-10-15: "too many analytics"): the month's summary, revenue and
// appointments by month, the busy days and hours, the average per appointment, revenue by service and the team's
// performance. The charts that were a tab on לוח בקרה live here now (GET /api/dashboard/analytics); the clients'
// analytics stay with the clients (/clients/analytics).

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
interface ByMonth {
    revenue_by_month: { month: string; revenue: number }[];
    appts_by_month: { month: string; count: number }[];
    artists: { name: string; appointments: number; revenue: number }[];
    busiest_days: { day: string; count: number }[];
}

const fmt = (n: number) => `₪${n.toLocaleString("he-IL")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;
const shortIls = (v: number) => `₪${Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + "k" : v}`;
const TIP = { borderRadius: 10, fontSize: 12 };

function GrowthBadge({ value }: { value: number }) {
    const up = value > 0;
    const zero = value === 0;
    return (
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${zero ? "bg-slate-100 text-slate-500" : up ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {zero ? "0%" : pct(value)}
        </span>
    );
}

function KpiCard({ title, value, growth, icon: Icon, color }: {
    title: string; value: string; growth?: number; icon: LucideIcon; color: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5" style={{ borderTop: `3px solid ${color}` }}>
            <div className="flex justify-between items-start mb-2">
                <Icon className="w-6 h-6" style={{ color }} aria-hidden />
                {growth !== undefined && <GrowthBadge value={growth} />}
            </div>
            <div className="text-2xl font-black text-slate-800 mt-1">{value}</div>
            <div className="text-sm font-semibold text-slate-600 mt-0.5">{title}</div>
        </div>
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="text-base font-bold text-slate-700 mb-3">{title}</h2>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">{children}</div>
        </section>
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function BusinessAnalyticsPage() {
    const terms = useTerms();   // the business's words, not "אמנים"
    const [data, setData] = useState<AdvancedData | null>(null);
    const [byMonth, setByMonth] = useState<ByMonth | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            apiFetch<AdvancedData>("/api/dashboard/advanced").then(setData).catch(() => {}),
            apiFetch<ByMonth>("/api/dashboard/analytics").then(setByMonth).catch(() => {}),
        ]).finally(() => setLoading(false));
    }, []);

    return (
        <RequireAuth>
            <AppShell title="אנליטיקה עסקית">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600" />
                    </div>
                ) : !data ? (
                    <div className="text-center text-slate-400 py-16">שגיאה בטעינת הנתונים</div>
                ) : (
                    <div className="space-y-8 pb-12">
                        {/* ── The month ── */}
                        <section>
                            <h2 className="text-base font-bold text-slate-700 mb-3">סיכום החודש</h2>
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                <KpiCard title="הכנסות החודש" value={fmt(data.kpis.revenue_this_month_ils)}
                                    growth={data.kpis.revenue_growth_pct} icon={Wallet} color="#7c3aed" />
                                <KpiCard title="תורים החודש" value={String(data.kpis.appts_this_month)}
                                    growth={data.kpis.appts_growth_pct} icon={CalendarCheck} color="#0ea5e9" />
                                <KpiCard title="ממוצע לתור (30 יום)" value={fmt(data.kpis.avg_appt_value_ils)}
                                    icon={Receipt} color="#6366f1" />
                            </div>
                        </section>

                        {/* ── Month by month ── */}
                        {byMonth && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card title="הכנסה לפי חודש — 6 חודשים אחרונים">
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={byMonth.revenue_by_month} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                                            <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                                            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={shortIls} />
                                            <Tooltip formatter={v => [`₪${Number(v).toLocaleString()}`, "הכנסה"]} contentStyle={TIP} />
                                            <Bar dataKey="revenue" radius={[6, 6, 0, 0]} fill="#7c3aed" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </Card>
                                <Card title="תורים לפי חודש — 6 חודשים אחרונים">
                                    <ResponsiveContainer width="100%" height={200}>
                                        <LineChart data={byMonth.appts_by_month} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                                            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                                            <Tooltip formatter={v => [Number(v), "תורים"]} contentStyle={TIP} />
                                            <Line type="monotone" dataKey="count" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 4, fill: "#0ea5e9" }} activeDot={{ r: 6 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </Card>
                            </div>
                        )}

                        {/* ── When it's busy ── */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {byMonth && (
                                <Card title="ימים עמוסים — 90 ימים אחרונים">
                                    <ResponsiveContainer width="100%" height={180}>
                                        <BarChart data={byMonth.busiest_days} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                                            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                                            <Tooltip formatter={v => [Number(v), "תורים"]} contentStyle={TIP} />
                                            <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#6366f1" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </Card>
                            )}
                            <Card title="שעות עמוסות — 90 ימים אחרונים">
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={data.hourly_heatmap} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                                        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                                        <Tooltip formatter={v => [v, "תורים"]} contentStyle={TIP} />
                                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                            {data.hourly_heatmap.map((entry, i) => {
                                                const max = Math.max(...data.hourly_heatmap.map(h => h.count));
                                                const intensity = max > 0 ? entry.count / max : 0;
                                                const r = Math.round(124 + (intensity * (239 - 124)));
                                                const g = Math.round(58 + (intensity * (68 - 58)));
                                                const b = Math.round(237 + (intensity * (68 - 237)));
                                                return <Cell key={i} fill={`rgb(${r},${g},${b})`} />;
                                            })}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </Card>
                        </div>

                        {/* ── Average per appointment ── */}
                        <Card title="ממוצע לתור — מגמה">
                            <ResponsiveContainer width="100%" height={180}>
                                <LineChart data={data.avg_value_trend} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={v => `₪${v}`} />
                                    <Tooltip formatter={v => [`₪${Number(v).toLocaleString()}`, "ממוצע לתור"]} contentStyle={TIP} />
                                    <Line type="monotone" dataKey="avg_ils" stroke="#7c3aed"
                                        strokeWidth={2.5} dot={{ r: 4, fill: "#7c3aed" }} activeDot={{ r: 6 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </Card>

                        {/* ── Revenue by service ── */}
                        <Card title="הכנסות לפי שירות — 90 ימים אחרונים">
                            {data.revenue_by_service.length === 0 ? (
                                <div className="text-center text-slate-400 py-8">אין נתונים עדיין</div>
                            ) : (
                                <>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={data.revenue_by_service} layout="vertical"
                                            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                                            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={shortIls} />
                                            <YAxis type="category" dataKey="service" width={90}
                                                tick={{ fontSize: 11, fill: "#334155" }} />
                                            <Tooltip formatter={v => [`₪${Number(v).toLocaleString()}`, "הכנסות"]} contentStyle={TIP} />
                                            <Bar dataKey="revenue_ils" radius={[0, 6, 6, 0]} fill="#7c3aed" />
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
                        </Card>

                        {/* ── The team ── */}
                        {byMonth && byMonth.artists.length > 0 && (
                            <section>
                                <h2 className="text-base font-bold text-slate-700 mb-3">ביצועי {terms.staff_plural}</h2>
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden divide-y divide-slate-50">
                                    {byMonth.artists.map((a, i) => (
                                        <div key={a.name} className="px-5 py-4 flex items-center gap-4">
                                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-500 shrink-0">
                                                {i + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-slate-800 truncate">{a.name}</div>
                                                <div className="text-xs text-slate-400">{a.appointments} תורים</div>
                                            </div>
                                            <div className="text-left" dir="ltr">
                                                <div className="font-bold text-slate-900">{fmt(a.revenue)}</div>
                                                <div className="text-xs text-slate-400">הכנסה כוללת</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
