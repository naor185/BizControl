"use client";
import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

interface WaitEntry {
    id: string;
    client_name?: string;
    client_phone?: string;
    service_id?: string;
    notes?: string;
    status: string;
    notified_at?: string;
    created_at: string;
}

interface Service { id: string; name: string; color: string; }
interface Client { id: string; full_name: string; phone: string; }

export default function WaitListPage() {
    const [entries, setEntries] = useState<WaitEntry[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ client_name: "", client_phone: "", service_id: "", notes: "" });
    const [saving, setSaving] = useState(false);
    const [notifying, setNotifying] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [e, s] = await Promise.all([
                apiFetch<WaitEntry[]>("/api/wait-list"),
                apiFetch<Service[]>("/api/services?active_only=true"),
            ]);
            setEntries(e);
            setServices(s);
        } catch { }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const add = async () => {
        if (!form.client_name || !form.client_phone) { toast.error("שם ומספר טלפון חובה"); return; }
        setSaving(true);
        try {
            await apiFetch("/api/wait-list", { method: "POST", body: JSON.stringify(form) });
            setForm({ client_name: "", client_phone: "", service_id: "", notes: "" });
            setShowAdd(false);
            load();
            toast.success("נוסף לרשימת ההמתנה");
        } catch (e: any) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    const notify = async (id: string) => {
        setNotifying(id);
        try {
            await apiFetch(`/api/wait-list/${id}/notify`, { method: "POST" });
            load();
            toast.success("הודעה נשלחה!");
        } catch (e: any) { toast.error(e.message); }
        finally { setNotifying(null); }
    };

    const confirm = async (id: string) => {
        await apiFetch(`/api/wait-list/${id}/confirm`, { method: "POST" });
        load();
    };

    const remove = async (id: string) => {
        if (!confirm("להסיר מהרשימה?")) return;
        await apiFetch(`/api/wait-list/${id}`, { method: "DELETE" });
        load();
    };

    const getService = (id?: string) => services.find(s => s.id === id);

    const statusColor: Record<string, string> = {
        waiting:   "#fbbf24",
        notified:  "#60a5fa",
        confirmed: "#4ade80",
        canceled:  "#64748b",
    };
    const statusLabel: Record<string, string> = {
        waiting:   "⏳ ממתין",
        notified:  "📨 הודע",
        confirmed: "✅ אושר",
        canceled:  "❌ בוטל",
    };

    return (
        <RequireAuth>
            <AppShell title="רשימת המתנה">
                <div dir="rtl" style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)", padding: "2rem", color: "#fff", fontFamily: "sans-serif" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
                        <div>
                            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, background: "linear-gradient(135deg,#a78bfa,#60a5fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>
                                ⏳ רשימת המתנה
                            </h1>
                            <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginTop: "0.3rem" }}>
                                {entries.length} ממתינים · מקבלים הודעה אוטומטית כשתור מתפנה
                            </p>
                        </div>
                        <button onClick={() => setShowAdd(!showAdd)} style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 12, color: "#fff", padding: "0.7rem 1.4rem", fontWeight: 700, cursor: "pointer" }}>
                            ➕ הוסף לרשימה
                        </button>
                    </div>

                    {showAdd && (
                        <div style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(167,139,250,.3)", borderRadius: 16, padding: "1.5rem", marginBottom: "2rem" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                                <div>
                                    <label style={lStyle}>שם לקוח *</label>
                                    <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} style={iStyle} placeholder="ישראל ישראלי" />
                                </div>
                                <div>
                                    <label style={lStyle}>טלפון *</label>
                                    <input value={form.client_phone} onChange={e => setForm(f => ({ ...f, client_phone: e.target.value }))} style={iStyle} placeholder="050-0000000" />
                                </div>
                                <div>
                                    <label style={lStyle}>שירות מבוקש</label>
                                    <select value={form.service_id} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))} style={iStyle}>
                                        <option value="">כל שירות</option>
                                        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={lStyle}>הערות</label>
                                    <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={iStyle} placeholder="גמישות בזמנים..." />
                                </div>
                            </div>
                            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                                <button onClick={() => setShowAdd(false)} style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 10, color: "#fff", padding: "0.6rem 1.2rem", cursor: "pointer" }}>ביטול</button>
                                <button onClick={add} disabled={saving} style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 10, color: "#fff", padding: "0.6rem 1.4rem", fontWeight: 600, cursor: "pointer" }}>
                                    {saving ? "שומר..." : "➕ הוסף"}
                                </button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>⏳ טוען...</div>
                    ) : entries.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "4rem", background: "rgba(255,255,255,.04)", borderRadius: 20, border: "1px solid rgba(255,255,255,.08)" }}>
                            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⏳</div>
                            <div style={{ color: "#94a3b8" }}>רשימת ההמתנה ריקה</div>
                            <div style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "0.25rem" }}>כשתור מבוטל — הלקוחות ברשימה מקבלים הודעה אוטומטית</div>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            {entries.map(entry => {
                                const svc = getService(entry.service_id);
                                return (
                                    <div key={entry.id} style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                                        <div style={{ flex: 1, minWidth: 200 }}>
                                            <div style={{ fontWeight: 700, marginBottom: "0.2rem" }}>{entry.client_name}</div>
                                            <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{entry.client_phone}</div>
                                            {svc && <div style={{ marginTop: "0.3rem" }}><span style={{ background: `${svc.color}22`, color: svc.color, fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: 8 }}>{svc.name}</span></div>}
                                            {entry.notes && <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.25rem" }}>{entry.notes}</div>}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                            <span style={{ background: `${statusColor[entry.status]}20`, color: statusColor[entry.status], fontSize: "0.78rem", padding: "0.2rem 0.7rem", borderRadius: 20, fontWeight: 600 }}>
                                                {statusLabel[entry.status] || entry.status}
                                            </span>
                                            {entry.status === "waiting" && (
                                                <button onClick={() => notify(entry.id)} disabled={notifying === entry.id} style={{ background: "rgba(96,165,250,.15)", border: "none", borderRadius: 8, color: "#60a5fa", padding: "0.3rem 0.8rem", cursor: "pointer", fontSize: "0.8rem" }}>
                                                    {notifying === entry.id ? "..." : "📨 הודע"}
                                                </button>
                                            )}
                                            {entry.status === "notified" && (
                                                <button onClick={() => confirm(entry.id)} style={{ background: "rgba(74,222,128,.15)", border: "none", borderRadius: 8, color: "#4ade80", padding: "0.3rem 0.8rem", cursor: "pointer", fontSize: "0.8rem" }}>
                                                    ✅ אשר
                                                </button>
                                            )}
                                            <button onClick={() => remove(entry.id)} style={{ background: "rgba(239,68,68,.15)", border: "none", borderRadius: 8, color: "#f87171", padding: "0.3rem 0.6rem", cursor: "pointer", fontSize: "0.8rem" }}>🗑️</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}

const lStyle: React.CSSProperties = { color: "#94a3b8", fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: "0.35rem" };
const iStyle: React.CSSProperties = { background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.6rem 0.9rem", color: "#fff", fontSize: "0.9rem", width: "100%", boxSizing: "border-box" };
