"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface StudioScanRow {
    studio_id: string;
    studio_name: string;
    enabled: boolean;
    quota: number;
    used: number;
    reset_month: string | null;
}

const QUOTA_PRESETS = [0, 30, 100, 500, 1000, 5000];

export default function InvoiceScansAdminPage() {
    const [rows, setRows] = useState<StudioScanRow[]>([]);
    const [totalUsed, setTotalUsed] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [err, setErr] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            const data = await apiFetch<{ studios: StudioScanRow[]; total_used: number }>("/api/admin/invoice-scans/stats");
            setRows(data.studios);
            setTotalUsed(data.total_used);
        } catch (e: any) {
            setErr(e.message || "שגיאה בטעינת נתונים");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const toggle = async (row: StudioScanRow) => {
        setSaving(row.studio_id);
        try {
            const action = row.enabled ? "invoice-scan-disable" : "invoice-scan-enable";
            await apiFetch(`/api/admin/studios/${row.studio_id}/${action}`, { method: "POST" });
            await load();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setSaving(null);
        }
    };

    const setQuota = async (row: StudioScanRow, quota: number) => {
        setSaving(row.studio_id + "_q");
        try {
            await apiFetch(`/api/admin/studios/${row.studio_id}/invoice-scan-quota`, {
                method: "PUT",
                body: JSON.stringify({ quota }),
            });
            await load();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setSaving(null);
        }
    };

    const topStudio = rows.length > 0 ? rows[0] : null;

    return (
        <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)", padding: "2rem", fontFamily: "sans-serif", direction: "rtl" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
                    <a href="/admin" style={{ color: "#a78bfa", textDecoration: "none", fontSize: "0.9rem" }}>← חזרה לאדמין</a>
                    <h1 style={{ color: "#fff", fontSize: "1.8rem", fontWeight: 700, margin: 0 }}>📄 ניהול סריקות AI</h1>
                </div>

                {err && (
                    <div style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "0.75rem 1rem", color: "#fca5a5", marginBottom: "1rem", fontSize: "0.9rem" }}>
                        {err}
                    </div>
                )}

                {/* Summary cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "1rem", marginBottom: "2rem" }}>
                    <StatCard title="סה״כ סריקות החודש" value={totalUsed.toString()} icon="🔍" />
                    <StatCard title="סטודיוים פעילים" value={rows.filter(r => r.enabled).length.toString()} icon="✅" />
                    <StatCard title="הניצל הכי הרבה" value={topStudio ? `${topStudio.studio_name} (${topStudio.used})` : "—"} icon="🏆" />
                    <StatCard title="GCP Credits" value="ראה GCP Console" icon="☁️" sub="console.cloud.google.com" />
                </div>

                {/* Table */}
                <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, overflow: "hidden" }}>
                    <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "#fff", fontWeight: 600 }}>כל הסטודיוים</span>
                        <button onClick={load} style={{ background: "rgba(167,139,250,.15)", border: "1px solid rgba(167,139,250,.3)", borderRadius: 8, color: "#a78bfa", padding: "0.4rem 1rem", cursor: "pointer", fontSize: "0.85rem" }}>
                            רענן
                        </button>
                    </div>

                    {loading ? (
                        <div style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>טוען...</div>
                    ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                            <thead>
                                <tr style={{ background: "rgba(255,255,255,.03)" }}>
                                    {["סטודיו", "סריקה AI", "שימוש חודשי", "מכסה", "קביעת מכסה", "איפוס חודשי"].map(h => (
                                        <th key={h} style={{ padding: "0.75rem 1rem", textAlign: "right", color: "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.studio_id} style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}>
                                        <td style={{ padding: "0.75rem 1rem", color: "#e2e8f0", fontWeight: 600 }}>{row.studio_name}</td>
                                        <td style={{ padding: "0.75rem 1rem" }}>
                                            <button
                                                onClick={() => toggle(row)}
                                                disabled={saving === row.studio_id}
                                                style={{
                                                    padding: "0.3rem 0.9rem", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem",
                                                    background: row.enabled ? "rgba(74,222,128,.15)" : "rgba(100,116,139,.15)",
                                                    color: row.enabled ? "#4ade80" : "#64748b",
                                                }}
                                            >
                                                {saving === row.studio_id ? "..." : row.enabled ? "✅ פעיל" : "❌ כבוי"}
                                            </button>
                                        </td>
                                        <td style={{ padding: "0.75rem 1rem" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                                <div style={{ width: 80, height: 6, background: "rgba(255,255,255,.1)", borderRadius: 3, overflow: "hidden" }}>
                                                    <div style={{
                                                        height: "100%", borderRadius: 3,
                                                        width: row.quota > 0 ? `${Math.min(100, (row.used / row.quota) * 100)}%` : "0%",
                                                        background: row.quota > 0 && row.used >= row.quota ? "#ef4444" : "#a78bfa",
                                                    }} />
                                                </div>
                                                <span style={{ color: "#e2e8f0" }}>
                                                    {row.used}{row.quota > 0 ? ` / ${row.quota}` : ""}
                                                </span>
                                            </div>
                                        </td>
                                        <td style={{ padding: "0.75rem 1rem", color: row.quota === 0 ? "#4ade80" : "#e2e8f0" }}>
                                            {row.quota === 0 ? "∞ ללא הגבלה" : `${row.quota} / חודש`}
                                        </td>
                                        <td style={{ padding: "0.75rem 1rem" }}>
                                            <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                                                {QUOTA_PRESETS.map(q => (
                                                    <button
                                                        key={q}
                                                        onClick={() => setQuota(row, q)}
                                                        disabled={saving === row.studio_id + "_q"}
                                                        style={{
                                                            padding: "0.2rem 0.5rem", borderRadius: 6, border: "1px solid rgba(255,255,255,.15)",
                                                            background: row.quota === q ? "rgba(167,139,250,.25)" : "transparent",
                                                            color: row.quota === q ? "#a78bfa" : "#94a3b8",
                                                            cursor: "pointer", fontSize: "0.75rem",
                                                        }}
                                                    >
                                                        {q === 0 ? "∞" : q}
                                                    </button>
                                                ))}
                                            </div>
                                        </td>
                                        <td style={{ padding: "0.75rem 1rem", color: "#64748b", fontSize: "0.8rem" }}>
                                            {row.reset_month || "—"}
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 && (
                                    <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>אין סטודיוים</td></tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                <p style={{ color: "#475569", fontSize: "0.8rem", marginTop: "1rem", textAlign: "center" }}>
                    מכסה 0 = ללא הגבלה. מכסה מתאפסת אוטומטית בתחילת כל חודש.
                </p>
            </div>
        </div>
    );
}

function StatCard({ title, value, icon, sub }: { title: string; value: string; icon: string; sub?: string }) {
    return (
        <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.25rem 1.5rem" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{icon}</div>
            <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.25rem" }}>{title}</div>
            <div style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 700 }}>{value}</div>
            {sub && <div style={{ color: "#475569", fontSize: "0.75rem", marginTop: "0.25rem" }}>{sub}</div>}
        </div>
    );
}
