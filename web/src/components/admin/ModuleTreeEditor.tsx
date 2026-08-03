"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

export interface Module { id: string; name: string; category: string; parent_module_id?: string | null; }
export interface PlanQuota { limit_value: number | null; period_type: string; on_exceed_action: string; auto_increase_by: number | null; }
export interface PackageData {
    plans: string[]; modules: Module[]; plan_modules: Record<string, string[]>;
    plan_quotas: Record<string, Record<string, PlanQuota>>;
}

const DEFAULT_QUOTA: PlanQuota = { limit_value: null, period_type: "unlimited", on_exceed_action: "block", auto_increase_by: null };
const PERIOD_TYPE_LABELS: Record<string, string> = {
    unlimited: "ללא הגבלה", daily: "יומי", weekly: "שבועי", monthly: "חודשי", yearly: "שנתי", lifetime: "לכל החיים",
};
const ON_EXCEED_LABELS: Record<string, string> = {
    block: "חסום לחלוטין", warn_only: "התרעה בלבד", allow_overage: "המשך עם חריגה",
    paid_overage: "חריגה בתשלום", auto_increase: "הגדלה אוטומטית", custom: "אחר (עתידי)",
};

export const PLAN_LABELS: Record<string, { label: string; color: string; icon: string }> = {
    trial:         { label: "Trial",       color: "#22c55e", icon: "🎁" },
    free:          { label: "Free",        color: "#64748b", icon: "🆓" },
    bizfind_basic: { label: "BizFind Basic (retired)", color: "#94a3b8", icon: "🗄️" },
    bizfind_pro:   { label: "BizFind Pro (retired)",   color: "#94a3b8", icon: "🗄️" },
    starter:       { label: "Starter",     color: "#0ea5e9", icon: "🚀" },
    pro:           { label: "Pro",         color: "#7c3aed", icon: "⚡" },
    studio:        { label: "Studio",      color: "#db2777", icon: "🎨" },
    enterprise:    { label: "Enterprise",  color: "#f59e0b", icon: "🏆" },
    platform:      { label: "Platform",    color: "#ef4444", icon: "🛡️" },
};
export function planMeta(plan: string) {
    return PLAN_LABELS[plan] || { label: plan, color: "#7c3aed", icon: "📦" };
}

const CAT_ORDER = ["core","communication","ai","marketplace","advanced","finance"];
const CAT_LABELS: Record<string, string> = {
    core: "🏗️ ליבה", communication: "💬 תקשורת", ai: "🤖 AI",
    marketplace: "🌐 Marketplace", advanced: "⚡ מתקדם", finance: "💰 פיננסים",
};

interface Props {
    /** Which plan IDs to render as columns. Omit to show every plan (the
     * original admin/packages grid). Pass a single-item array for a
     * per-plan-focused editor (admin/plans' Modules/Quotas tabs). */
    planFilter?: string[];
    /** Show the free-text module search box above the tree. */
    showSearch?: boolean;
}

/**
 * Shared module-tree + quota editor — used by both admin/packages (grid
 * across every plan) and admin/plans (focused on one selected plan), so the
 * tree-building and quota-editing logic lives in exactly one place instead
 * of being copy-pasted between the two screens.
 */
export default function ModuleTreeEditor({ planFilter, showSearch = false }: Props) {
    const [data, setData] = useState<PackageData | null>(null);
    const [edits, setEdits] = useState<Record<string, string[]>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [expandedQuotaModId, setExpandedQuotaModId] = useState<string | null>(null);
    const [quotaEdits, setQuotaEdits] = useState<Record<string, PlanQuota>>({});
    const [savingQuota, setSavingQuota] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    useEffect(() => {
        apiFetch<PackageData>("/api/admin/packages")
            .then(d => {
                setData(d); setEdits(d.plan_modules);
                const qe: Record<string, PlanQuota> = {};
                Object.entries(d.plan_quotas || {}).forEach(([plan, byMod]) => {
                    Object.entries(byMod).forEach(([modId, q]) => { qe[`${plan}:${modId}`] = q; });
                });
                setQuotaEdits(qe);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const visiblePlans = planFilter ?? data?.plans ?? [];

    const quotaFor = (plan: string, modId: string): PlanQuota => quotaEdits[`${plan}:${modId}`] || DEFAULT_QUOTA;

    const setQuotaField = (plan: string, modId: string, field: keyof PlanQuota, value: string | number | null) => {
        const key = `${plan}:${modId}`;
        setQuotaEdits(prev => ({ ...prev, [key]: { ...(prev[key] || DEFAULT_QUOTA), [field]: value } }));
    };

    const saveQuota = async (plan: string, modId: string) => {
        const key = `${plan}:${modId}`;
        setSavingQuota(key);
        try {
            const q = quotaFor(plan, modId);
            await apiFetch("/api/admin/packages/quota", {
                method: "PUT",
                body: JSON.stringify({ plan, module_id: modId, ...q }),
            });
            toast.success("מכסה עודכנה!");
        } catch (e: any) { toast.error(e.message); }
        finally { setSavingQuota(null); }
    };

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

    // Tree order within each category: each top-level module immediately
    // followed by its own sub-capabilities (parent_module_id), so the table
    // reads as a tree without needing a separate rendering component. Search
    // matches a module OR any of its children by name — a matching child
    // keeps its parent visible for context even if the parent itself doesn't match.
    const q = search.trim().toLowerCase();
    const grouped = CAT_ORDER.map(cat => {
        const catMods = (data?.modules || []).filter(m => m.category === cat);
        const topLevel = catMods.filter(m => !m.parent_module_id);
        const ordered: (Module & { depth: number })[] = [];
        topLevel.forEach(m => {
            const children = catMods.filter(c => c.parent_module_id === m.id);
            const selfMatch = !q || m.name.toLowerCase().includes(q);
            const matchingChildren = q ? children.filter(c => c.name.toLowerCase().includes(q)) : children;
            if (!q || selfMatch || matchingChildren.length > 0) {
                ordered.push({ ...m, depth: 0 });
                (selfMatch ? children : matchingChildren).forEach(child => ordered.push({ ...child, depth: 1 }));
            }
        });
        const seen = new Set(ordered.map(m => m.id));
        catMods.forEach(m => { if (!seen.has(m.id) && (!q || m.name.toLowerCase().includes(q))) ordered.push({ ...m, depth: 0 }); }); // orphans, shouldn't happen
        return { cat, label: CAT_LABELS[cat] || cat, mods: ordered };
    }).filter(g => g.mods.length > 0);

    if (loading) return <div style={{ color: "#64748b", textAlign: "center", padding: "3rem" }}>טוען...</div>;

    return (
        <div style={{ overflowX: "auto" }}>
            {showSearch && (
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="🔍 חיפוש מודול..."
                    style={{ width: "100%", maxWidth: 320, marginBottom: "1rem", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.55rem 0.9rem", color: "#e2e8f0", fontSize: "0.85rem" }}
                />
            )}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                    <tr style={{ background: "rgba(255,255,255,.04)" }}>
                        <th style={{ padding: "1rem", textAlign: "right", color: "#94a3b8", width: 200 }}>מודול</th>
                        {visiblePlans.map(plan => {
                            const p = planMeta(plan);
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
                                <td colSpan={visiblePlans.length + 1}
                                    style={{ padding: "0.6rem 1rem", color: "#a78bfa", fontWeight: 700, fontSize: "0.8rem", background: "rgba(167,139,250,.06)", borderTop: "1px solid rgba(167,139,250,.1)" }}>
                                    {label}
                                </td>
                            </tr>
                            {mods.map(mod => (
                                <>
                                <tr key={mod.id} style={{ borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                                    <td style={{ padding: "0.65rem 1rem", color: mod.depth ? "#94a3b8" : "#e2e8f0", fontSize: mod.depth ? "0.8rem" : undefined }}>
                                        {mod.depth ? `↳ ${mod.name}` : mod.name}
                                        <button
                                            onClick={() => setExpandedQuotaModId(expandedQuotaModId === mod.id ? null : mod.id)}
                                            title="הגדרת מכסה (Limits)"
                                            style={{ marginRight: 8, background: "none", border: "none", cursor: "pointer", opacity: 0.6, fontSize: "0.8rem" }}
                                        >⚙️</button>
                                    </td>
                                    {visiblePlans.map(plan => {
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
                                {expandedQuotaModId === mod.id && (
                                    <tr key={`${mod.id}-quota`} style={{ background: "rgba(167,139,250,.04)" }}>
                                        <td colSpan={visiblePlans.length + 1} style={{ padding: "0.75rem 1rem" }}>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                                                {visiblePlans.filter(plan => (edits[plan] || []).includes(mod.id)).map(plan => {
                                                    const qv = quotaFor(plan, mod.id);
                                                    const key = `${plan}:${mod.id}`;
                                                    const p = planMeta(plan);
                                                    return (
                                                        <div key={plan} style={{ background: "rgba(255,255,255,.04)", borderRadius: 10, padding: "0.6rem 0.75rem", minWidth: 220 }}>
                                                            <div style={{ color: p.color, fontSize: "0.75rem", fontWeight: 700, marginBottom: "0.4rem" }}>{p.icon} {p.label}</div>
                                                            <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.4rem" }}>
                                                                <select value={qv.period_type} onChange={e => setQuotaField(plan, mod.id, "period_type", e.target.value)}
                                                                    style={{ flex: 1, fontSize: "0.75rem", background: "#1e1b4b", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "0.25rem" }}>
                                                                    {Object.entries(PERIOD_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                                                </select>
                                                                <input type="number" placeholder="מכסה" value={qv.limit_value ?? ""}
                                                                    onChange={e => setQuotaField(plan, mod.id, "limit_value", e.target.value === "" ? null : Number(e.target.value))}
                                                                    disabled={qv.period_type === "unlimited"}
                                                                    style={{ width: 70, fontSize: "0.75rem", background: "#1e1b4b", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "0.25rem" }} />
                                                            </div>
                                                            <select value={qv.on_exceed_action} onChange={e => setQuotaField(plan, mod.id, "on_exceed_action", e.target.value)}
                                                                disabled={qv.period_type === "unlimited"}
                                                                style={{ width: "100%", fontSize: "0.75rem", background: "#1e1b4b", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "0.25rem", marginBottom: "0.4rem" }}>
                                                                {Object.entries(ON_EXCEED_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                                            </select>
                                                            <button onClick={() => saveQuota(plan, mod.id)} disabled={savingQuota === key}
                                                                style={{ width: "100%", fontSize: "0.75rem", background: p.color, border: "none", borderRadius: 6, color: "#fff", padding: "0.3rem", cursor: "pointer", opacity: savingQuota === key ? 0.6 : 1 }}>
                                                                {savingQuota === key ? "..." : "💾 שמור מכסה"}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                </>
                            ))}
                        </>
                    ))}
                    {/* Save row */}
                    <tr style={{ background: "rgba(255,255,255,.03)" }}>
                        <td style={{ padding: "1rem", color: "#64748b", fontSize: "0.8rem" }}>שמור שינויים ↓</td>
                        {visiblePlans.map(plan => {
                            const p = planMeta(plan);
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
    );
}
