"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

interface Module { id: string; name: string; category: string; }
interface PackageData { plans: string[]; modules: Module[]; plan_modules: Record<string, string[]>; }

const PLAN_LABELS: Record<string, { label: string; color: string; icon: string }> = {
    free:       { label: "Free",       color: "#64748b", icon: "🆓" },
    starter:    { label: "Starter",    color: "#0ea5e9", icon: "🚀" },
    pro:        { label: "Pro",        color: "#7c3aed", icon: "⚡" },
    enterprise: { label: "Enterprise", color: "#f59e0b", icon: "🏆" },
    platform:   { label: "Platform",  color: "#ef4444", icon: "🛡️" },
};

const CAT_ORDER = ["core","communication","ai","marketplace","advanced","finance"];
const CAT_LABELS: Record<string, string> = {
    core: "🏗️ ליבה", communication: "💬 תקשורת", ai: "🤖 AI",
    marketplace: "🌐 Marketplace", advanced: "⚡ מתקדם", finance: "💰 פיננסים",
};

export default function PackagesPage() {
    const [data, setData] = useState<PackageData | null>(null);
    const [edits, setEdits] = useState<Record<string, string[]>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<PackageData>("/api/admin/packages")
            .then(d => { setData(d); setEdits(d.plan_modules); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const toggle = (plan: string, modId: string) => {
        setEdits(prev => {
            const current = prev[plan] || [];
            return {
                ...prev,
                [plan]: current.includes(modId)
                    ? current.filter(m => m !== modId)
                    : [...current, modId],
            };
        });
    };

    const save = async (plan: string) => {
        setSaving(plan);
        try {
            await apiFetch("/api/admin/packages", {
                method: "PUT",
                body: JSON.stringify({ plan, module_ids: edits[plan] || [] }),
            });
            toast.success(`חבילת ${plan} עודכנה!`);
        } catch (e: any) { toast.error(e.message); }
        finally { setSaving(null); }
    };

    const grouped = CAT_ORDER.map(cat => ({
        cat, label: CAT_LABELS[cat] || cat,
        mods: (data?.modules || []).filter(m => m.category === cat),
    })).filter(g => g.mods.length > 0);

    return (
        <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a,#1e1b4b)", padding: "2rem", fontFamily: "sans-serif", direction: "rtl" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
                    <a href="/admin" style={{ color: "#a78bfa", textDecoration: "none", fontSize: "0.9rem" }}>← חזרה לאדמין</a>
                    <h1 style={{ color: "#fff", fontSize: "1.8rem", fontWeight: 800, margin: 0 }}>📦 עורך חבילות</h1>
                    <span style={{ color: "#64748b", fontSize: "0.85rem" }}>שלוט מה כלול בכל plan — ללא שינוי קוד</span>
                </div>

                {loading ? <div style={{ color: "#64748b", textAlign: "center", padding: "3rem" }}>טוען...</div> : (
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                            <thead>
                                <tr style={{ background: "rgba(255,255,255,.04)" }}>
                                    <th style={{ padding: "1rem", textAlign: "right", color: "#94a3b8", width: 200 }}>מודול</th>
                                    {data?.plans.map(plan => {
                                        const p = PLAN_LABELS[plan] || { label: plan, color: "#7c3aed", icon: "📦" };
                                        return (
                                            <th key={plan} style={{ padding: "1rem", textAlign: "center", color: p.color, minWidth: 120 }}>
                                                {p.icon} {p.label}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {grouped.map(({ cat, label, mods }) => (
                                    <>
                                        <tr key={`cat-${cat}`}>
                                            <td colSpan={(data?.plans.length || 0) + 1}
                                                style={{ padding: "0.6rem 1rem", color: "#a78bfa", fontWeight: 700, fontSize: "0.8rem", background: "rgba(167,139,250,.06)", borderTop: "1px solid rgba(167,139,250,.1)" }}>
                                                {label}
                                            </td>
                                        </tr>
                                        {mods.map(mod => (
                                            <tr key={mod.id} style={{ borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                                                <td style={{ padding: "0.65rem 1rem", color: "#e2e8f0" }}>{mod.name}</td>
                                                {data?.plans.map(plan => {
                                                    const enabled = (edits[plan] || []).includes(mod.id);
                                                    return (
                                                        <td key={plan} style={{ textAlign: "center", padding: "0.5rem" }}>
                                                            <button
                                                                onClick={() => toggle(plan, mod.id)}
                                                                style={{
                                                                    width: 36, height: 36, borderRadius: "50%", border: "none",
                                                                    cursor: "pointer", fontSize: "1rem",
                                                                    background: enabled ? "rgba(74,222,128,.2)" : "rgba(100,116,139,.15)",
                                                                    color: enabled ? "#4ade80" : "#475569",
                                                                }}
                                                            >
                                                                {enabled ? "✅" : "○"}
                                                            </button>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </>
                                ))}
                                {/* Save row */}
                                <tr style={{ background: "rgba(255,255,255,.03)" }}>
                                    <td style={{ padding: "1rem", color: "#64748b", fontSize: "0.8rem" }}>שמור שינויים ↓</td>
                                    {data?.plans.map(plan => {
                                        const p = PLAN_LABELS[plan] || { label: plan, color: "#7c3aed", icon: "📦" };
                                        return (
                                            <td key={plan} style={{ textAlign: "center", padding: "0.75rem" }}>
                                                <button
                                                    onClick={() => save(plan)}
                                                    disabled={saving === plan}
                                                    style={{
                                                        background: p.color, border: "none", borderRadius: 10,
                                                        color: "#fff", padding: "0.4rem 0.9rem", cursor: "pointer",
                                                        fontWeight: 600, fontSize: "0.8rem", opacity: saving === plan ? 0.6 : 1,
                                                    }}
                                                >
                                                    {saving === plan ? "..." : "💾 שמור"}
                                                </button>
                                            </td>
                                        );
                                    })}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
