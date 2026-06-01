"use client";
import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

interface Service {
    id: string;
    name: string;
    description?: string;
    duration_minutes: number;
    price_cents: number;
    price_ils: number;
    color: string;
    category?: string;
    is_active: boolean;
    requires_consultation: boolean;
    is_bookable_online: boolean;
    sort_order: number;
    staff_ids: string[];
}

interface StaffMember { id: string; display_name: string; role: string; }

const COLORS = ["#7c3aed","#4f46e5","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#8b5cf6","#14b8a6","#f97316"];

const DURATION_OPTIONS = [15,20,30,45,60,75,90,120,150,180,240,300,360];

function fmt(n: number) { return n.toLocaleString("he-IL", { minimumFractionDigits: 0 }); }
function durLabel(m: number) { return m < 60 ? `${m} דק'` : m % 60 === 0 ? `${m/60} שע'` : `${Math.floor(m/60)}:${String(m%60).padStart(2,"0")} שע'`; }

function ServiceModal({
    service, staff, onClose, onSaved,
}: { service?: Service; staff: StaffMember[]; onClose: () => void; onSaved: () => void }) {
    const isEdit = !!service;
    const [form, setForm] = useState({
        name: service?.name || "",
        description: service?.description || "",
        duration_minutes: service?.duration_minutes || 60,
        price_cents: service?.price_cents || 0,
        color: service?.color || "#7c3aed",
        category: service?.category || "",
        is_active: service?.is_active ?? true,
        requires_consultation: service?.requires_consultation ?? false,
        is_bookable_online: service?.is_bookable_online ?? false,
        staff_ids: service?.staff_ids || [],
    });
    const [saving, setSaving] = useState(false);

    const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

    const save = async () => {
        if (!form.name.trim()) { toast.error("שם שירות חובה"); return; }
        setSaving(true);
        try {
            const body = { ...form };
            if (isEdit) {
                await apiFetch(`/api/services/${service!.id}`, { method: "PUT", body: JSON.stringify(body) });
            } else {
                await apiFetch("/api/services", { method: "POST", body: JSON.stringify(body) });
            }
            onSaved();
            onClose();
        } catch (e: any) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    const toggleStaff = (id: string) =>
        set("staff_ids", form.staff_ids.includes(id)
            ? form.staff_ids.filter(x => x !== id)
            : [...form.staff_ids, id]);

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
            <div style={{ background: "linear-gradient(145deg,#1e1b4b,#312e81)", border: "1px solid rgba(167,139,250,.3)", borderRadius: 20, width: "100%", maxWidth: 560, padding: "2rem", maxHeight: "90vh", overflowY: "auto" }} dir="rtl">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                    <h2 style={{ color: "#a78bfa", fontWeight: 700, fontSize: "1.2rem", margin: 0 }}>
                        {isEdit ? "✏️ עריכת שירות" : "➕ שירות חדש"}
                    </h2>
                    <button onClick={onClose} style={{ background: "rgba(255,255,255,.1)", border: "none", color: "#fff", width: 32, height: 32, borderRadius: 8, cursor: "pointer" }}>✕</button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    {/* Name */}
                    <div style={{ gridColumn: "1/-1" }}>
                        <label style={lStyle}>שם השירות *</label>
                        <input value={form.name} onChange={e => set("name", e.target.value)} style={iStyle} placeholder="לדוגמה: קעקוע קטן" />
                    </div>

                    {/* Duration */}
                    <div>
                        <label style={lStyle}>משך זמן</label>
                        <select value={form.duration_minutes} onChange={e => set("duration_minutes", Number(e.target.value))} style={iStyle}>
                            {DURATION_OPTIONS.map(d => <option key={d} value={d}>{durLabel(d)}</option>)}
                        </select>
                    </div>

                    {/* Price */}
                    <div>
                        <label style={lStyle}>מחיר (₪)</label>
                        <input type="number" min={0} step={10}
                            value={form.price_cents / 100}
                            onChange={e => set("price_cents", Math.round(parseFloat(e.target.value || "0") * 100))}
                            style={iStyle} placeholder="0" />
                    </div>

                    {/* Category */}
                    <div>
                        <label style={lStyle}>קטגוריה</label>
                        <input value={form.category} onChange={e => set("category", e.target.value)} style={iStyle} placeholder="לדוגמה: צבע" />
                    </div>

                    {/* Color */}
                    <div>
                        <label style={lStyle}>צבע ביומן</label>
                        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                            {COLORS.map(c => (
                                <button key={c} onClick={() => set("color", c)} style={{
                                    width: 28, height: 28, borderRadius: "50%", background: c, border: form.color === c ? "3px solid #fff" : "2px solid transparent", cursor: "pointer",
                                }} />
                            ))}
                        </div>
                    </div>

                    {/* Description */}
                    <div style={{ gridColumn: "1/-1" }}>
                        <label style={lStyle}>תיאור (אופציונלי)</label>
                        <textarea value={form.description} onChange={e => set("description", e.target.value)} style={{ ...iStyle, minHeight: 70, resize: "vertical" }} placeholder="תיאור קצר של השירות..." />
                    </div>

                    {/* Toggles */}
                    <div style={{ gridColumn: "1/-1", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                        {[
                            { key: "is_active", label: "פעיל" },
                            { key: "is_bookable_online", label: "ניתן לקביעה אונליין" },
                            { key: "requires_consultation", label: "דורש ייעוץ קודם" },
                        ].map(({ key, label }) => (
                            <label key={key} style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", color: "#94a3b8", fontSize: "0.85rem" }}>
                                <input type="checkbox" checked={(form as any)[key]} onChange={e => set(key, e.target.checked)} />
                                {label}
                            </label>
                        ))}
                    </div>

                    {/* Staff */}
                    {staff.length > 0 && (
                        <div style={{ gridColumn: "1/-1" }}>
                            <label style={lStyle}>עובדים שמבצעים שירות זה</label>
                            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                                {staff.map(m => (
                                    <button key={m.id} onClick={() => toggleStaff(m.id)} style={{
                                        padding: "0.3rem 0.8rem", borderRadius: 20, border: "1px solid",
                                        borderColor: form.staff_ids.includes(m.id) ? "#a78bfa" : "rgba(255,255,255,.15)",
                                        background: form.staff_ids.includes(m.id) ? "rgba(167,139,250,.2)" : "transparent",
                                        color: form.staff_ids.includes(m.id) ? "#a78bfa" : "#94a3b8",
                                        cursor: "pointer", fontSize: "0.8rem",
                                    }}>
                                        {m.display_name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
                    <button onClick={onClose} style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 12, color: "#fff", padding: "0.65rem 1.2rem", cursor: "pointer" }}>ביטול</button>
                    <button onClick={save} disabled={saving} style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 12, color: "#fff", padding: "0.65rem 1.4rem", fontWeight: 600, cursor: "pointer", opacity: saving ? .6 : 1 }}>
                        {saving ? "שומר..." : isEdit ? "💾 שמור שינויים" : "➕ צור שירות"}
                    </button>
                </div>
            </div>
        </div>
    );
}

const lStyle: React.CSSProperties = { color: "#94a3b8", fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: "0.35rem" };
const iStyle: React.CSSProperties = { background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.6rem 0.9rem", color: "#fff", fontSize: "0.9rem", width: "100%", boxSizing: "border-box" };

export default function ServicesPage() {
    const [services, setServices] = useState<Service[]>([]);
    const [staff, setStaff] = useState<StaffMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState<"new" | Service | null>(null);
    const [seeding, setSeeding] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [svcs, staffData] = await Promise.all([
                apiFetch<Service[]>("/api/services?active_only=false"),
                apiFetch<StaffMember[]>("/api/artists"),
            ]);
            setServices(svcs);
            setStaff(staffData);
        } catch { }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const deleteService = async (id: string) => {
        if (!confirm("למחוק שירות זה?")) return;
        await apiFetch(`/api/services/${id}`, { method: "DELETE" });
        load();
    };

    const seedFromTemplate = async () => {
        if (!confirm("לטעון שירותי ברירת מחדל לפי סוג העסק?")) return;
        setSeeding(true);
        try {
            const res = await apiFetch<{ created: string[] }>("/api/services/seed-from-template", { method: "POST" });
            toast.success(`נוצרו ${res.created.length} שירותים`);
            load();
        } catch (e: any) { toast.error(e.message); }
        finally { setSeeding(false); }
    };

    const grouped = services.reduce((acc, s) => {
        const cat = s.category || "כללי";
        (acc[cat] = acc[cat] || []).push(s);
        return acc;
    }, {} as Record<string, Service[]>);

    return (
        <RequireAuth>
            <AppShell title="שירותים">
                <div dir="rtl" style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)", padding: "2rem", color: "#fff", fontFamily: "sans-serif" }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
                        <div>
                            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, background: "linear-gradient(135deg,#a78bfa,#60a5fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>
                                🛎️ קטלוג שירותים
                            </h1>
                            <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginTop: "0.3rem" }}>
                                הגדר שירותים, משכי זמן ומחירים לסטודיו שלך
                            </p>
                        </div>
                        <div style={{ display: "flex", gap: "0.75rem" }}>
                            {services.length === 0 && (
                                <button onClick={seedFromTemplate} disabled={seeding} style={{ background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 12, color: "#34d399", padding: "0.65rem 1.2rem", cursor: "pointer", fontSize: "0.9rem" }}>
                                    {seeding ? "טוען..." : "⚡ טען ברירות מחדל"}
                                </button>
                            )}
                            <button onClick={() => setModal("new")} style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 12, color: "#fff", padding: "0.65rem 1.4rem", fontWeight: 600, cursor: "pointer" }}>
                                ➕ שירות חדש
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>⏳ טוען...</div>
                    ) : services.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "4rem", background: "rgba(255,255,255,.04)", borderRadius: 20, border: "1px solid rgba(255,255,255,.08)" }}>
                            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🛎️</div>
                            <div style={{ color: "#94a3b8", marginBottom: "0.5rem" }}>אין שירותים עדיין</div>
                            <div style={{ color: "#64748b", fontSize: "0.85rem" }}>לחץ "טען ברירות מחדל" לטעינה מהירה לפי סוג העסק, או צור שירות ידנית</div>
                        </div>
                    ) : (
                        Object.entries(grouped).map(([cat, svcs]) => (
                            <div key={cat} style={{ marginBottom: "2rem" }}>
                                <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.75rem", paddingRight: "0.5rem", borderRight: "3px solid #7c3aed" }}>
                                    {cat}
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "1rem" }}>
                                    {svcs.sort((a, b) => a.sort_order - b.sort_order).map(svc => (
                                        <div key={svc.id} style={{ background: "rgba(255,255,255,.05)", border: `1px solid ${svc.color}44`, borderRadius: 16, padding: "1.25rem", position: "relative", opacity: svc.is_active ? 1 : 0.55 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
                                                <div style={{ width: 14, height: 14, borderRadius: "50%", background: svc.color, flexShrink: 0 }} />
                                                <span style={{ fontWeight: 700, fontSize: "1rem" }}>{svc.name}</span>
                                                {!svc.is_active && <span style={{ background: "rgba(100,116,139,.2)", color: "#64748b", fontSize: "0.7rem", padding: "0.1rem 0.5rem", borderRadius: 8 }}>כבוי</span>}
                                            </div>
                                            <div style={{ display: "flex", gap: "1rem", fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.75rem" }}>
                                                <span>⏱️ {durLabel(svc.duration_minutes)}</span>
                                                <span>₪{fmt(svc.price_ils)}</span>
                                            </div>
                                            {svc.description && <div style={{ color: "#64748b", fontSize: "0.8rem", marginBottom: "0.5rem" }}>{svc.description}</div>}
                                            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                                                {svc.is_bookable_online && <span style={{ background: "rgba(16,185,129,.15)", color: "#34d399", fontSize: "0.7rem", padding: "0.1rem 0.5rem", borderRadius: 8 }}>🌐 אונליין</span>}
                                                {svc.requires_consultation && <span style={{ background: "rgba(245,158,11,.15)", color: "#fbbf24", fontSize: "0.7rem", padding: "0.1rem 0.5rem", borderRadius: 8 }}>📋 ייעוץ</span>}
                                            </div>
                                            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                                                <button onClick={() => setModal(svc)} style={{ background: "rgba(167,139,250,.15)", border: "none", borderRadius: 8, color: "#a78bfa", padding: "0.3rem 0.8rem", cursor: "pointer", fontSize: "0.8rem" }}>✏️ עריכה</button>
                                                <button onClick={() => deleteService(svc.id)} style={{ background: "rgba(239,68,68,.15)", border: "none", borderRadius: 8, color: "#f87171", padding: "0.3rem 0.8rem", cursor: "pointer", fontSize: "0.8rem" }}>🗑️</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}

                    {modal && (
                        <ServiceModal
                            service={modal === "new" ? undefined : modal}
                            staff={staff}
                            onClose={() => setModal(null)}
                            onSaved={load}
                        />
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
