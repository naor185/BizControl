"use client";
import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TriggerEvent { id: string; label: string; icon: string; }
interface ActionType { id: string; label: string; icon: string; has_template: boolean; has_delay?: boolean; has_amount?: boolean; has_discount?: boolean; }
interface Meta { trigger_events: TriggerEvent[]; action_types: ActionType[]; template_variables: string[]; }
interface Service { id: string; name: string; color: string; }
interface Action { type: string; template?: string; delay_minutes?: number; amount?: number; discount_percent?: number; }
interface Rule { id: string; name: string; is_active: boolean; trigger_event: string; trigger_conditions: Record<string, string>; actions: Action[]; sort_order: number; }
interface Execution { id: string; status: string; error: string | null; executed_at: string; }

const APPT_TRIGGERS = new Set(["appointment_done", "appointment_created", "appointment_canceled", "payment_received", "deposit_paid"]);

const DEFAULT_TEMPLATES: Record<string, string> = {
    send_whatsapp: "שלום {client_name}! 🙏\n\n",
    send_aftercare: "שלום {client_name}! 💊\n\nהוראות טיפול:\n",
    send_email: "שלום {client_name},\n\n",
};

const lStyle: React.CSSProperties = { color: "#94a3b8", fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: "0.35rem" };
const iStyle: React.CSSProperties = { background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.6rem 0.9rem", color: "#fff", fontSize: "0.9rem", width: "100%", boxSizing: "border-box" };

// ── Execution History Modal ───────────────────────────────────────────────────
function ExecHistoryModal({ ruleId, ruleName, onClose }: { ruleId: string; ruleName: string; onClose: () => void }) {
    const [execs, setExecs] = useState<Execution[] | null>(null);

    useEffect(() => {
        apiFetch<Execution[]>(`/api/automation-rules/${ruleId}/executions`)
            .then(setExecs).catch(() => setExecs([]));
    }, [ruleId]);

    const fmtDate = (iso: string) => new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
    const okCount = execs?.filter(e => e.status === "ok").length || 0;
    const errCount = execs?.filter(e => e.status === "error").length || 0;

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: "1rem" }}>
            <div style={{ background: "linear-gradient(145deg,#0f172a,#1e1b4b)", border: "1px solid rgba(167,139,250,.4)", borderRadius: 24, width: "100%", maxWidth: 600, padding: "2rem", maxHeight: "85vh", display: "flex", flexDirection: "column" }} dir="rtl">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                    <div>
                        <h2 style={{ color: "#a78bfa", fontWeight: 800, fontSize: "1.2rem", margin: 0 }}>📊 היסטוריית הפעלות</h2>
                        <div style={{ color: "#64748b", fontSize: "0.82rem", marginTop: "0.25rem" }}>{ruleName}</div>
                    </div>
                    <button onClick={onClose} style={{ background: "rgba(255,255,255,.1)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: 10, cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
                </div>

                {execs && execs.length > 0 && (
                    <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
                        <div style={{ background: "rgba(74,222,128,.1)", border: "1px solid rgba(74,222,128,.2)", borderRadius: 10, padding: "0.5rem 1rem", textAlign: "center" }}>
                            <div style={{ color: "#4ade80", fontWeight: 800, fontSize: "1.3rem" }}>{okCount}</div>
                            <div style={{ color: "#64748b", fontSize: "0.75rem" }}>הצלחות</div>
                        </div>
                        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10, padding: "0.5rem 1rem", textAlign: "center" }}>
                            <div style={{ color: "#f87171", fontWeight: 800, fontSize: "1.3rem" }}>{errCount}</div>
                            <div style={{ color: "#64748b", fontSize: "0.75rem" }}>שגיאות</div>
                        </div>
                        <div style={{ background: "rgba(167,139,250,.1)", border: "1px solid rgba(167,139,250,.2)", borderRadius: 10, padding: "0.5rem 1rem", textAlign: "center" }}>
                            <div style={{ color: "#a78bfa", fontWeight: 800, fontSize: "1.3rem" }}>{execs.length}</div>
                            <div style={{ color: "#64748b", fontSize: "0.75rem" }}>סה&quot;כ</div>
                        </div>
                    </div>
                )}

                <div style={{ flex: 1, overflowY: "auto" }}>
                    {!execs ? (
                        <div style={{ textAlign: "center", color: "#64748b", padding: "2rem" }}>⏳ טוען...</div>
                    ) : execs.length === 0 ? (
                        <div style={{ textAlign: "center", color: "#64748b", padding: "2rem" }}>
                            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📭</div>
                            <div>החוק עדיין לא הופעל</div>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {execs.map(e => (
                                <div key={e.id} style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${e.status === "ok" ? "rgba(74,222,128,.2)" : "rgba(239,68,68,.2)"}`, borderRadius: 10, padding: "0.65rem 1rem", display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                                    <span style={{ fontSize: "1rem" }}>{e.status === "ok" ? "✅" : "❌"}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ color: e.status === "ok" ? "#4ade80" : "#f87171", fontSize: "0.82rem", fontWeight: 600 }}>
                                            {e.status === "ok" ? "הצליח" : "נכשל"}
                                        </div>
                                        {e.error && <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.2rem", fontFamily: "monospace" }}>{e.error}</div>}
                                    </div>
                                    <div style={{ color: "#475569", fontSize: "0.75rem", whiteSpace: "nowrap" }}>{fmtDate(e.executed_at)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Action Editor ─────────────────────────────────────────────────────────────
function ActionEditor({ action, meta, onChange, onRemove, onMoveUp, onMoveDown, isFirst, isLast }: {
    action: Action; meta: Meta;
    onChange: (a: Action) => void; onRemove: () => void;
    onMoveUp: () => void; onMoveDown: () => void;
    isFirst: boolean; isLast: boolean;
}) {
    const def = meta.action_types.find(a => a.id === action.type);
    return (
        <div style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
                    <span style={{ fontSize: "1.2rem" }}>{def?.icon || "⚡"}</span>
                    <select value={action.type} onChange={e => onChange({ type: e.target.value, template: DEFAULT_TEMPLATES[e.target.value] || "" })}
                        style={iStyle}>
                        {meta.action_types.map(a => (
                            <option key={a.id} value={a.id}>{a.icon} {a.label}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: "flex", gap: "0.3rem", marginRight: "0.5rem" }}>
                    <button onClick={onMoveUp} disabled={isFirst} title="הזז למעלה"
                        style={{ background: "rgba(255,255,255,.08)", border: "none", borderRadius: 6, color: isFirst ? "#334155" : "#94a3b8", padding: "0.25rem 0.5rem", cursor: isFirst ? "default" : "pointer", fontSize: "0.75rem" }}>↑</button>
                    <button onClick={onMoveDown} disabled={isLast} title="הזז למטה"
                        style={{ background: "rgba(255,255,255,.08)", border: "none", borderRadius: 6, color: isLast ? "#334155" : "#94a3b8", padding: "0.25rem 0.5rem", cursor: isLast ? "default" : "pointer", fontSize: "0.75rem" }}>↓</button>
                    <button onClick={onRemove} style={{ background: "rgba(239,68,68,.2)", border: "none", borderRadius: 8, color: "#f87171", padding: "0.25rem 0.6rem", cursor: "pointer" }}>✕</button>
                </div>
            </div>

            {def?.has_template && (
                <div>
                    <label style={lStyle}>תוכן ההודעה</label>
                    <textarea
                        value={action.template || ""}
                        onChange={e => onChange({ ...action, template: e.target.value })}
                        rows={3}
                        style={{ ...iStyle, resize: "vertical", fontFamily: "monospace", fontSize: "0.85rem" }}
                        placeholder="שלום {client_name}! 🙏"
                    />
                    <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: "0.25rem" }}>
                        משתנים: {"{client_name}"} {"{service_name}"} {"{appointment_date}"} {"{appointment_time}"}
                    </div>
                </div>
            )}
            {def?.has_amount && (
                <div>
                    <label style={lStyle}>כמות נקודות</label>
                    <input type="number" min={1} value={action.amount || 50}
                        onChange={e => onChange({ ...action, amount: parseInt(e.target.value) })}
                        style={{ ...iStyle, width: 100 }} />
                </div>
            )}
            {def?.has_discount && (
                <div>
                    <label style={lStyle}>אחוז הנחה (%)</label>
                    <input type="number" min={1} max={100} value={action.discount_percent || 10}
                        onChange={e => onChange({ ...action, discount_percent: parseInt(e.target.value) })}
                        style={{ ...iStyle, width: 100 }} />
                </div>
            )}
            {def?.has_delay && (
                <div>
                    <label style={lStyle}>עיכוב שליחה (דקות)</label>
                    <input type="number" min={0} step={5} value={action.delay_minutes || 0}
                        onChange={e => onChange({ ...action, delay_minutes: parseInt(e.target.value) })}
                        style={{ ...iStyle, width: 120 }} />
                </div>
            )}
        </div>
    );
}

// ── Rule Builder Modal ─────────────────────────────────────────────────────────
function RuleModal({ rule, meta, services, onClose, onSaved }: {
    rule?: Rule; meta: Meta; services: Service[]; onClose: () => void; onSaved: () => void;
}) {
    const isEdit = !!rule?.id;
    const [name, setName] = useState(rule?.name || "");
    const [trigger, setTrigger] = useState(rule?.trigger_event || meta.trigger_events[0]?.id || "");
    const [condServiceId, setCondServiceId] = useState(rule?.trigger_conditions?.service_id || "");
    const [actions, setActions] = useState<Action[]>(rule?.actions || []);
    const [saving, setSaving] = useState(false);

    const addAction = (type: string) => setActions(a => [...a, { type, template: DEFAULT_TEMPLATES[type] || "", delay_minutes: 0 }]);
    const updateAction = (i: number, a: Action) => setActions(prev => prev.map((x, idx) => idx === i ? a : x));
    const removeAction = (i: number) => setActions(prev => prev.filter((_, idx) => idx !== i));
    const moveAction = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= actions.length) return;
        setActions(prev => { const a = [...prev]; [a[i], a[j]] = [a[j], a[i]]; return a; });
    };

    const save = async () => {
        if (!name.trim()) { toast.error("שם חובה"); return; }
        if (actions.length === 0) { toast.error("יש להוסיף לפחות פעולה אחת"); return; }
        setSaving(true);
        try {
            const trigger_conditions: Record<string, string> = {};
            if (condServiceId) trigger_conditions.service_id = condServiceId;
            const body = { name, trigger_event: trigger, trigger_conditions, actions, is_active: true };
            if (isEdit) await apiFetch(`/api/automation-rules/${rule!.id}`, { method: "PUT", body: JSON.stringify(body) });
            else await apiFetch("/api/automation-rules", { method: "POST", body: JSON.stringify(body) });
            onSaved(); onClose();
        } catch (e: any) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    const triggerDef = meta.trigger_events.find(t => t.id === trigger);
    const showServiceFilter = APPT_TRIGGERS.has(trigger) && services.length > 0;

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
            <div style={{ background: "linear-gradient(145deg,#0f172a,#1e1b4b)", border: "1px solid rgba(167,139,250,.4)", borderRadius: 24, width: "100%", maxWidth: 640, padding: "2rem", maxHeight: "90vh", overflowY: "auto" }} dir="rtl">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                    <h2 style={{ color: "#a78bfa", fontWeight: 800, fontSize: "1.3rem", margin: 0 }}>
                        {isEdit ? "✏️ עריכת חוק" : "⚡ חוק אוטומציה חדש"}
                    </h2>
                    <button onClick={onClose} style={{ background: "rgba(255,255,255,.1)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: 10, cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
                </div>

                {/* Rule name */}
                <div style={{ marginBottom: "1.5rem" }}>
                    <label style={lStyle}>שם החוק</label>
                    <input value={name} onChange={e => setName(e.target.value)} style={iStyle} placeholder='לדוגמה: "שלח הוראות טיפול אחרי תור"' />
                </div>

                {/* WHEN */}
                <div style={{ background: "rgba(74,222,128,.06)", border: "1px solid rgba(74,222,128,.2)", borderRadius: 16, padding: "1.25rem", marginBottom: "1.5rem" }}>
                    <div style={{ color: "#4ade80", fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem" }}>
                        🔔 WHEN — מתי להפעיל?
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                        {meta.trigger_events.map(t => (
                            <button key={t.id} onClick={() => { setTrigger(t.id); setCondServiceId(""); }}
                                style={{
                                    padding: "0.5rem 1rem", borderRadius: 12, cursor: "pointer",
                                    border: `1px solid ${trigger === t.id ? "#4ade80" : "rgba(255,255,255,.15)"}`,
                                    background: trigger === t.id ? "rgba(74,222,128,.2)" : "rgba(255,255,255,.04)",
                                    color: trigger === t.id ? "#4ade80" : "#94a3b8",
                                    fontSize: "0.85rem", fontWeight: 600,
                                }}>
                                {t.icon} {t.label}
                            </button>
                        ))}
                    </div>
                    {triggerDef && (
                        <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.75rem" }}>
                            אירוע: <strong style={{ color: "#4ade80" }}>{triggerDef.icon} {triggerDef.label}</strong>
                        </div>
                    )}

                    {/* Trigger Conditions — service filter */}
                    {showServiceFilter && (
                        <div style={{ marginTop: "1rem", borderTop: "1px solid rgba(74,222,128,.15)", paddingTop: "1rem" }}>
                            <label style={{ ...lStyle, color: "#4ade80" }}>🎯 סינון לפי שירות (אופציונלי)</label>
                            <select value={condServiceId} onChange={e => setCondServiceId(e.target.value)}
                                style={iStyle}>
                                <option value="">כל השירותים</option>
                                {services.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: "0.25rem" }}>
                                {condServiceId ? `החוק יופעל רק לתורים עם שירות זה` : "החוק יופעל לכל התורים ללא קשר לשירות"}
                            </div>
                        </div>
                    )}
                </div>

                {/* THEN */}
                <div style={{ background: "rgba(167,139,250,.06)", border: "1px solid rgba(167,139,250,.2)", borderRadius: 16, padding: "1.25rem", marginBottom: "1.5rem" }}>
                    <div style={{ color: "#a78bfa", fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem" }}>
                        ⚡ THEN — מה לעשות?
                    </div>

                    {actions.map((a, i) => (
                        <div key={i} style={{ marginBottom: "0.75rem" }}>
                            {i > 0 && <div style={{ color: "#475569", fontSize: "0.75rem", margin: "0.5rem 0", textAlign: "center" }}>ואז גם...</div>}
                            <ActionEditor
                                action={a} meta={meta}
                                onChange={updated => updateAction(i, updated)}
                                onRemove={() => removeAction(i)}
                                onMoveUp={() => moveAction(i, -1)}
                                onMoveDown={() => moveAction(i, 1)}
                                isFirst={i === 0}
                                isLast={i === actions.length - 1}
                            />
                        </div>
                    ))}

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
                        {meta.action_types.map(at => (
                            <button key={at.id} onClick={() => addAction(at.id)}
                                style={{ padding: "0.4rem 0.8rem", borderRadius: 10, border: "1px dashed rgba(167,139,250,.4)", background: "transparent", color: "#a78bfa", cursor: "pointer", fontSize: "0.8rem" }}>
                                + {at.icon} {at.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                    <button onClick={onClose} style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, color: "#fff", padding: "0.65rem 1.2rem", cursor: "pointer" }}>ביטול</button>
                    <button onClick={save} disabled={saving} style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 12, color: "#fff", padding: "0.65rem 1.5rem", fontWeight: 700, cursor: "pointer", opacity: saving ? .6 : 1 }}>
                        {saving ? "שומר..." : isEdit ? "💾 שמור" : "⚡ צור חוק"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AutomationsPage() {
    const [rules, setRules] = useState<Rule[]>([]);
    const [meta, setMeta] = useState<Meta | null>(null);
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState<"new" | Rule | null>(null);
    const [execModal, setExecModal] = useState<{ ruleId: string; ruleName: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [r, m, svcs] = await Promise.all([
                apiFetch<Rule[]>("/api/automation-rules"),
                apiFetch<Meta>("/api/automation-rules/meta"),
                apiFetch<Service[]>("/api/services?active_only=true").catch(() => []),
            ]);
            setRules(r);
            setMeta(m);
            setServices(svcs);
        } catch { }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleRule = async (rule: Rule) => {
        await apiFetch(`/api/automation-rules/${rule.id}`, {
            method: "PUT",
            body: JSON.stringify({ is_active: !rule.is_active }),
        });
        load();
    };

    const deleteRule = async (id: string) => {
        if (!confirm("למחוק חוק זה?")) return;
        await apiFetch(`/api/automation-rules/${id}`, { method: "DELETE" });
        load();
    };

    const duplicateRule = async (rule: Rule) => {
        await apiFetch("/api/automation-rules", {
            method: "POST",
            body: JSON.stringify({
                name: `${rule.name} (עותק)`,
                trigger_event: rule.trigger_event,
                trigger_conditions: rule.trigger_conditions,
                actions: rule.actions,
                is_active: false,
            }),
        });
        load();
    };

    const groupedByTrigger = rules.reduce((acc, r) => {
        (acc[r.trigger_event] = acc[r.trigger_event] || []).push(r);
        return acc;
    }, {} as Record<string, Rule[]>);

    const getTriggerLabel = (id: string) =>
        meta?.trigger_events.find(t => t.id === id) || { icon: "⚡", label: id };

    const getActionLabel = (type: string) =>
        meta?.action_types.find(a => a.id === type) || { icon: "⚡", label: type };

    const getServiceName = (id?: string) =>
        id ? (services.find(s => s.id === id)?.name || id) : null;

    return (
        <RequireAuth>
            <AppShell title="אוטומציות">
                <div dir="rtl" style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)", padding: "2rem", color: "#fff", fontFamily: "sans-serif" }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
                        <div>
                            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, background: "linear-gradient(135deg,#a78bfa,#4ade80)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>
                                ⚡ בונה אוטומציות
                            </h1>
                            <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginTop: "0.3rem" }}>
                                WHEN [אירוע] → THEN [פעולות] · כל אחד ב-30 שניות
                            </p>
                        </div>
                        {meta && (
                            <button onClick={() => setModal("new")} style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 12, color: "#fff", padding: "0.7rem 1.5rem", fontWeight: 700, cursor: "pointer", fontSize: "0.95rem" }}>
                                ⚡ חוק חדש
                            </button>
                        )}
                    </div>

                    {loading ? (
                        <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>⏳ טוען...</div>
                    ) : rules.length === 0 ? (
                        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 20, padding: "4rem", textAlign: "center" }}>
                            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚡</div>
                            <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.5rem" }}>אין חוקי אוטומציה עדיין</div>
                            <div style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
                                צור חוק ראשון — לדוגמה: &quot;כשתור מסתיים → שלח הוראות טיפול&quot;
                            </div>
                            {meta && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
                                    {[
                                        { name: "הוראות טיפול אחרי תור", trigger: "appointment_done", actions: [{ type: "send_aftercare", delay_minutes: 0, template: "שלום {client_name}! 💊\n\nאחרי הביקור:\n• שמור על אזור הטיפול נקי\n• אל תרטיב 24 שעות\n\nתודה! 🙏" }, { type: "request_review", delay_minutes: 30 }] },
                                        { name: "ברכת יום הולדת", trigger: "client_birthday", actions: [{ type: "send_whatsapp", template: "שלום {client_name}! 🎂🎉\n\nיום הולדת שמח!\nמחכה לך מתנה מיוחדת אצלנו 🎁" }, { type: "generate_coupon", discount_percent: 15 }] },
                                        { name: "תודה על תשלום", trigger: "payment_received", actions: [{ type: "send_whatsapp", template: "שלום {client_name}! ✅\n\nתודה על התשלום!\nשמחים שבחרת בנו ❤️" }, { type: "add_points", amount: 50 }] },
                                    ].map(preset => (
                                        <button key={preset.name} onClick={() => {
                                            if (meta) setModal({ id: "", name: preset.name, is_active: true, trigger_event: preset.trigger, trigger_conditions: {}, actions: preset.actions as Action[], sort_order: 0 } as Rule);
                                        }} style={{ background: "rgba(167,139,250,.1)", border: "1px solid rgba(167,139,250,.3)", borderRadius: 12, color: "#a78bfa", padding: "0.6rem 1.1rem", cursor: "pointer", fontSize: "0.85rem" }}>
                                            ⚡ {preset.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        Object.entries(groupedByTrigger).map(([trigger, triggerRules]) => {
                            const tDef = getTriggerLabel(trigger);
                            return (
                                <div key={trigger} style={{ marginBottom: "2rem" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                                        <span style={{ fontSize: "1.1rem" }}>{tDef.icon}</span>
                                        <span style={{ color: "#4ade80", fontWeight: 700 }}>WHEN: {tDef.label}</span>
                                        <span style={{ color: "#475569", fontSize: "0.8rem" }}>({triggerRules.length} חוקים)</span>
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                                        {triggerRules.map(rule => {
                                            const svcName = getServiceName(rule.trigger_conditions?.service_id);
                                            return (
                                                <div key={rule.id} style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${rule.is_active ? "rgba(167,139,250,.25)" : "rgba(100,116,139,.2)"}`, borderRadius: 16, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", opacity: rule.is_active ? 1 : 0.6 }}>
                                                    <div style={{ flex: 1, minWidth: 200 }}>
                                                        <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>{rule.name}</div>
                                                        {svcName && (
                                                            <div style={{ color: "#4ade80", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                                                                🎯 רק לשירות: {svcName}
                                                            </div>
                                                        )}
                                                        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                                                            {rule.actions.map((a, i) => {
                                                                const aDef = getActionLabel(a.type);
                                                                return (
                                                                    <span key={i} style={{ background: "rgba(167,139,250,.12)", color: "#a78bfa", fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: 8, fontWeight: 600 }}>
                                                                        {aDef.icon} {aDef.label}{a.delay_minutes ? ` (${a.delay_minutes}ד)` : ""}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                                                        <button onClick={() => toggleRule(rule)} style={{
                                                            padding: "0.3rem 0.9rem", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem",
                                                            background: rule.is_active ? "rgba(74,222,128,.15)" : "rgba(100,116,139,.15)",
                                                            color: rule.is_active ? "#4ade80" : "#64748b",
                                                        }}>
                                                            {rule.is_active ? "✅ פעיל" : "❌ כבוי"}
                                                        </button>
                                                        <button onClick={() => setExecModal({ ruleId: rule.id, ruleName: rule.name })}
                                                            title="היסטוריית הפעלות"
                                                            style={{ background: "rgba(96,165,250,.15)", border: "none", borderRadius: 8, color: "#60a5fa", padding: "0.3rem 0.7rem", cursor: "pointer", fontSize: "0.8rem" }}>📊</button>
                                                        <button onClick={() => duplicateRule(rule)}
                                                            title="שכפל חוק"
                                                            style={{ background: "rgba(255,255,255,.08)", border: "none", borderRadius: 8, color: "#94a3b8", padding: "0.3rem 0.7rem", cursor: "pointer", fontSize: "0.8rem" }}>⎘</button>
                                                        <button onClick={() => setModal(rule)} style={{ background: "rgba(167,139,250,.15)", border: "none", borderRadius: 8, color: "#a78bfa", padding: "0.3rem 0.7rem", cursor: "pointer", fontSize: "0.8rem" }}>✏️</button>
                                                        <button onClick={() => deleteRule(rule.id)} style={{ background: "rgba(239,68,68,.15)", border: "none", borderRadius: 8, color: "#f87171", padding: "0.3rem 0.7rem", cursor: "pointer", fontSize: "0.8rem" }}>🗑️</button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })
                    )}

                    {meta && modal && (
                        <RuleModal
                            rule={modal === "new" ? undefined : modal.id ? modal : undefined}
                            meta={meta}
                            services={services}
                            onClose={() => setModal(null)}
                            onSaved={load}
                        />
                    )}

                    {execModal && (
                        <ExecHistoryModal
                            ruleId={execModal.ruleId}
                            ruleName={execModal.ruleName}
                            onClose={() => setExecModal(null)}
                        />
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
