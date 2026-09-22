"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch, SetupProgress, dismissSetupItem, restoreSetupItem } from "@/lib/api";
import { toast } from "@/lib/toast";

function RingProgress({ pct, size = 110, color }: { pct: number; size?: number; color: string }) {
    const r = (size - 16) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - Math.min(pct, 100) / 100);
    return (
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={10} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
        </svg>
    );
}

const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.75rem", borderRadius: 10 };
const tierTag = (tier: "required" | "recommended"): React.CSSProperties => ({
    fontSize: "0.68rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: 20,
    background: tier === "required" ? "#fee2e2" : "#e0e7ff",
    color: tier === "required" ? "#dc2626" : "#4338ca",
});

export default function SetupProgressPage() {
    const [progress, setProgress] = useState<SetupProgress | null>(null);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await apiFetch<SetupProgress>("/api/dashboard/setup-progress");
            setProgress(data);
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "שגיאה בטעינת הנתונים");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDismiss = async (id: string) => {
        setBusyId(id);
        try {
            const updated = await dismissSetupItem(id);
            setProgress(updated);
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "שגיאה");
        } finally {
            setBusyId(null);
        }
    };

    const handleRestore = async (id: string) => {
        setBusyId(id);
        try {
            const updated = await restoreSetupItem(id);
            setProgress(updated);
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "שגיאה");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <RequireAuth>
            <AppShell title="🚀 הקמת העסק">
                <div dir="rtl" style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem 1rem 4rem" }}>
                    {loading || !progress ? (
                        <div style={{ textAlign: "center", padding: "4rem", color: "#94a3b8" }}>⏳ טוען...</div>
                    ) : (
                        <>
                            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1.5rem" }}>
                                <div style={{ position: "relative", flexShrink: 0 }}>
                                    <RingProgress pct={progress.percent} color={progress.percent >= 70 ? "#10b981" : progress.percent >= 35 ? "#f59e0b" : "#6366f1"} />
                                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        <span style={{ fontSize: "1.3rem", fontWeight: 800 }}>{progress.percent}%</span>
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#1a1a2e" }}>
                                        {progress.studio_name || "העסק שלך"}
                                    </div>
                                    <div style={{ color: "#6b7280", fontSize: "0.9rem", marginTop: "0.2rem" }}>
                                        {progress.completed_count} מתוך {progress.total_count} משימות הושלמו
                                    </div>
                                </div>
                            </div>

                            {/* Remaining */}
                            {progress.items.some(i => !i.done) && (
                                <div style={{ marginBottom: "1.5rem" }}>
                                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem", padding: "0 0.25rem" }}>
                                        נשאר להשלים
                                    </div>
                                    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "0.5rem" }}>
                                        {progress.items.filter(i => !i.done).map(item => (
                                            <div key={item.id} style={rowStyle} className="hover:bg-slate-50">
                                                <Link href={item.href} style={{ display: "flex", alignItems: "center", gap: "0.6rem", flex: 1, textDecoration: "none", color: "#1a1a2e", fontWeight: 600, fontSize: "0.9rem" }}>
                                                    <span>⬜</span>
                                                    <span style={{ flex: 1 }}>{item.label}</span>
                                                </Link>
                                                <span style={tierTag(item.tier)}>{item.tier === "required" ? "נדרש" : "מומלץ"}</span>
                                                {item.tier === "recommended" && (
                                                    <button
                                                        onClick={() => handleDismiss(item.id)}
                                                        disabled={busyId === item.id}
                                                        title="סמן כלא רלוונטי עבורי"
                                                        style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Completed */}
                            {progress.items.some(i => i.done) && (
                                <div style={{ marginBottom: "1.5rem" }}>
                                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem", padding: "0 0.25rem" }}>
                                        הושלם
                                    </div>
                                    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "0.5rem" }}>
                                        {progress.items.filter(i => i.done).map(item => (
                                            <div key={item.id} style={rowStyle} className="hover:bg-slate-50">
                                                <Link href={item.href} style={{ display: "flex", alignItems: "center", gap: "0.6rem", flex: 1, textDecoration: "none", color: "#94a3b8", fontWeight: 600, fontSize: "0.9rem", textDecorationLine: "line-through" }}>
                                                    <span style={{ textDecoration: "none" }}>✅</span>
                                                    <span>{item.label}</span>
                                                </Link>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Dismissed */}
                            {progress.dismissed_items.length > 0 && (
                                <div>
                                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem", padding: "0 0.25rem" }}>
                                        סימנת כלא רלוונטי
                                    </div>
                                    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "0.5rem" }}>
                                        {progress.dismissed_items.map(item => (
                                            <div key={item.id} style={rowStyle}>
                                                <span style={{ flex: 1, color: "#94a3b8", fontSize: "0.9rem" }}>{item.label}</span>
                                                <button
                                                    onClick={() => handleRestore(item.id)}
                                                    disabled={busyId === item.id}
                                                    style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 8, color: "#6366f1", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, padding: "0.25rem 0.6rem" }}
                                                >
                                                    החזר ↺
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
