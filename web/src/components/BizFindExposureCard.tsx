"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, Tooltip, ResponsiveContainer } from "recharts";
import { ClipboardList, Eye, Heart, Search, TrendingUp, type LucideIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { BIZFIND_URL } from "@/lib/config";

interface BizFindStats {
    marketplace_visible: boolean;
    studio_slug: string;
    views: { last_7_days: number; last_30_days: number; total: number };
    favorites_count: number;
    booking_requests: { this_month: number; total: number };
    linked_clients: number;
    daily_views: { date: string; count: number }[];
}

export default function BizFindExposureCard() {
    const [stats, setStats] = useState<BizFindStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<BizFindStats>("/api/marketplace/my/analytics")
            .then(setStats)
            .catch(() => setStats(null))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return <div className="h-48 bg-slate-50 animate-pulse rounded-2xl" />;
    }
    if (!stats) {
        return <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-400 text-sm">נתוני החשיפה ב-BizFind לא זמינים כרגע</div>;
    }

    const metrics: { label: string; value: number; icon: LucideIcon }[] = [
        { label: "צפיות 7 ימים", value: stats.views.last_7_days, icon: Eye },
        { label: "צפיות 30 ימים", value: stats.views.last_30_days, icon: TrendingUp },
        { label: "מועדפים", value: stats.favorites_count, icon: Heart },
        { label: "בקשות תור החודש", value: stats.booking_requests.this_month, icon: ClipboardList },
    ];

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Search className="h-5 w-5 text-slate-500" />
                    <div>
                        <h3 className="font-bold text-slate-800 text-sm">BizFind — חשיפה בשוק</h3>
                        <p className="text-xs text-slate-400 mt-0.5">ביצועי הפרופיל שלך באפליקציית החיפוש</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full ${stats.marketplace_visible ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${stats.marketplace_visible ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {stats.marketplace_visible ? "גלוי" : "מוסתר"}
                    </span>
                    {stats.studio_slug && (
                        <a href={`${BIZFIND_URL}/b/${stats.studio_slug}`} target="_blank" rel="noopener"
                            className="text-xs font-semibold hover:underline" style={{ color: "var(--primary)" }}>
                            צפה ←
                        </a>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-x-reverse divide-slate-100">
                {metrics.map(({ label, value, icon: Icon }) => (
                    <div key={label} className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                            <Icon className="h-4 w-4 text-slate-400" />
                            <span className="text-xl font-black text-slate-800">{value.toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">{label}</div>
                    </div>
                ))}
            </div>
            {stats.daily_views.length > 0 && (
                <div className="px-5 pb-3 pt-1 border-t border-slate-100">
                    <div className="text-[11px] text-slate-400 mb-1 font-semibold">צפיות יומיות — 30 ימים אחרונים</div>
                    <ResponsiveContainer width="100%" height={36}>
                        <BarChart data={stats.daily_views} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                            <Bar dataKey="count" radius={[3, 3, 0, 0]} fill="var(--primary)" opacity={0.85} />
                            <Tooltip
                                formatter={(v) => [Number(v), "צפיות"]}
                                labelFormatter={(l) => new Date(l).toLocaleDateString("he-IL")}
                                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
            {!stats.marketplace_visible && (
                <div className="px-5 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-600">הפרופיל שלך לא גלוי ב-BizFind — הפעל כדי לקבל לקוחות חדשים</span>
                    <a href="/business" className="text-xs font-bold underline" style={{ color: "var(--primary)" }}>הגדר ←</a>
                </div>
            )}
        </div>
    );
}
