"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type AdsSummary = {
    spend: number; spend_cents: number;
    impressions: number; clicks: number; leads: number; reach: number;
    ctr: number; cpm: number; cpc: number; cpl: number;
    last_synced: string | null; days_back: number;
};

type Campaign = {
    campaign_id: string; campaign_name: string;
    impressions: number; clicks: number; reach: number;
    spend: number; spend_cents: number; leads: number; link_clicks: number;
    ctr: number; cpm: number; cpc: number; cpl: number;
};

type DailyPoint = { date: string; spend: number; leads: number; clicks: number; impressions: number };

type OrganicSummary = {
    total_leads: number; booked: number; lost: number;
    by_source: { source: string; total: number; booked: number; lost: number; conversion_rate: number }[];
    by_campaign: { campaign: string; total: number; booked: number; source: string; conversion_rate: number }[];
    daily: { date: string; leads: number }[];
};

type AiInsight = {
    id: string; type: string; title: string; body: string;
    priority: string; icon: string | null; generated_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
    high: "border-red-400 bg-red-50",
    medium: "border-amber-400 bg-amber-50",
    low: "border-sky-400 bg-sky-50",
};

const SOURCE_META: Record<string, { label: string; icon: string; color: string }> = {
    whatsapp:  { label: "WhatsApp",  icon: "💬", color: "bg-emerald-500" },
    instagram: { label: "Instagram", icon: "📸", color: "bg-pink-500" },
    facebook:  { label: "Facebook",  icon: "👍", color: "bg-blue-500" },
    manual:    { label: "ידני",      icon: "✏️", color: "bg-slate-400" },
    tiktok:    { label: "TikTok",    icon: "🎵", color: "bg-slate-800" },
    google:    { label: "Google",    icon: "🔍", color: "bg-sky-500" },
};

function fmt(n: number, suffix = "") {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k${suffix}`;
    return `${n}${suffix}`;
}

function KpiCard({ label, value, sub, color = "bg-slate-50 text-slate-700" }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div className={`rounded-2xl p-4 ${color} flex flex-col gap-1`}>
            <span className="text-xs font-semibold opacity-60">{label}</span>
            <span className="text-2xl font-black">{value}</span>
            {sub && <span className="text-[11px] opacity-50">{sub}</span>}
        </div>
    );
}

// ── Simple Bar chart (CSS only) ───────────────────────────────────────────────
function MiniBar({ data, valueKey, labelKey, color = "bg-sky-500" }: { data: any[]; valueKey: string; labelKey: string; color?: string }) {
    const max = Math.max(...data.map(d => d[valueKey]), 1);
    return (
        <div className="flex items-end gap-1 h-24">
            {data.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                        className={`w-full rounded-t ${color} transition-all`}
                        style={{ height: `${Math.max((d[valueKey] / max) * 88, d[valueKey] > 0 ? 4 : 0)}px` }}
                    />
                    {data.length <= 14 && (
                        <span className="text-[8px] text-slate-400 truncate w-full text-center">{d[labelKey]?.slice(5)}</span>
                    )}
                </div>
            ))}
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
    const [tab, setTab] = useState<"ads" | "organic" | "insights" | "business">("business");
    const [days, setDays] = useState(30);
    const [adsSummary, setAdsSummary] = useState<AdsSummary | null>(null);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [dailyAds, setDailyAds] = useState<DailyPoint[]>([]);
    const [organic, setOrganic] = useState<OrganicSummary | null>(null);
    const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [summary, camps, daily, org, insights] = await Promise.all([
                apiFetch<AdsSummary>(`/api/analytics/ads/summary?days_back=${days}`).catch(() => null),
                apiFetch<Campaign[]>(`/api/analytics/ads/campaigns?days_back=${days}`).catch(() => []),
                apiFetch<DailyPoint[]>(`/api/analytics/ads/daily?days_back=${days}`).catch(() => []),
                apiFetch<OrganicSummary>(`/api/analytics/organic/summary?days_back=${days}`).catch(() => null),
                apiFetch<AiInsight[]>("/api/analytics/insights").catch(() => []),
            ]);
            setAdsSummary(summary);
            setCampaigns(camps);
            setDailyAds(daily);
            setOrganic(org);
            setAiInsights(insights);
        } finally { setLoading(false); }
    }, [days]);

    useEffect(() => { load(); }, [load]);

    const handleSync = async () => {
        setSyncing(true);
        setSyncMsg(null);
        try {
            const res = await apiFetch<{ synced: number }>(`/api/analytics/ads/sync?days_back=${days}`, { method: "POST" });
            setSyncMsg(`סונכרנו ${res.synced} רשומות`);
            await load();
        } catch (e: any) {
            setSyncMsg(`שגיאה: ${e?.message}`);
        } finally { setSyncing(false); }
    };

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            await apiFetch("/api/analytics/insights/generate", { method: "POST" });
            const fresh = await apiFetch<AiInsight[]>("/api/analytics/insights");
            setAiInsights(fresh);
        } catch { /* silent */ } finally { setGenerating(false); }
    };

    const handleDismiss = async (id: string) => {
        await apiFetch(`/api/analytics/insights/${id}`, { method: "DELETE" }).catch(() => {});
        setAiInsights(prev => prev.filter(i => i.id !== id));
    };

    const maxOrganic = Math.max(...(organic?.daily.map(d => d.leads) ?? [1]), 1);

    return (
        <RequireAuth>
            <AppShell title="אנליטיקות שיווק">
                <div className="max-w-5xl mx-auto space-y-5 pb-10" dir="rtl">

                    {/* Header controls */}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden text-sm">
                            {[7, 14, 30, 90].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setDays(d)}
                                    className={`px-3 py-1.5 font-semibold transition-colors ${days === d ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                >
                                    {d}י'
                                </button>
                            ))}
                        </div>
                        <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden text-sm">
                            {(["business", "ads", "organic", "insights"] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setTab(t)}
                                    className={`px-4 py-1.5 font-semibold transition-colors ${tab === t ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                >
                                    {t === "business" ? "📊 עסקי" : t === "ads" ? "📣 ממומן" : t === "organic" ? "🌱 אורגני" : "🤖 AI"}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin h-8 w-8 border-2 border-sky-300 border-t-sky-600 rounded-full" />
                        </div>
                    ) : (
                        <>
                            {/* ── ADS TAB ────────────────────────────────────────── */}
                            {tab === "ads" && (
                                <div className="space-y-5">
                                    {/* Sync bar */}
                                    <div className="bg-white border border-slate-100 rounded-2xl px-5 py-3 flex items-center justify-between gap-3">
                                        <div className="text-sm text-slate-500">
                                            {adsSummary?.last_synced
                                                ? `עדכון אחרון: ${new Date(adsSummary.last_synced).toLocaleString("he-IL")}`
                                                : "לא סונכרן עדיין"}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {syncMsg && <span className="text-xs text-slate-500">{syncMsg}</span>}
                                            <button
                                                onClick={handleSync}
                                                disabled={syncing}
                                                className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {syncing ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />מסנכרן...</> : "🔄 סנכרן מ-Meta"}
                                            </button>
                                        </div>
                                    </div>

                                    {/* KPI cards */}
                                    {adsSummary ? (
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <KpiCard label="הוצאה" value={`₪${adsSummary.spend.toLocaleString()}`} color="bg-violet-50 text-violet-700" />
                                            <KpiCard label="לידים" value={String(adsSummary.leads)} sub={adsSummary.leads > 0 ? `₪${adsSummary.cpl} לליד` : undefined} color="bg-emerald-50 text-emerald-700" />
                                            <KpiCard label="חשיפות" value={fmt(adsSummary.impressions)} sub={`CPM ₪${adsSummary.cpm}`} color="bg-sky-50 text-sky-700" />
                                            <KpiCard label="קליקים" value={fmt(adsSummary.clicks)} sub={`CTR ${adsSummary.ctr}%`} color="bg-amber-50 text-amber-700" />
                                        </div>
                                    ) : (
                                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-amber-800 text-sm">
                                            <strong>אין נתוני מודעות.</strong> חבר Meta Ad Account ID בהגדרות → אינטגרציות ולחץ "סנכרן מ-Meta".
                                        </div>
                                    )}

                                    {/* Daily spend chart */}
                                    {dailyAds.length > 0 && (
                                        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                                            <h3 className="font-bold text-slate-800 mb-4 text-sm">הוצאה יומית (₪)</h3>
                                            <MiniBar data={dailyAds} valueKey="spend" labelKey="date" color="bg-violet-400" />
                                        </div>
                                    )}

                                    {/* Campaigns table */}
                                    {campaigns.length > 0 && (
                                        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm overflow-x-auto">
                                            <h3 className="font-bold text-slate-800 mb-4 text-sm">ביצועי קמפיינים</h3>
                                            <table className="w-full text-sm min-w-[560px]">
                                                <thead>
                                                    <tr className="text-xs text-slate-400 border-b border-slate-100 text-right">
                                                        <th className="pb-2 font-semibold">קמפיין</th>
                                                        <th className="pb-2 font-semibold text-center">הוצאה</th>
                                                        <th className="pb-2 font-semibold text-center">חשיפות</th>
                                                        <th className="pb-2 font-semibold text-center">קליקים</th>
                                                        <th className="pb-2 font-semibold text-center">לידים</th>
                                                        <th className="pb-2 font-semibold text-center">CTR</th>
                                                        <th className="pb-2 font-semibold text-center">CPL</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {campaigns.map(c => (
                                                        <tr key={c.campaign_id} className="border-b border-slate-50 hover:bg-slate-50">
                                                            <td className="py-2.5 font-medium text-slate-800 max-w-[160px] truncate">{c.campaign_name || c.campaign_id}</td>
                                                            <td className="py-2.5 text-center text-violet-700 font-semibold">₪{c.spend.toLocaleString()}</td>
                                                            <td className="py-2.5 text-center text-slate-500">{fmt(c.impressions)}</td>
                                                            <td className="py-2.5 text-center text-slate-500">{fmt(c.clicks)}</td>
                                                            <td className="py-2.5 text-center text-emerald-600 font-bold">{c.leads}</td>
                                                            <td className="py-2.5 text-center text-slate-500">{c.ctr}%</td>
                                                            <td className="py-2.5 text-center">
                                                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.cpl > 0 && c.cpl < 50 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                                                    {c.cpl > 0 ? `₪${c.cpl}` : "—"}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── ORGANIC TAB ────────────────────────────────────── */}
                            {tab === "organic" && organic && (
                                <div className="space-y-5">
                                    {/* Summary cards */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <KpiCard label="לידים" value={String(organic.total_leads)} color="bg-sky-50 text-sky-700" />
                                        <KpiCard label="קבעו תור" value={String(organic.booked)} color="bg-emerald-50 text-emerald-700" />
                                        <KpiCard label="המרה" value={`${organic.total_leads ? Math.round(organic.booked / organic.total_leads * 100) : 0}%`} color="bg-violet-50 text-violet-700" />
                                        <KpiCard label="אבדו" value={String(organic.lost)} color="bg-red-50 text-red-600" />
                                    </div>

                                    {/* Daily chart */}
                                    {organic.daily.length > 0 && (
                                        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                                            <h3 className="font-bold text-slate-800 mb-4 text-sm">לידים יומיים</h3>
                                            <MiniBar data={organic.daily} valueKey="leads" labelKey="date" color="bg-sky-400" />
                                        </div>
                                    )}

                                    {/* By source */}
                                    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                                        <h3 className="font-bold text-slate-800 mb-4 text-sm">לפי מקור</h3>
                                        {organic.by_source.length === 0 ? (
                                            <p className="text-sm text-slate-400 text-center py-4">אין נתונים</p>
                                        ) : (
                                            <div className="space-y-3">
                                                {organic.by_source.map(s => {
                                                    const meta = SOURCE_META[s.source] ?? { label: s.source, icon: "📊", color: "bg-slate-400" };
                                                    const pct = organic.total_leads > 0 ? (s.total / organic.total_leads) * 100 : 0;
                                                    return (
                                                        <div key={s.source}>
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className="text-sm font-semibold text-slate-700">{meta.icon} {meta.label}</span>
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-xs text-emerald-600 font-semibold">{s.conversion_rate}% המרה</span>
                                                                    <span className="text-sm font-bold text-slate-700">{s.total}</span>
                                                                </div>
                                                            </div>
                                                            <div className="bg-slate-100 rounded-full h-3 overflow-hidden">
                                                                <div className={`h-full ${meta.color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* By campaign */}
                                    {organic.by_campaign.length > 0 && (
                                        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm overflow-x-auto">
                                            <h3 className="font-bold text-slate-800 mb-4 text-sm">ביצועי קמפיינים אורגניים</h3>
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="text-xs text-slate-400 border-b border-slate-100 text-right">
                                                        <th className="pb-2 font-semibold">קמפיין</th>
                                                        <th className="pb-2 font-semibold text-center">מקור</th>
                                                        <th className="pb-2 font-semibold text-center">לידים</th>
                                                        <th className="pb-2 font-semibold text-center">תורים</th>
                                                        <th className="pb-2 font-semibold text-center">המרה</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {organic.by_campaign.map(c => (
                                                        <tr key={c.campaign} className="border-b border-slate-50 hover:bg-slate-50">
                                                            <td className="py-2.5 font-medium text-slate-800 max-w-[160px] truncate">{c.campaign}</td>
                                                            <td className="py-2.5 text-center">{SOURCE_META[c.source]?.icon ?? "📊"}</td>
                                                            <td className="py-2.5 text-center text-slate-600">{c.total}</td>
                                                            <td className="py-2.5 text-center text-emerald-600 font-bold">{c.booked}</td>
                                                            <td className="py-2.5 text-center">
                                                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.conversion_rate >= 30 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                                                    {c.conversion_rate}%
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── AI INSIGHTS TAB ────────────────────────────────── */}
                            {tab === "insights" && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm text-slate-500">תובנות חכמות מבוססות על נתוני הלידים והמודעות שלך</p>
                                        <button
                                            onClick={handleGenerate}
                                            disabled={generating}
                                            className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {generating ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />מייצר...</> : "✨ צור תובנות"}
                                        </button>
                                    </div>

                                    {aiInsights.length === 0 ? (
                                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-10 text-center">
                                            <div className="text-4xl mb-3">🤖</div>
                                            <p className="text-slate-500 text-sm">לחץ "צור תובנות" לקבלת ניתוח AI של הנתונים שלך</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {aiInsights.map(ins => (
                                                <div
                                                    key={ins.id}
                                                    className={`border-r-4 rounded-2xl p-4 flex items-start gap-3 ${PRIORITY_COLOR[ins.priority] ?? "border-slate-300 bg-slate-50"}`}
                                                >
                                                    <span className="text-2xl flex-shrink-0">{ins.icon ?? "💡"}</span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-slate-800 text-sm">{ins.title}</p>
                                                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{ins.body}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDismiss(ins.id)}
                                                        className="text-slate-300 hover:text-slate-500 text-sm flex-shrink-0"
                                                        title="סגור"
                                                    >✕</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* ── Business Analytics Tab ───────────────────────────── */}
                    {tab === "business" && <BusinessAnalyticsTab />}
                </div>
            </AppShell>
        </RequireAuth>
    );
}

// ── Business Analytics Tab ─────────────────────────────────────────────────────
function BusinessAnalyticsTab() {
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [trend, setTrend] = useState<any[]>([]);
    const [byService, setByService] = useState<any[]>([]);
    const [byArtist, setByArtist] = useState<any[]>([]);
    const [retention, setRetention] = useState<any>(null);
    const [heatmap, setHeatmap] = useState<any>(null);
    const [topClients, setTopClients] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

    useEffect(() => {
        setLoading(true);
        Promise.all([
            apiFetch<any[]>("/api/biz-analytics/revenue-trend?months=6"),
            apiFetch<any[]>(`/api/biz-analytics/revenue-by-service?year=${year}&month=${month}`),
            apiFetch<any[]>(`/api/biz-analytics/revenue-by-artist?year=${year}&month=${month}`),
            apiFetch<any>(`/api/biz-analytics/retention?year=${year}&month=${month}`),
            apiFetch<any>("/api/biz-analytics/heatmap?months=3"),
            apiFetch<any[]>("/api/biz-analytics/top-clients?limit=10"),
        ]).then(([tr, svc, art, ret, hm, tc]) => {
            setTrend(tr); setByService(svc); setByArtist(art);
            setRetention(ret); setHeatmap(hm); setTopClients(tc);
        }).catch(() => {}).finally(() => setLoading(false));
    }, [month, year]);

    const fmt = (n: number) => n.toLocaleString("he-IL", { minimumFractionDigits: 0 });
    const maxRevenue = Math.max(...trend.map(t => t.total_ils), 1);
    const maxHeat = heatmap?.max_val || 1;
    const heatColor = (v: number) => {
        const pct = v / maxHeat;
        if (pct === 0) return "#1e293b";
        if (pct < 0.3) return "#312e81";
        if (pct < 0.6) return "#4c1d95";
        if (pct < 0.85) return "#7c3aed";
        return "#a78bfa";
    };

    if (loading) return <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>⏳ טוען נתונים...</div>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {/* Month selector */}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <select value={month} onChange={e => setMonth(Number(e.target.value))}
                    className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white text-slate-700">
                    {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
                <select value={year} onChange={e => setYear(Number(e.target.value))}
                    className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white text-slate-700">
                    {[2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>

            {/* Revenue trend bar chart */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
                <div className="font-bold text-slate-800 mb-4">📈 מגמת הכנסות — 6 חודשים</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem", height: 140 }}>
                    {trend.map((t, i) => (
                        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem" }}>
                            <div style={{ fontSize: "0.65rem", color: "#64748b", textAlign: "center" }}>₪{t.total_ils > 999 ? `${(t.total_ils/1000).toFixed(1)}k` : t.total_ils}</div>
                            <div style={{ width: "100%", background: "#7c3aed", borderRadius: "4px 4px 0 0", height: `${Math.max(4, (t.total_ils / maxRevenue) * 110)}px`, minHeight: 4 }} />
                            <div style={{ fontSize: "0.65rem", color: "#94a3b8", textAlign: "center" }}>{t.label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Retention + top cards */}
            {retention && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "1rem" }}>
                    {[
                        { label: "סה״כ לקוחות", value: retention.total, icon: "👥" },
                        { label: "לקוחות חדשים", value: retention.new, icon: "🌱" },
                        { label: "לקוחות חוזרים", value: retention.returning, icon: "🔄" },
                        { label: "שיעור שימור", value: `${retention.retention_rate}%`, icon: "💚" },
                    ].map(card => (
                        <div key={card.label} className="bg-white rounded-2xl border border-slate-100 p-4 text-center">
                            <div style={{ fontSize: "1.5rem" }}>{card.icon}</div>
                            <div className="text-2xl font-bold text-slate-800 mt-1">{card.value}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{card.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* By service + by artist */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                    <div className="font-bold text-slate-800 mb-3">🛎️ הכנסות לפי שירות</div>
                    {byService.length === 0 ? <div className="text-slate-400 text-sm">אין נתונים</div> : (
                        byService.slice(0,6).map(s => {
                            const maxR = Math.max(...byService.map(x => x.revenue_ils), 1);
                            return (
                                <div key={s.name} style={{ marginBottom: "0.6rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
                                        <span style={{ color: "#334155" }}>{s.name}</span>
                                        <span style={{ color: "#7c3aed", fontWeight: 600 }}>₪{fmt(s.revenue_ils)} · {s.count} תורים</span>
                                    </div>
                                    <div style={{ height: 6, background: "#f1f5f9", borderRadius: 3 }}>
                                        <div style={{ height: "100%", width: `${(s.revenue_ils / maxR) * 100}%`, background: s.color || "#7c3aed", borderRadius: 3 }} />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                    <div className="font-bold text-slate-800 mb-3">🎨 הכנסות לפי אמן/ית</div>
                    {byArtist.length === 0 ? <div className="text-slate-400 text-sm">אין נתונים</div> : (
                        byArtist.slice(0,6).map(a => {
                            const maxR = Math.max(...byArtist.map(x => x.revenue_ils), 1);
                            return (
                                <div key={a.name} style={{ marginBottom: "0.6rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
                                        <span style={{ color: "#334155" }}>{a.name}</span>
                                        <span style={{ color: "#7c3aed", fontWeight: 600 }}>{a.count} תורים</span>
                                    </div>
                                    <div style={{ height: 6, background: "#f1f5f9", borderRadius: 3 }}>
                                        <div style={{ height: "100%", width: `${(a.count / Math.max(...byArtist.map(x => x.count), 1)) * 100}%`, background: a.color || "#7c3aed", borderRadius: 3 }} />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Heatmap */}
            {heatmap && (
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                    <div className="font-bold text-slate-800 mb-3">🔥 שעות עמוסות (3 חודשים אחרונים)</div>
                    <div style={{ overflowX: "auto" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "48px repeat(24, 1fr)", gap: 2, minWidth: 600 }}>
                            <div />
                            {Array.from({length:24}).map((_,h) => (
                                <div key={h} style={{ textAlign: "center", fontSize: "0.6rem", color: "#94a3b8" }}>{h}</div>
                            ))}
                            {heatmap.matrix.map((row: number[], d: number) => (
                                <>
                                    <div key={`d${d}`} style={{ fontSize: "0.7rem", color: "#64748b", display: "flex", alignItems: "center" }}>{heatmap.days[d]}</div>
                                    {row.map((v: number, h: number) => (
                                        <div key={h} title={`${v} תורים`} style={{ height: 20, borderRadius: 3, background: heatColor(v), cursor: v > 0 ? "pointer" : "default" }} />
                                    ))}
                                </>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Top clients LTV */}
            {topClients.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                    <div className="font-bold text-slate-800 mb-3">👑 לקוחות מובילים (LTV)</div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-slate-400 text-xs border-b border-slate-100">
                                <th className="text-right pb-2">#</th>
                                <th className="text-right pb-2">שם</th>
                                <th className="text-right pb-2">טלפון</th>
                                <th className="text-right pb-2">תשלומים</th>
                                <th className="text-right pb-2">סה״כ LTV</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topClients.map((c, i) => (
                                <tr key={c.id} className="border-b border-slate-50">
                                    <td className="py-2 text-slate-400">{i+1}</td>
                                    <td className="py-2 font-semibold text-slate-800">{c.name}</td>
                                    <td className="py-2 text-slate-500">{c.phone}</td>
                                    <td className="py-2 text-slate-600">{c.payment_count}</td>
                                    <td className="py-2 font-bold text-violet-700">₪{fmt(c.ltv_ils)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
