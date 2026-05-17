"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Member = {
    id: string;
    full_name: string;
    phone: string | null;
    points: number;
    joined_at: string | null;
    source: "landing" | "manual";
};

type ClubStats = {
    total: number;
    this_month: number;
    via_landing: number;
    via_manual: number;
    members: Member[];
};

function formatDate(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function StatCard({
    label,
    value,
    icon,
    color,
}: {
    label: string;
    value: number;
    icon: string;
    color: string;
}) {
    return (
        <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-center gap-4`}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${color}`}>
                {icon}
            </div>
            <div>
                <div className="text-2xl font-black text-slate-900">{value}</div>
                <div className="text-sm text-slate-500 mt-0.5">{label}</div>
            </div>
        </div>
    );
}

export default function ClubPage() {
    const [stats, setStats] = useState<ClubStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [sourceFilter, setSourceFilter] = useState<"all" | "landing" | "manual">("all");

    useEffect(() => {
        apiFetch<ClubStats>("/api/clients/club/stats")
            .then(setStats)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const filtered = (stats?.members || []).filter(m => {
        const q = search.toLowerCase();
        const matchSearch = !q || m.full_name.toLowerCase().includes(q) || (m.phone || "").includes(q);
        const matchSource = sourceFilter === "all" || m.source === sourceFilter;
        return matchSearch && matchSource;
    });

    return (
        <AppShell title="מועדון VIP 👑">
            <div className="max-w-5xl mx-auto space-y-6 animate-page-in" dir="rtl">

                {/* Stats cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label="סה״כ חברי מועדון" value={stats?.total ?? 0} icon="👑" color="bg-amber-50" />
                    <StatCard label="הצטרפו החודש" value={stats?.this_month ?? 0} icon="🆕" color="bg-sky-50" />
                    <StatCard label="דרך קישור" value={stats?.via_landing ?? 0} icon="🔗" color="bg-green-50" />
                    <StatCard label="הכנסה ידנית" value={stats?.via_manual ?? 0} icon="✍️" color="bg-purple-50" />
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="text"
                        placeholder="חיפוש לפי שם או טלפון..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                    />
                    <div className="flex gap-2">
                        {(["all", "landing", "manual"] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setSourceFilter(f)}
                                className={[
                                    "px-4 py-2.5 rounded-xl text-sm font-medium transition-colors border",
                                    sourceFilter === f
                                        ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                                        : "bg-white text-slate-600 border-slate-200 hover:bg-sky-50",
                                ].join(" ")}
                            >
                                {f === "all" ? "הכל" : f === "landing" ? "🔗 קישור" : "✍️ ידני"}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    {loading ? (
                        <div className="py-20 text-center text-slate-400">
                            <div className="animate-spin inline-block w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full mb-3" />
                            <div className="text-sm">טוען נתונים...</div>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="py-20 text-center space-y-2">
                            <div className="text-5xl">👑</div>
                            <div className="text-slate-600 font-semibold">אין חברי מועדון עדיין</div>
                            <div className="text-slate-400 text-sm">שתפו את קישור דף הנחיתה כדי להתחיל לאסוף חברים</div>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs">שם</th>
                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs hidden sm:table-cell">טלפון</th>
                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs">נקודות</th>
                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs hidden md:table-cell">תאריך הצטרפות</th>
                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs">מקור</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filtered.map(m => (
                                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                    {m.full_name[0] || "?"}
                                                </div>
                                                <span className="font-medium text-slate-800">{m.full_name}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell" dir="ltr">
                                            {m.phone || "—"}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            {m.points > 0 ? (
                                                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 font-semibold px-2.5 py-0.5 rounded-full text-xs">
                                                    ⭐ {m.points}
                                                </span>
                                            ) : (
                                                <span className="text-slate-300 text-xs">0</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3.5 text-slate-500 text-xs hidden md:table-cell">
                                            {formatDate(m.joined_at)}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            {m.source === "landing" ? (
                                                <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 font-medium px-2.5 py-0.5 rounded-full text-xs border border-green-100">
                                                    🔗 קישור
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 font-medium px-2.5 py-0.5 rounded-full text-xs border border-purple-100">
                                                    ✍️ ידני
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {filtered.length > 0 && (
                    <p className="text-center text-xs text-slate-400">
                        מוצגים {filtered.length} מתוך {stats?.total ?? 0} חברי מועדון
                    </p>
                )}
            </div>
        </AppShell>
    );
}
