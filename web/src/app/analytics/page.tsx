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
    const [tab, setTab] = useState<"ads" | "organic" | "insights">("ads");
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
                            {(["ads", "organic", "insights"] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setTab(t)}
                                    className={`px-4 py-1.5 font-semibold transition-colors ${tab === t ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                >
                                    {t === "ads" ? "📣 ממומן" : t === "organic" ? "🌱 אורגני" : "🤖 AI"}
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
                </div>
            </AppShell>
        </RequireAuth>
    );
}
