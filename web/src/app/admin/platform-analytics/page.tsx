"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface PlatformData {
    active_studios: number;
    mrr_ils: number;
    appts_today: number;
    appts_month: number;
    messages_sent_month: number;
    total_clients: number;
    at_risk_studios: number;
    top_studios: { name: string; slug: string; revenue_ils: number }[];
    plan_distribution: { plan: string; count: number }[];
}

export default function PlatformAnalyticsPage() {
    const [data, setData] = useState<PlatformData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<PlatformData>("/api/admin/platform-analytics")
            .then(setData).catch(() => {}).finally(() => setLoading(false));
    }, []);

    const cards = data ? [
        { label: "MRR החודש", value: "₪" + data.mrr_ils.toLocaleString(), icon: "💰", color: "#4ade80" },
        { label: "סטודיוים פעילים", value: String(data.active_studios), icon: "🏢", color: "#60a5fa" },
        { label: "תורים היום", value: String(data.appts_today), icon: "📅", color: "#a78bfa" },
        { label: "הודעות החודש", value: data.messages_sent_month.toLocaleString(), icon: "💬", color: "#f59e0b" },
        { label: "תורים החודש", value: data.appts_month.toLocaleString(), icon: "📊", color: "#34d399" },
        { label: "סה׳׳כ לקוחות", value: data.total_clients.toLocaleString(), icon: "👥", color: "#818cf8" },
        { label: "סטודיוים בסיכון", value: String(data.at_risk_studios), icon: "⚠", color: "#f87171" },
        { label: "סוגי חבילות", value: String(data.plan_distribution.length), icon: "📦", color: "#fbbf24" },
    ] : [];

    return (
        <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a,#1e1b4b)", padding: "2rem", fontFamily: "sans-serif", direction: "rtl", color: "#fff" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
                    <a href="/admin" style={{ color: "#a78bfa", textDecoration: "none", fontSize: "0.9rem" }}>← חזרה לאדמין</a>
                    <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: 0 }}>📊 Platform Analytics</h1>
                </div>

                {loading ? (
                    <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>⏳ טוען...</div>
                ) : !data ? (
                    <div style={{ textAlign: "center", padding: "4rem", color: "#f87171" }}>שגיאה בטעינת נתונים</div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                        {/* KPI Cards */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "1rem" }}>
                            {cards.map(c => (
                                <div key={c.label} style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.25rem" }}>
                                    <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{c.icon}</div>
                                    <div style={{ fontSize: "1.8rem", fontWeight: 800, color: c.color }}>{c.value}</div>
                                    <div style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "0.25rem" }}>{c.label}</div>
                                </div>
                            ))}
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                            {/* Top Studios */}
                            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.5rem" }}>
                                <div style={{ fontWeight: 700, marginBottom: "1rem" }}>🏆 Top סטודיוים (הכנסות החודש)</div>
                                {data.top_studios.length === 0 ? (
                                    <div style={{ color: "#64748b", fontSize: "0.85rem" }}>אין נתונים</div>
                                ) : data.top_studios.map((s, i) => (
                                    <div key={s.slug} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                                        <span style={{ color: "#cbd5e1" }}>{"#" + (i + 1)} {s.name}</span>
                                        <span style={{ color: "#a78bfa", fontWeight: 700 }}>{"₪" + s.revenue_ils.toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Plan distribution */}
                            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.5rem" }}>
                                <div style={{ fontWeight: 700, marginBottom: "1rem" }}>📦 פילוג חבילות</div>
                                {data.plan_distribution.map(p => (
                                    <div key={p.plan} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                                        <span style={{ color: "#cbd5e1", textTransform: "capitalize" }}>{p.plan}</span>
                                        <span style={{ color: "#fff", fontWeight: 700, background: "rgba(167,139,250,.2)", padding: "0.2rem 0.6rem", borderRadius: 8 }}>{p.count}</span>
                                    </div>
                                ))}
                                {data.at_risk_studios > 0 && (
                                    <div style={{ marginTop: "1rem", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10, padding: "0.75rem", color: "#fca5a5", fontSize: "0.85rem" }}>
                                        {String(data.at_risk_studios) + " סטודיוים ללא פעילות ב-30 יום"}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Quick links */}
                        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                            <a href="/admin/packages" style={{ background: "#7c3aed", color: "#fff", textDecoration: "none", padding: "0.65rem 1.25rem", borderRadius: 12, fontWeight: 600, fontSize: "0.9rem" }}>📦 עורך חבילות</a>
                            <a href="/admin/modules" style={{ background: "rgba(255,255,255,.1)", color: "#fff", textDecoration: "none", padding: "0.65rem 1.25rem", borderRadius: 12, fontWeight: 600, fontSize: "0.9rem" }}>🧩 מודולים</a>
                            <a href="/admin/invoice-scans" style={{ background: "rgba(255,255,255,.1)", color: "#fff", textDecoration: "none", padding: "0.65rem 1.25rem", borderRadius: 12, fontWeight: 600, fontSize: "0.9rem" }}>📄 סריקות AI</a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
