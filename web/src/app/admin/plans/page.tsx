"use client";
import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import ModuleTreeEditor, { planMeta } from "@/components/admin/ModuleTreeEditor";

interface PlanRecord {
    id: string; display_name: string; price_cents: number; currency: string;
    billing_period_days: number; trial_days: number; stripe_price_id: string | null;
    scope_bizcontrol: boolean; is_purchasable: boolean; is_visible: boolean;
    sort_order: number; is_active: boolean;
    price_monthly_cents: number | null; price_annual_cents: number | null;
    sale_price_cents: number | null; sale_expires_at: string | null;
    active_subscriptions_count: number;
}
interface DashboardEntry {
    plan_id: string; display_name: string; status_counts: Record<string, number>;
    active_count: number; mrr_cents: number; near_quota_count: number; over_quota_count: number;
}
interface StudioRow { id: string; name: string; subscription_plan: string; }
interface PreviewResult {
    studio_id: string; studio_name: string; current_plan_id: string; preview_plan_id: string;
    modules: Record<string, boolean>;
    quotas: { quota_key: string; used: number; limit: number | null; remaining: number | null; percent: number | null; period_type: string; on_exceed_action: string }[];
    available_addons: { id: string; display_name: string }[];
}
interface AuditEntry { id: string; admin_email: string; action: string; studio_id: string | null; studio_name: string | null; details: any; created_at: string; }
interface AddonRecord {
    id: string; display_name: string; description: string | null; price_cents: number; currency: string;
    billing_type: string; applies_to_all_plans: boolean; is_visible: boolean; is_purchasable: boolean;
    is_active: boolean; sort_order: number; active_studio_count: number; plan_ids: string[];
}
interface AddonDashboardEntry {
    addon_id: string; display_name: string; active_studio_count: number; revenue_cents: number;
    billing_type: string; usage_rate_percent: number | null;
}
const BILLING_TYPE_LABELS: Record<string, string> = { one_time: "חד-פעמי", monthly: "חודשי", yearly: "שנתי" };

// "Modules" and "Quotas" are one tab, not two — a quota is set by expanding
// a module row (⚙️) in the exact same tree, so showing that tree under two
// separate tab labels would just be the identical screen rendered twice.
type Tab = "overview" | "modules" | "addons" | "preview" | "compare" | "audit";
const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "📋 סקירה ותמחור" },
    { id: "modules", label: "🧩 מודולים ומכסות" },
    { id: "addons", label: "➕ Add-ons" },
    { id: "preview", label: "👁️ Preview" },
    { id: "compare", label: "⚖️ Compare" },
    { id: "audit", label: "📜 Audit" },
];

function cents(v: number | null | undefined, currency = "ILS") {
    if (v === null || v === undefined) return "—";
    return `${(v / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 })} ${currency}`;
}

export default function PlansCenterPage() {
    const [plans, setPlans] = useState<PlanRecord[] | null>(null);
    const [dashboard, setDashboard] = useState<DashboardEntry[] | null>(null);
    const [addonDashboard, setAddonDashboard] = useState<AddonDashboardEntry[] | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>("overview");
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newPlanId, setNewPlanId] = useState("");
    const [newPlanName, setNewPlanName] = useState("");

    const loadPlans = useCallback(async () => {
        try {
            const [p, d, ad] = await Promise.all([
                apiFetch<PlanRecord[]>("/api/admin/plans"),
                apiFetch<DashboardEntry[]>("/api/admin/plans/dashboard"),
                apiFetch<AddonDashboardEntry[]>("/api/admin/addons/dashboard"),
            ]);
            setPlans(p);
            setDashboard(d);
            setAddonDashboard(ad);
        } catch (e: any) { toast.error(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { loadPlans(); }, [loadPlans]);

    const selected = plans?.find(p => p.id === selectedId) || null;

    const createPlan = async () => {
        if (!newPlanId.trim() || !newPlanName.trim()) return;
        try {
            const res = await apiFetch<PlanRecord>("/api/admin/plans", {
                method: "POST",
                body: JSON.stringify({ id: newPlanId.trim(), display_name: newPlanName.trim(), is_visible: false, is_purchasable: false }),
            });
            toast.success("פלאן נוצר (כטיוטה — לא מפורסם)!");
            setCreating(false); setNewPlanId(""); setNewPlanName("");
            await loadPlans();
            setSelectedId(res.id);
        } catch (e: any) { toast.error(e.message); }
    };

    const duplicatePlan = async (planId: string) => {
        const newId = window.prompt("מזהה לפלאן החדש (אותיות קטנות/מספרים/_ בלבד):", `${planId}_copy`);
        if (!newId) return;
        try {
            const res = await apiFetch<PlanRecord>(`/api/admin/plans/${planId}/duplicate`, {
                method: "POST", body: JSON.stringify({ new_id: newId }),
            });
            toast.success("שוכפל! (הפלאן החדש הוא טיוטה — לא מפורסם)");
            await loadPlans();
            setSelectedId(res.id);
        } catch (e: any) { toast.error(e.message); }
    };

    const deletePlan = async (planId: string) => {
        if (!window.confirm(`למחוק את הפלאן "${planId}"? פעולה זו בלתי הפיכה.`)) return;
        try {
            await apiFetch(`/api/admin/plans/${planId}`, { method: "DELETE" });
            toast.success("נמחק");
            setSelectedId(null);
            await loadPlans();
        } catch (e: any) { toast.error(e.message); }
    };

    const togglePublish = async (plan: PlanRecord) => {
        try {
            await apiFetch(`/api/admin/plans/${plan.id}/${plan.is_visible ? "unpublish" : "publish"}`, { method: "POST" });
            await loadPlans();
        } catch (e: any) { toast.error(e.message); }
    };

    const s = {
        page: { minHeight: "100vh", background: "linear-gradient(135deg,#0f172a,#1e1b4b)", padding: "2rem", fontFamily: "sans-serif", direction: "rtl" as const, color: "#fff" },
        card: { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.25rem" },
    };

    return (
        <div style={s.page}>
            <div style={{ maxWidth: 1400, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                    <a href="/admin" style={{ color: "#a78bfa", textDecoration: "none", fontSize: "0.9rem" }}>← חזרה לאדמין</a>
                    <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: 0 }}>🎛️ מרכז ניהול מסלולים</h1>
                    <a href="/admin/packages" style={{ marginRight: "auto", color: "#a78bfa", textDecoration: "none", fontSize: "0.85rem" }}>עורך חבילות (גריד מלא) ←</a>
                </div>

                {loading ? <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>טוען...</div> : (
                    <>
                        {/* ── Dashboard strip ── */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
                            {(dashboard || []).map(d => {
                                const p = planMeta(d.plan_id);
                                return (
                                    <div key={d.plan_id} onClick={() => setSelectedId(d.plan_id)}
                                        style={{ ...s.card, cursor: "pointer", borderColor: selectedId === d.plan_id ? p.color : "rgba(255,255,255,.1)" }}>
                                        <div style={{ color: p.color, fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.5rem" }}>{p.icon} {d.display_name}</div>
                                        <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{d.active_count} <span style={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: 400 }}>עסקים פעילים</span></div>
                                        <div style={{ fontSize: "0.75rem", color: "#4ade80", marginTop: "0.25rem" }}>MRR: {cents(d.mrr_cents)}</div>
                                        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.7rem", color: "#94a3b8" }}>
                                            <span>Trial: {d.status_counts.trial || 0}</span>
                                            <span>מבוטלים: {d.status_counts.canceled || 0}</span>
                                        </div>
                                        {(d.near_quota_count > 0 || d.over_quota_count > 0) && (
                                            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", fontSize: "0.7rem" }}>
                                                {d.near_quota_count > 0 && <span style={{ color: "#facc15" }}>⚠️ {d.near_quota_count} קרובים למכסה</span>}
                                                {d.over_quota_count > 0 && <span style={{ color: "#f87171" }}>🔴 {d.over_quota_count} בחריגה</span>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {addonDashboard && addonDashboard.length > 0 && (
                            <div style={{ marginBottom: "1.5rem" }}>
                                <div style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 700, marginBottom: "0.5rem" }}>➕ Add-ons</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.6rem" }}>
                                    {addonDashboard.map(a => (
                                        <div key={a.addon_id} style={{ ...s.card, padding: "0.85rem" }}>
                                            <div style={{ fontWeight: 700, fontSize: "0.82rem", marginBottom: "0.4rem" }}>{a.display_name}</div>
                                            <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{a.active_studio_count} <span style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 400 }}>עסקים</span></div>
                                            <div style={{ fontSize: "0.72rem", color: "#4ade80", marginTop: "0.2rem" }}>הכנסה: {cents(a.revenue_cents)}</div>
                                            {a.usage_rate_percent !== null && (
                                                <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: "0.2rem" }}>שיעור שימוש: {a.usage_rate_percent}%</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "1.25rem", alignItems: "start" }}>
                            {/* ── Plan list ── */}
                            <div style={s.card}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                                    <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>פלאנים</span>
                                    <button onClick={() => setCreating(v => !v)} style={{ background: "rgba(167,139,250,.2)", color: "#a78bfa", border: "none", borderRadius: 8, padding: "0.25rem 0.6rem", fontSize: "0.75rem", cursor: "pointer" }}>+ חדש</button>
                                </div>
                                {creating && (
                                    <div style={{ marginBottom: "0.75rem", padding: "0.6rem", background: "rgba(255,255,255,.04)", borderRadius: 10 }}>
                                        <input value={newPlanId} onChange={e => setNewPlanId(e.target.value)} placeholder="plan_id" dir="ltr"
                                            style={{ width: "100%", marginBottom: "0.4rem", background: "#1e1b4b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "0.35rem 0.5rem", color: "#fff", fontSize: "0.8rem", boxSizing: "border-box" }} />
                                        <input value={newPlanName} onChange={e => setNewPlanName(e.target.value)} placeholder="שם תצוגה"
                                            style={{ width: "100%", marginBottom: "0.4rem", background: "#1e1b4b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "0.35rem 0.5rem", color: "#fff", fontSize: "0.8rem", boxSizing: "border-box" }} />
                                        <button onClick={createPlan} style={{ width: "100%", background: "#a78bfa", border: "none", borderRadius: 6, padding: "0.4rem", color: "#1e1b4b", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>צור</button>
                                    </div>
                                )}
                                {(plans || []).sort((a, b) => a.sort_order - b.sort_order).map(p => {
                                    const meta = planMeta(p.id);
                                    return (
                                        <div key={p.id} onClick={() => { setSelectedId(p.id); setTab("overview"); }}
                                            style={{ padding: "0.6rem 0.7rem", borderRadius: 10, cursor: "pointer", marginBottom: "0.3rem", background: selectedId === p.id ? "rgba(167,139,250,.15)" : "transparent", border: selectedId === p.id ? `1px solid ${meta.color}` : "1px solid transparent" }}>
                                            <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{meta.icon} {p.display_name}</div>
                                            <div style={{ fontSize: "0.7rem", color: "#64748b", display: "flex", gap: "0.4rem", marginTop: "0.2rem" }}>
                                                <span>{p.active_subscriptions_count} עסקים</span>
                                                {!p.is_visible && <span style={{ color: "#94a3b8" }}>🙈 מוסתר</span>}
                                                {!p.is_purchasable && <span style={{ color: "#94a3b8" }}>🚫 לא לרכישה</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* ── Detail panel ── */}
                            {!selected ? (
                                <div style={s.card}><div style={{ textAlign: "center", color: "#64748b", padding: "2rem" }}>בחר פלאן מהרשימה</div></div>
                            ) : (
                                <div>
                                    <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                                        {TABS.map(t => (
                                            <button key={t.id} onClick={() => setTab(t.id)}
                                                style={{ background: tab === t.id ? "#a78bfa" : "rgba(255,255,255,.06)", color: tab === t.id ? "#1e1b4b" : "#cbd5e1", border: "none", borderRadius: 10, padding: "0.45rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}>
                                                {t.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div style={s.card}>
                                        {tab === "overview" && <OverviewTab plan={selected} onSaved={loadPlans} onDuplicate={() => duplicatePlan(selected.id)} onDelete={() => deletePlan(selected.id)} onTogglePublish={() => togglePublish(selected)} />}
                                        {tab === "modules" && <ModuleTreeEditor planFilter={[selected.id]} />}
                                        {tab === "addons" && <AddonsTab plan={selected} />}
                                        {tab === "preview" && <PreviewTab plan={selected} />}
                                        {tab === "compare" && <CompareTab plans={plans || []} defaultOther={selected.id} />}
                                        {tab === "audit" && <AuditTab key={selected.id} planId={selected.id} />}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Overview / Pricing tab ────────────────────────────────────────────────────

function OverviewTab({ plan, onSaved, onDuplicate, onDelete, onTogglePublish }: {
    plan: PlanRecord; onSaved: () => void; onDuplicate: () => void; onDelete: () => void; onTogglePublish: () => void;
}) {
    const [form, setForm] = useState(plan);
    const [saving, setSaving] = useState(false);
    useEffect(() => { setForm(plan); }, [plan]);

    const field = (label: string, key: keyof PlanRecord, type: string = "text") => (
        <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.3rem" }}>{label}</label>
            <input
                type={type}
                value={(form[key] as any) ?? ""}
                onChange={e => setForm(f => ({ ...f, [key]: type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value }))}
                style={{ width: "100%", background: "#1e1b4b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "0.5rem 0.7rem", color: "#fff", fontSize: "0.85rem", boxSizing: "border-box" }}
            />
        </div>
    );
    const checkbox = (label: string, key: keyof PlanRecord) => (
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", marginBottom: "0.5rem", cursor: "pointer" }}>
            <input type="checkbox" checked={!!form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
            {label}
        </label>
    );

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch(`/api/admin/plans/${plan.id}`, {
                method: "PUT",
                body: JSON.stringify({
                    display_name: form.display_name, price_cents: form.price_cents, currency: form.currency,
                    billing_period_days: form.billing_period_days, trial_days: form.trial_days,
                    stripe_price_id: form.stripe_price_id || null, scope_bizcontrol: form.scope_bizcontrol,
                    is_purchasable: form.is_purchasable, sort_order: form.sort_order,
                    price_monthly_cents: form.price_monthly_cents, price_annual_cents: form.price_annual_cents,
                    sale_price_cents: form.sale_price_cents, sale_expires_at: form.sale_expires_at,
                }),
            });
            toast.success("נשמר!");
            onSaved();
        } catch (e: any) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <span style={{ fontWeight: 700 }}>{plan.id}</span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button onClick={onTogglePublish} style={{ background: "rgba(255,255,255,.08)", color: "#cbd5e1", border: "none", borderRadius: 8, padding: "0.35rem 0.8rem", fontSize: "0.75rem", cursor: "pointer" }}>
                        {plan.is_visible ? "🙈 הסתר" : "📢 פרסם"}
                    </button>
                    <button onClick={onDuplicate} style={{ background: "rgba(255,255,255,.08)", color: "#cbd5e1", border: "none", borderRadius: 8, padding: "0.35rem 0.8rem", fontSize: "0.75rem", cursor: "pointer" }}>⧉ שכפל</button>
                    <button onClick={onDelete} disabled={plan.active_subscriptions_count > 0}
                        title={plan.active_subscriptions_count > 0 ? "לא ניתן למחוק — יש מנויים פעילים" : ""}
                        style={{ background: "rgba(239,68,68,.15)", color: "#f87171", border: "none", borderRadius: 8, padding: "0.35rem 0.8rem", fontSize: "0.75rem", cursor: plan.active_subscriptions_count > 0 ? "not-allowed" : "pointer", opacity: plan.active_subscriptions_count > 0 ? 0.5 : 1 }}>
                        🗑️ מחק
                    </button>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a78bfa", marginBottom: "0.6rem" }}>כללי</div>
                    {field("שם תצוגה", "display_name")}
                    {field("סדר הצגה", "sort_order", "number")}
                    {checkbox("ניתן לרכישה (מוצע ללקוחות חדשים)", "is_purchasable")}
                    {checkbox("כולל גישה ל-BizControl", "scope_bizcontrol")}
                    {field("Stripe Price ID", "stripe_price_id")}
                </div>
                <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a78bfa", marginBottom: "0.6rem" }}>תמחור</div>
                    {field("מחיר (אגורות)", "price_cents", "number")}
                    {field("מטבע", "currency")}
                    {field("תקופת חיוב (ימים)", "billing_period_days", "number")}
                    {field("ימי Trial", "trial_days", "number")}
                    {field("מחיר חודשי (אגורות)", "price_monthly_cents", "number")}
                    {field("מחיר שנתי (אגורות)", "price_annual_cents", "number")}
                    {field("מחיר מבצע (אגורות)", "sale_price_cents", "number")}
                    <div style={{ fontSize: "0.7rem", color: "#64748b", marginTop: "-0.4rem", marginBottom: "0.75rem" }}>
                        ⓘ שדות התמחור המתקדמים (חודשי/שנתי/מבצע) נשמרים ומוצגים, אך זרימת ה-Checkout עדיין משתמשת ב״מחיר״ ו״תקופת חיוב״ הרגילים — חיבורם המלא הוא הרחבה עתידית.
                    </div>
                </div>
            </div>

            <button onClick={save} disabled={saving} style={{ marginTop: "1rem", background: "#a78bfa", border: "none", borderRadius: 10, padding: "0.6rem 1.5rem", color: "#1e1b4b", fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
                {saving ? "שומר..." : "💾 שמור שינויים"}
            </button>
        </div>
    );
}

// ── Add-ons tab — full management (Generic Plans Engine step 6) ─────────────
// Add-ons are standalone entities, not scoped to one plan — this tab lists
// ALL of them (creatable/editable/duplicable/publishable from here), with a
// per-addon checkbox for whether it's offered on the currently-selected plan.

function AddonsTab({ plan }: { plan: PlanRecord }) {
    const [addons, setAddons] = useState<AddonRecord[] | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [newId, setNewId] = useState("");
    const [newName, setNewName] = useState("");

    const load = useCallback(() => {
        apiFetch<AddonRecord[]>("/api/admin/addons").then(setAddons).catch(() => setAddons([]));
    }, []);
    useEffect(() => { load(); }, [load]);

    const createAddon = async () => {
        if (!newId.trim() || !newName.trim()) return;
        try {
            await apiFetch("/api/admin/addons", {
                method: "POST",
                body: JSON.stringify({ id: newId.trim(), display_name: newName.trim(), is_visible: false, is_purchasable: false }),
            });
            toast.success("Add-on נוצר (כטיוטה)!");
            setCreating(false); setNewId(""); setNewName("");
            load();
        } catch (e: any) { toast.error(e.message); }
    };

    const toggleForPlan = async (addon: AddonRecord) => {
        const has = addon.plan_ids.includes(plan.id);
        const nextIds = has ? addon.plan_ids.filter(p => p !== plan.id) : [...addon.plan_ids, plan.id];
        try {
            await apiFetch(`/api/admin/addons/${addon.id}/plans`, { method: "PUT", body: JSON.stringify({ plan_ids: nextIds }) });
            load();
        } catch (e: any) { toast.error(e.message); }
    };

    if (!addons) return <div style={{ color: "#64748b" }}>טוען...</div>;

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                    כל ה-Add-ons במערכת — הצ'קבוקס קובע האם זמין למסלול <strong>{plan.display_name}</strong>
                </div>
                <button onClick={() => setCreating(v => !v)} style={{ background: "rgba(167,139,250,.2)", color: "#a78bfa", border: "none", borderRadius: 8, padding: "0.35rem 0.8rem", fontSize: "0.75rem", cursor: "pointer" }}>+ Add-on חדש</button>
            </div>
            {creating && (
                <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "rgba(255,255,255,.04)", borderRadius: 10, display: "flex", gap: "0.5rem" }}>
                    <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="addon_id" dir="ltr"
                        style={{ flex: 1, background: "#1e1b4b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "0.4rem 0.6rem", color: "#fff", fontSize: "0.8rem" }} />
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="שם תצוגה"
                        style={{ flex: 1, background: "#1e1b4b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "0.4rem 0.6rem", color: "#fff", fontSize: "0.8rem" }} />
                    <button onClick={createAddon} style={{ background: "#a78bfa", border: "none", borderRadius: 6, padding: "0.4rem 1rem", color: "#1e1b4b", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>צור</button>
                </div>
            )}
            {addons.length === 0 && <div style={{ color: "#64748b", textAlign: "center", padding: "1.5rem" }}>אין עדיין Add-ons</div>}
            {addons.map(addon => (
                <div key={addon.id} style={{ marginBottom: "0.5rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0.75rem", background: "rgba(255,255,255,.03)", borderRadius: 10 }}>
                        <input type="checkbox" checked={addon.applies_to_all_plans || addon.plan_ids.includes(plan.id)}
                            disabled={addon.applies_to_all_plans}
                            onChange={() => toggleForPlan(addon)}
                            title={addon.applies_to_all_plans ? "זמין לכל המסלולים" : ""} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{addon.display_name} <span style={{ color: "#64748b", fontSize: "0.7rem" }}>({addon.id})</span></div>
                            <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                                {cents(addon.price_cents, addon.currency)} · {BILLING_TYPE_LABELS[addon.billing_type] || addon.billing_type} · {addon.active_studio_count} עסקים פעילים
                                {addon.applies_to_all_plans && " · כל המסלולים"}
                                {!addon.is_visible && " · 🙈 מוסתר"}
                            </div>
                        </div>
                        <button onClick={() => setExpandedId(expandedId === addon.id ? null : addon.id)}
                            style={{ background: "rgba(255,255,255,.08)", color: "#cbd5e1", border: "none", borderRadius: 8, padding: "0.3rem 0.7rem", fontSize: "0.75rem", cursor: "pointer" }}>
                            {expandedId === addon.id ? "סגור" : "ערוך"}
                        </button>
                    </div>
                    {expandedId === addon.id && <AddonEditor addon={addon} onChanged={load} />}
                </div>
            ))}
        </div>
    );
}

function AddonEditor({ addon, onChanged }: { addon: AddonRecord; onChanged: () => void }) {
    const [form, setForm] = useState(addon);
    const [saving, setSaving] = useState(false);
    const [moduleIds, setModuleIds] = useState<string[]>([]);
    const [allModules, setAllModules] = useState<{ id: string; name: string }[]>([]);
    const [deltas, setDeltas] = useState<Record<string, number | null>>({});

    useEffect(() => { setForm(addon); }, [addon]);
    useEffect(() => {
        apiFetch<{ module_ids: string[]; deltas: Record<string, number | null> }>(`/api/admin/addons/${addon.id}/modules`)
            .then(r => { setModuleIds(r.module_ids); setDeltas(r.deltas || {}); }).catch(() => {});
        apiFetch<{ id: string; name: string; category: string }[]>("/api/admin/modules")
            .then(mods => setAllModules(mods.map(m => ({ id: m.id, name: m.name })))).catch(() => {});
    }, [addon.id]);

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch(`/api/admin/addons/${addon.id}`, {
                method: "PUT",
                body: JSON.stringify({
                    display_name: form.display_name, description: form.description, price_cents: form.price_cents,
                    currency: form.currency, billing_type: form.billing_type, applies_to_all_plans: form.applies_to_all_plans,
                    is_purchasable: form.is_purchasable, sort_order: form.sort_order,
                }),
            });
            toast.success("נשמר!");
            onChanged();
        } catch (e: any) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    const toggleModule = async (moduleId: string) => {
        const next = moduleIds.includes(moduleId) ? moduleIds.filter(m => m !== moduleId) : [...moduleIds, moduleId];
        try {
            await apiFetch(`/api/admin/addons/${addon.id}/modules`, { method: "PUT", body: JSON.stringify({ module_ids: next }) });
            setModuleIds(next);
        } catch (e: any) { toast.error(e.message); }
    };

    const saveDelta = async (moduleId: string, value: number | null) => {
        try {
            await apiFetch(`/api/admin/addons/${addon.id}/modules/${moduleId}/delta`, { method: "PUT", body: JSON.stringify({ limit_delta: value }) });
            setDeltas(d => ({ ...d, [moduleId]: value }));
        } catch (e: any) { toast.error(e.message); }
    };

    const togglePublish = async () => {
        try {
            await apiFetch(`/api/admin/addons/${addon.id}/${form.is_visible ? "unpublish" : "publish"}`, { method: "POST" });
            onChanged();
        } catch (e: any) { toast.error(e.message); }
    };

    const duplicate = async () => {
        const newId = window.prompt("מזהה ל-Add-on החדש:", `${addon.id}_copy`);
        if (!newId) return;
        try {
            await apiFetch(`/api/admin/addons/${addon.id}/duplicate`, { method: "POST", body: JSON.stringify({ new_id: newId }) });
            toast.success("שוכפל!");
            onChanged();
        } catch (e: any) { toast.error(e.message); }
    };

    const remove = async () => {
        if (!window.confirm(`למחוק את "${addon.id}"?`)) return;
        try {
            await apiFetch(`/api/admin/addons/${addon.id}`, { method: "DELETE" });
            toast.success("נמחק");
            onChanged();
        } catch (e: any) { toast.error(e.message); }
    };

    const inputStyle = { width: "100%", background: "#1e1b4b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "0.4rem 0.6rem", color: "#fff", fontSize: "0.8rem", boxSizing: "border-box" as const };

    return (
        <div style={{ background: "rgba(255,255,255,.02)", borderRadius: 10, padding: "1rem", marginTop: "0.4rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                    <label style={{ fontSize: "0.72rem", color: "#94a3b8" }}>שם תצוגה</label>
                    <input style={inputStyle} value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
                </div>
                <div>
                    <label style={{ fontSize: "0.72rem", color: "#94a3b8" }}>מחיר (אגורות)</label>
                    <input type="number" style={inputStyle} value={form.price_cents} onChange={e => setForm(f => ({ ...f, price_cents: Number(e.target.value) }))} />
                </div>
                <div>
                    <label style={{ fontSize: "0.72rem", color: "#94a3b8" }}>סוג חיוב</label>
                    <select style={inputStyle} value={form.billing_type} onChange={e => setForm(f => ({ ...f, billing_type: e.target.value }))}>
                        {Object.entries(BILLING_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem" }}>
                        <input type="checkbox" checked={form.applies_to_all_plans} onChange={e => setForm(f => ({ ...f, applies_to_all_plans: e.target.checked }))} />
                        זמין לכל המסלולים
                    </label>
                </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <button onClick={save} disabled={saving} style={{ background: "#a78bfa", border: "none", borderRadius: 8, padding: "0.4rem 1rem", color: "#1e1b4b", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>💾 שמור</button>
                <button onClick={togglePublish} style={{ background: "rgba(255,255,255,.08)", color: "#cbd5e1", border: "none", borderRadius: 8, padding: "0.4rem 1rem", fontSize: "0.8rem", cursor: "pointer" }}>{form.is_visible ? "🙈 הסתר" : "📢 פרסם"}</button>
                <button onClick={duplicate} style={{ background: "rgba(255,255,255,.08)", color: "#cbd5e1", border: "none", borderRadius: 8, padding: "0.4rem 1rem", fontSize: "0.8rem", cursor: "pointer" }}>⧉ שכפל</button>
                <button onClick={remove} disabled={addon.active_studio_count > 0} style={{ background: "rgba(239,68,68,.15)", color: "#f87171", border: "none", borderRadius: 8, padding: "0.4rem 1rem", fontSize: "0.8rem", cursor: addon.active_studio_count > 0 ? "not-allowed" : "pointer", opacity: addon.active_studio_count > 0 ? 0.5 : 1 }}>🗑️ מחק</button>
            </div>

            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#a78bfa", marginBottom: "0.5rem" }}>מה ה-Add-on מעניק</div>
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {allModules.map(m => {
                    const granted = moduleIds.includes(m.id);
                    return (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.3rem 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                            <input type="checkbox" checked={granted} onChange={() => toggleModule(m.id)} />
                            <span style={{ flex: 1, fontSize: "0.8rem" }}>{m.name}</span>
                            {granted && (
                                <input type="number" placeholder="+ מכסה" value={deltas[m.id] ?? ""}
                                    onChange={e => saveDelta(m.id, e.target.value === "" ? null : Number(e.target.value))}
                                    style={{ width: 90, fontSize: "0.75rem", background: "#1e1b4b", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "0.25rem" }} />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Preview tab ────────────────────────────────────────────────────────────

function PreviewTab({ plan }: { plan: PlanRecord }) {
    const [studios, setStudios] = useState<StudioRow[]>([]);
    const [studioId, setStudioId] = useState("");
    const [result, setResult] = useState<PreviewResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectedAddonIds, setSelectedAddonIds] = useState<string[] | null>(null); // null = "use studio's real add-ons"

    useEffect(() => { apiFetch<StudioRow[]>("/api/admin/studios").then(setStudios).catch(() => {}); }, []);

    const run = async (addonIds: string[] | null) => {
        if (!studioId) return;
        setLoading(true);
        try {
            const qs = addonIds !== null ? `&addon_ids=${addonIds.join(",")}` : "";
            const res = await apiFetch<PreviewResult>(`/api/admin/plans/${plan.id}/preview?studio_id=${studioId}${qs}`);
            setResult(res);
        } catch (e: any) { toast.error(e.message); }
        finally { setLoading(false); }
    };

    const toggleAddon = (addonId: string) => {
        const current = selectedAddonIds ?? [];
        const next = current.includes(addonId) ? current.filter(a => a !== addonId) : [...current, addonId];
        setSelectedAddonIds(next);
        run(next);
    };

    return (
        <div>
            <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.75rem" }}>
                ״איך העסק הזה ייראה על מסלול {plan.display_name}?״ — קריאה בלבד, לא משנה שום דבר בפועל.
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <select value={studioId} onChange={e => { setStudioId(e.target.value); setSelectedAddonIds(null); }}
                    style={{ flex: 1, background: "#1e1b4b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "0.5rem", color: "#fff", fontSize: "0.85rem" }}>
                    <option value="">-- בחר עסק --</option>
                    {studios.map(st => <option key={st.id} value={st.id}>{st.name} ({st.subscription_plan})</option>)}
                </select>
                <button onClick={() => run(null)} disabled={!studioId || loading} style={{ background: "#a78bfa", border: "none", borderRadius: 8, padding: "0.5rem 1.2rem", color: "#1e1b4b", fontWeight: 700, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
                    {loading ? "..." : "👁️ תצוגה מקדימה"}
                </button>
            </div>

            {result && (
                <div>
                    <div style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                        <strong>{result.studio_name}</strong> — פלאן נוכחי: <code>{result.current_plan_id}</code> ← בתצוגה מקדימה על: <code>{result.preview_plan_id}</code>
                    </div>

                    {result.available_addons.length > 0 && (
                        <div style={{ marginBottom: "1rem", padding: "0.6rem 0.75rem", background: "rgba(167,139,250,.06)", borderRadius: 10 }}>
                            <div style={{ fontSize: "0.75rem", color: "#a78bfa", fontWeight: 700, marginBottom: "0.4rem" }}>Add-ons זמינים למסלול זה — הפעל/כבה לצפייה מיידית בהשפעה</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                                {result.available_addons.map(a => (
                                    <label key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", cursor: "pointer" }}>
                                        <input type="checkbox" checked={(selectedAddonIds ?? []).includes(a.id)} onChange={() => toggleAddon(a.id)} />
                                        {a.display_name}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: "0.8rem", marginBottom: "0.5rem", color: "#a78bfa" }}>מודולים</div>
                            {Object.entries(result.modules).map(([mid, enabled]) => (
                                <div key={mid} style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", borderBottom: "1px solid rgba(255,255,255,.05)", fontSize: "0.8rem" }}>
                                    <span>{mid}</span><span>{enabled ? "✅" : "○"}</span>
                                </div>
                            ))}
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: "0.8rem", marginBottom: "0.5rem", color: "#a78bfa" }}>מכסות</div>
                            {result.quotas.length === 0 && <div style={{ fontSize: "0.8rem", color: "#64748b" }}>אין מכסות מוגדרות</div>}
                            {result.quotas.map(q => (
                                <div key={q.quota_key} style={{ padding: "0.3rem 0", borderBottom: "1px solid rgba(255,255,255,.05)", fontSize: "0.8rem" }}>
                                    {q.quota_key}: {q.used}/{q.limit ?? "∞"} ({q.period_type})
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Compare tab (UI only, over already-loaded package data) ─────────────────

function CompareTab({ plans, defaultOther }: { plans: PlanRecord[]; defaultOther: string }) {
    const [otherId, setOtherId] = useState(plans.find(p => p.id !== defaultOther)?.id || "");
    const [pkg, setPkg] = useState<{ modules: { id: string; name: string; category: string }[]; plan_modules: Record<string, string[]>; plan_quotas: Record<string, Record<string, PlanQuota>> } | null>(null);

    interface PlanQuota { limit_value: number | null; period_type: string; on_exceed_action: string; auto_increase_by: number | null; }

    useEffect(() => { apiFetch<any>("/api/admin/packages").then(setPkg).catch(() => {}); }, []);

    if (!pkg) return <div style={{ color: "#64748b" }}>טוען...</div>;

    const a = defaultOther, b = otherId;
    const aMods = new Set(pkg.plan_modules[a] || []);
    const bMods = new Set(pkg.plan_modules[b] || []);

    return (
        <div>
            <div style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.8rem", color: "#94a3b8", marginLeft: "0.5rem" }}>השווה מול:</label>
                <select value={otherId} onChange={e => setOtherId(e.target.value)}
                    style={{ background: "#1e1b4b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "0.4rem 0.7rem", color: "#fff", fontSize: "0.85rem" }}>
                    {plans.filter(p => p.id !== a).map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
            </div>
            <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
                <thead>
                    <tr style={{ textAlign: "right", color: "#94a3b8" }}>
                        <th style={{ padding: "0.4rem" }}>מודול</th>
                        <th style={{ padding: "0.4rem", textAlign: "center" }}>{a}</th>
                        <th style={{ padding: "0.4rem", textAlign: "center" }}>{b}</th>
                    </tr>
                </thead>
                <tbody>
                    {pkg.modules.map(m => {
                        const inA = aMods.has(m.id), inB = bMods.has(m.id);
                        const differs = inA !== inB;
                        return (
                            <tr key={m.id} style={{ borderBottom: "1px solid rgba(255,255,255,.05)", background: differs ? "rgba(250,204,21,.06)" : undefined }}>
                                <td style={{ padding: "0.4rem" }}>{m.name}</td>
                                <td style={{ padding: "0.4rem", textAlign: "center" }}>{inA ? "✅" : "○"}</td>
                                <td style={{ padding: "0.4rem", textAlign: "center" }}>{inB ? "✅" : "○"}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ── Audit tab (extends the existing /admin/audit-log) ────────────────────────

const PLAN_ACTIONS = "create_plan,update_plan,delete_plan,duplicate_plan,publish_plan,unpublish_plan,update_package,update_package_quota";

function AuditTab({ planId }: { planId: string }) {
    const [entries, setEntries] = useState<AuditEntry[] | null>(null);

    useEffect(() => {
        apiFetch<AuditEntry[]>(`/api/admin/audit-log?plan_id=${planId}&action=${PLAN_ACTIONS}&limit=100`)
            .then(setEntries)
            .catch(() => setEntries([]));
    }, [planId]);

    if (!entries) return <div style={{ color: "#64748b" }}>טוען...</div>;
    if (entries.length === 0) return <div style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>אין פעולות רשומות על הפלאן הזה עדיין</div>;

    return (
        <div>
            {entries.map(e => (
                <div key={e.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid rgba(255,255,255,.05)", fontSize: "0.8rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>{e.action}</strong>
                        <span style={{ color: "#64748b" }}>{new Date(e.created_at).toLocaleString("he-IL")}</span>
                    </div>
                    <div style={{ color: "#94a3b8" }}>{e.admin_email}</div>
                </div>
            ))}
        </div>
    );
}
