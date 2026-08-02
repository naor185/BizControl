"use client";
import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface ModuleDef { id: string; name: string; category: string; sort_order: number; parent_module_id?: string | null; }
interface StudioRow { id: string; name: string; subscription_plan: string; business_type: string; }
type ModuleMap = Record<string, boolean>;
interface QuotaOverride {
    limit_value_override: number | null; limit_value_delta: number | null;
    period_type_override: string | null; on_exceed_action_override: string | null;
}
const EMPTY_QUOTA_OVERRIDE: QuotaOverride = { limit_value_override: null, limit_value_delta: null, period_type_override: null, on_exceed_action_override: null };
const PERIOD_TYPE_LABELS: Record<string, string> = {
    unlimited: "ללא הגבלה", daily: "יומי", weekly: "שבועי", monthly: "חודשי", yearly: "שנתי", lifetime: "לכל החיים",
};
const ON_EXCEED_LABELS: Record<string, string> = {
    block: "חסום לחלוטין", warn_only: "התרעה בלבד", allow_overage: "המשך עם חריגה",
    paid_overage: "חריגה בתשלום", auto_increase: "הגדלה אוטומטית", custom: "אחר (עתידי)",
};

const CATEGORY_LABELS: Record<string, string> = {
    core: "🏗️ ליבה",
    communication: "💬 תקשורת",
    ai: "🤖 AI",
    marketplace: "🌐 Marketplace",
    advanced: "⚡ מתקדם",
    finance: "💰 פיננסים",
};

const CATEGORY_ORDER = ["core", "communication", "ai", "marketplace", "advanced", "finance"];

export default function ModulesAdminPage() {
    const [modules, setModules] = useState<ModuleDef[]>([]);
    const [studios, setStudios] = useState<StudioRow[]>([]);
    const [selectedStudio, setSelectedStudio] = useState<string>("");
    const [moduleMap, setModuleMap] = useState<ModuleMap>({});
    const [planModules, setPlanModules] = useState<Record<string, string[]>>({});
    const [businessTypes, setBusinessTypes] = useState<{ business_type: string; display_name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [err, setErr] = useState("");
    const [expandedQuotaModId, setExpandedQuotaModId] = useState<string | null>(null);
    const [quotaOverrides, setQuotaOverrides] = useState<Record<string, QuotaOverride>>({});
    const [savingQuota, setSavingQuota] = useState<string | null>(null);

    const loadBase = useCallback(async () => {
        setLoading(true);
        try {
            const [mods, studiosData, planMods, bts] = await Promise.all([
                apiFetch<ModuleDef[]>("/api/admin/modules"),
                apiFetch<StudioRow[]>("/api/admin/studios"),
                apiFetch<Record<string, string[]>>("/api/admin/plan-modules"),
                apiFetch<{ business_type: string; display_name: string }[]>("/api/admin/business-types"),
            ]);
            setModules(mods);
            setStudios(studiosData);
            setPlanModules(planMods);
            setBusinessTypes(bts);
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadStudioModules = useCallback(async (studioId: string) => {
        try {
            const [map, quotas] = await Promise.all([
                apiFetch<ModuleMap>(`/api/admin/studios/${studioId}/modules`),
                apiFetch<Record<string, QuotaOverride>>(`/api/admin/studios/${studioId}/modules/quota-overrides`),
            ]);
            setModuleMap(map);
            setQuotaOverrides(quotas);
        } catch (e: any) { setErr(e.message); }
    }, []);

    useEffect(() => { loadBase(); }, [loadBase]);
    useEffect(() => {
        if (selectedStudio) loadStudioModules(selectedStudio);
    }, [selectedStudio, loadStudioModules]);

    const quotaFor = (modId: string): QuotaOverride => quotaOverrides[modId] || EMPTY_QUOTA_OVERRIDE;
    const setQuotaField = (modId: string, field: keyof QuotaOverride, value: string | number | null) => {
        setQuotaOverrides(prev => ({ ...prev, [modId]: { ...(prev[modId] || EMPTY_QUOTA_OVERRIDE), [field]: value } }));
    };
    const saveQuotaOverride = async (modId: string) => {
        if (!selectedStudio) return;
        setSavingQuota(modId);
        try {
            await apiFetch(`/api/admin/studios/${selectedStudio}/modules/${modId}/quota`, {
                method: "PUT",
                body: JSON.stringify(quotaFor(modId)),
            });
        } catch (e: any) { setErr(e.message); }
        finally { setSavingQuota(null); }
    };

    const toggle = async (moduleId: string) => {
        if (!selectedStudio) return;
        const newVal = !moduleMap[moduleId];
        setSaving(moduleId);
        try {
            await apiFetch(`/api/admin/studios/${selectedStudio}/modules/${moduleId}`, {
                method: "PUT",
                body: JSON.stringify({ is_enabled: newVal }),
            });
            setModuleMap(prev => ({ ...prev, [moduleId]: newVal }));
        } catch (e: any) { setErr(e.message); }
        finally { setSaving(null); }
    };

    const setBusinessType = async (bt: string, loadDefaults: boolean) => {
        if (!selectedStudio) return;
        setSaving("bt");
        try {
            await apiFetch(`/api/admin/studios/${selectedStudio}/business-type`, {
                method: "PUT",
                body: JSON.stringify({ business_type: bt, load_defaults: loadDefaults }),
            });
            setStudios(prev => prev.map(s => s.id === selectedStudio ? { ...s, business_type: bt } : s));
            if (loadDefaults) await loadStudioModules(selectedStudio);
        } catch (e: any) { setErr(e.message); }
        finally { setSaving(null); }
    };

    // Tree order within each category: top-level module immediately followed
    // by its own sub-capabilities (parent_module_id), same pattern as admin/packages.
    const grouped = CATEGORY_ORDER.map(cat => {
        const catMods = modules.filter(m => m.category === cat).sort((a, b) => a.sort_order - b.sort_order);
        const topLevel = catMods.filter(m => !m.parent_module_id);
        const ordered: (ModuleDef & { depth: number })[] = [];
        topLevel.forEach(m => {
            ordered.push({ ...m, depth: 0 });
            catMods.filter(c => c.parent_module_id === m.id).forEach(child => {
                ordered.push({ ...child, depth: 1 });
            });
        });
        const seen = new Set(ordered.map(m => m.id));
        catMods.forEach(m => { if (!seen.has(m.id)) ordered.push({ ...m, depth: 0 }); }); // orphans, shouldn't happen
        return { cat, label: CATEGORY_LABELS[cat] || cat, mods: ordered };
    }).filter(g => g.mods.length > 0);

    const selectedStudioObj = studios.find(s => s.id === selectedStudio);
    const planForStudio = selectedStudioObj?.subscription_plan || "free";
    const planModsList = planModules[planForStudio] || [];

    const s: Record<string, React.CSSProperties> = {
        page: { minHeight: "100vh", background: "linear-gradient(135deg,#0f172a,#1e1b4b)", padding: "2rem", fontFamily: "sans-serif", direction: "rtl", color: "#fff" },
        header: { display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" },
        backBtn: { color: "#a78bfa", textDecoration: "none", fontSize: "0.9rem" },
        title: { fontSize: "1.8rem", fontWeight: 800, margin: 0 },
        card: { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" },
        label: { color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" },
        select: { background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.65rem 1rem", color: "#fff", fontSize: "0.9rem", width: "100%" },
        catTitle: { color: "#a78bfa", fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.75rem", marginTop: "0.5rem" },
        moduleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0", borderBottom: "1px solid rgba(255,255,255,.05)" },
        moduleName: { fontSize: "0.9rem", color: "#e2e8f0" },
        badge: { fontSize: "0.7rem", padding: "0.15rem 0.5rem", borderRadius: 8, fontWeight: 600 },
    };

    return (
        <div style={s.page}>
            <div style={{ maxWidth: 900, margin: "0 auto" }}>
                <div style={s.header}>
                    <a href="/admin" style={s.backBtn}>← חזרה לאדמין</a>
                    <h1 style={s.title}>🧩 ניהול מודולים</h1>
                </div>

                {err && <div style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "0.75rem 1rem", color: "#fca5a5", marginBottom: "1rem" }}>{err}</div>}

                {loading ? <div style={{ color: "#64748b", textAlign: "center", padding: "3rem" }}>טוען...</div> : (
                    <>
                        {/* Studio selector */}
                        <div style={s.card}>
                            <div style={s.label}>בחר סטודיו</div>
                            <select style={s.select} value={selectedStudio} onChange={e => setSelectedStudio(e.target.value)}>
                                <option value="">-- בחר סטודיו --</option>
                                {studios.map(st => (
                                    <option key={st.id} value={st.id}>{st.name} ({st.subscription_plan})</option>
                                ))}
                            </select>
                        </div>

                        {selectedStudio && selectedStudioObj && (
                            <>
                                {/* Business type */}
                                <div style={s.card}>
                                    <div style={s.label}>סוג עסק</div>
                                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                                        {businessTypes.map(bt => (
                                            <button
                                                key={bt.business_type}
                                                onClick={() => {
                                                    const load = window.confirm(`לטעון מודולי ברירת מחדל של "${bt.display_name}"?`);
                                                    setBusinessType(bt.business_type, load);
                                                }}
                                                disabled={saving === "bt"}
                                                style={{
                                                    padding: "0.4rem 0.9rem", borderRadius: 10,
                                                    border: `1px solid ${selectedStudioObj.business_type === bt.business_type ? "#a78bfa" : "rgba(255,255,255,.15)"}`,
                                                    background: selectedStudioObj.business_type === bt.business_type ? "rgba(167,139,250,.2)" : "transparent",
                                                    color: selectedStudioObj.business_type === bt.business_type ? "#a78bfa" : "#94a3b8",
                                                    cursor: "pointer", fontSize: "0.85rem",
                                                }}
                                            >
                                                {bt.display_name}
                                            </button>
                                        ))}
                                    </div>
                                    <div style={{ color: "#475569", fontSize: "0.75rem", marginTop: "0.5rem" }}>
                                        לחיצה על סוג עסק → תשאל אם לטעון מודולים ברירת מחדל
                                    </div>
                                </div>

                                {/* Modules grid */}
                                <div style={s.card}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                                        <span style={{ fontWeight: 700, fontSize: "1rem" }}>מודולים — {selectedStudioObj.name}</span>
                                        <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
                                            plan: <strong style={{ color: "#a78bfa" }}>{planForStudio}</strong> · {Object.values(moduleMap).filter(Boolean).length} פעילים
                                        </span>
                                    </div>

                                    {grouped.map(({ cat, label, mods }) => (
                                        <div key={cat} style={{ marginBottom: "1.5rem" }}>
                                            <div style={s.catTitle}>{label}</div>
                                            {mods.map(m => {
                                                const enabled = moduleMap[m.id] ?? false;
                                                const fromPlan = planModsList.includes(m.id);
                                                const q = quotaFor(m.id);
                                                const qKey = m.id;
                                                return (
                                                    <div key={m.id}>
                                                    <div style={{ ...s.moduleRow, paddingRight: m.depth ? "1.5rem" : 0 }}>
                                                        <div>
                                                            <span style={{ ...s.moduleName, color: m.depth ? "#94a3b8" : s.moduleName.color, fontSize: m.depth ? "0.82rem" : s.moduleName.fontSize }}>
                                                                {m.depth ? `↳ ${m.name}` : m.name}
                                                            </span>
                                                            {fromPlan && !moduleMap.hasOwnProperty(m.id) && (
                                                                <span style={{ ...s.badge, background: "rgba(96,165,250,.15)", color: "#60a5fa", marginRight: 8 }}>plan</span>
                                                            )}
                                                            {moduleMap.hasOwnProperty(m.id) && (
                                                                <span style={{ ...s.badge, background: "rgba(167,139,250,.15)", color: "#a78bfa", marginRight: 8 }}>override</span>
                                                            )}
                                                            <button
                                                                onClick={() => setExpandedQuotaModId(expandedQuotaModId === qKey ? null : qKey)}
                                                                title="הגדרת מכסה (Limits) לעסק זה"
                                                                style={{ marginRight: 8, background: "none", border: "none", cursor: "pointer", opacity: 0.6, fontSize: "0.75rem" }}
                                                            >⚙️</button>
                                                        </div>
                                                        <button
                                                            onClick={() => toggle(m.id)}
                                                            disabled={saving === m.id}
                                                            style={{
                                                                padding: "0.3rem 1rem", borderRadius: 20, border: "none",
                                                                cursor: "pointer", fontWeight: 600, fontSize: "0.8rem",
                                                                background: enabled ? "rgba(74,222,128,.15)" : "rgba(100,116,139,.15)",
                                                                color: enabled ? "#4ade80" : "#64748b",
                                                                minWidth: 70,
                                                            }}
                                                        >
                                                            {saving === m.id ? "..." : enabled ? "✅ פעיל" : "❌ כבוי"}
                                                        </button>
                                                    </div>
                                                    {expandedQuotaModId === qKey && (
                                                        <div style={{ background: "rgba(167,139,250,.05)", borderRadius: 10, padding: "0.75rem", marginBottom: "0.5rem" }}>
                                                            <div style={{ color: "#94a3b8", fontSize: "0.72rem", marginBottom: "0.5rem" }}>
                                                                Override תוספתי/מוחלט לעסק זה — ריק = ירושה מהפלאן
                                                            </div>
                                                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
                                                                <select value={q.period_type_override ?? ""} onChange={e => setQuotaField(qKey, "period_type_override", e.target.value || null)}
                                                                    style={{ ...s.select, width: "auto", fontSize: "0.75rem", padding: "0.3rem 0.5rem" }}>
                                                                    <option value="">(ירושה מהפלאן)</option>
                                                                    {Object.entries(PERIOD_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                                                </select>
                                                                <select value={q.on_exceed_action_override ?? ""} onChange={e => setQuotaField(qKey, "on_exceed_action_override", e.target.value || null)}
                                                                    style={{ ...s.select, width: "auto", fontSize: "0.75rem", padding: "0.3rem 0.5rem" }}>
                                                                    <option value="">(ירושה מהפלאן)</option>
                                                                    {Object.entries(ON_EXCEED_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                                                </select>
                                                            </div>
                                                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
                                                                <label style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                                                                    מכסה מוחלטת (override):
                                                                    <input type="number" value={q.limit_value_override ?? ""}
                                                                        onChange={e => setQuotaField(qKey, "limit_value_override", e.target.value === "" ? null : Number(e.target.value))}
                                                                        style={{ ...s.select, width: 90, fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginRight: 6 }} />
                                                                </label>
                                                                <label style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                                                                    תוספת (+delta):
                                                                    <input type="number" value={q.limit_value_delta ?? ""}
                                                                        onChange={e => setQuotaField(qKey, "limit_value_delta", e.target.value === "" ? null : Number(e.target.value))}
                                                                        style={{ ...s.select, width: 90, fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginRight: 6 }} />
                                                                </label>
                                                            </div>
                                                            <button onClick={() => saveQuotaOverride(qKey)} disabled={savingQuota === qKey}
                                                                style={{ fontSize: "0.75rem", background: "#a78bfa", border: "none", borderRadius: 8, color: "#1e1b4b", padding: "0.35rem 0.9rem", cursor: "pointer", fontWeight: 700, opacity: savingQuota === qKey ? 0.6 : 1 }}>
                                                                {savingQuota === qKey ? "..." : "💾 שמור Override"}
                                                            </button>
                                                        </div>
                                                    )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>

                                {/* Plan legend */}
                                <div style={{ color: "#475569", fontSize: "0.78rem", textAlign: "center" }}>
                                    <span style={{ color: "#60a5fa" }}>plan</span> = נכלל בחבילה, ללא override ·{" "}
                                    <span style={{ color: "#a78bfa" }}>override</span> = הוגדר ידנית ע"י Super Admin
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
