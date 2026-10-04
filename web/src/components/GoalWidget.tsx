"use client";

import { toast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { getGoalProgress, setMonthlyGoal, GoalProgress } from "@/lib/api";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import Link from "next/link";

const fmt = (n: number) => Math.round(n).toLocaleString("he-IL");

// index = 0 Sunday … 6 Saturday, like the server's work_days
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const joinHe = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ו${names[names.length - 1]}`;

// SVG ring progress
function RingProgress({ pct, size = 110, color }: { pct: number; size?: number; color: string }) {
    const r = (size - 16) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - Math.min(pct, 100) / 100);
    return (
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={10} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
    );
}

export default function GoalWidget({ month, year }: { month?: number; year?: number }) {
    const [progress, setProgress] = useState<GoalProgress | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [newTarget, setNewTarget] = useState("");

    const fetchGoal = async () => {
        try {
            setLoading(true);
            const data = await getGoalProgress(month, year);
            setProgress(data);
            if (!isEditing) setNewTarget(data.target_amount > 0 ? String(Math.round(Number(data.target_amount))) : "");
        } catch { } finally { setLoading(false); }
    };

    useEffect(() => { fetchGoal(); }, [month, year]);

    const handleSave = async () => {
        const target = parseFloat(newTarget);
        if (isNaN(target) || target <= 0) return;
        try {
            const today = new Date();
            await setMonthlyGoal(target, month || today.getMonth() + 1, year || today.getFullYear());
            setIsEditing(false);
            fetchGoal();
        } catch { toast.error("שגיאה בעדכון יעד"); }
    };

    if (loading && !progress) return <div style={{ height: 120, background: "#f8fafc", borderRadius: 16, animation: "pulse 1.5s infinite" }} />;
    if (!progress) return null;

    const current = Number(progress.current_revenue);
    const target = Number(progress.target_amount);
    const remaining = Number(progress.remaining_amount);
    const dailyAvg = Number(progress.current_daily_avg);
    const dailyNeeded = Number(progress.required_daily_avg);
    const pct = Math.min(100, progress.progress_percentage);
    const isOnTrack = dailyAvg >= dailyNeeded;
    const isTargetMet = current >= target && target > 0;
    // no working day is over yet (the month's first day) — there is no average to compare with
    const hasAverage = progress.days_elapsed > 0;
    const pace: { text: string; good: boolean } | null =
        target <= 0 ? null
        : isTargetMet ? { text: "✅ היעד הושג", good: true }
        : progress.days_remaining === 0 ? { text: "❌ היעד לא הושג", good: false }
        : !hasAverage ? null
        : isOnTrack ? { text: "✅ בקצב", good: true } : { text: "⚠️ מאחור", good: false };

    const trendData = (progress.daily_revenue ?? []).map(r => ({ day: r.day, value: Number(r.amount) }));
    const hasTrend = trendData.some(p => p.value > 0);

    const color = isTargetMet ? "#10b981" : "#2563eb";
    const workDays = progress.work_days ?? [0, 1, 2, 3, 4, 5, 6];
    const offDays = DAY_NAMES.filter((_, d) => !workDays.includes(d));

    return (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "1.25rem 1.5rem", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }} dir="rtl">
            <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>

                {/* Ring + % */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <RingProgress pct={pct} size={110} color={color} />
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                        <span style={{ fontSize: "1.1rem", fontWeight: 800, color }}>{pct.toFixed(0)}%</span>
                        <span style={{ fontSize: "0.6rem", color: "#9ca3af", fontWeight: 600 }}>בוצע</span>
                    </div>
                </div>

                {/* Main info */}
                <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1a1a2e" }}>יעד הכנסה חודשי</span>
                        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                            {new Date(progress.year, progress.month - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" })}
                        </span>
                    </div>

                    {isEditing ? (
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                            <input type="text" inputMode="numeric" value={newTarget}
                                onChange={e => setNewTarget(e.target.value.replace(/[^0-9.]/g, ""))}
                                onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setIsEditing(false); }}
                                style={{ flex: 1, border: "2px solid #6366f1", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.9rem", outline: "none" }}
                                dir="ltr" autoFocus placeholder="75000" />
                            <button onClick={handleSave} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "0.35rem 0.8rem", fontWeight: 700, cursor: "pointer" }}>שמור</button>
                            <button onClick={() => setIsEditing(false)} style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.35rem 0.8rem", cursor: "pointer", color: "#6b7280" }}>ביטול</button>
                        </div>
                    ) : (
                        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.5rem" }}>
                            <span style={{ fontSize: "1.6rem", fontWeight: 800, color: "#1a1a2e" }} dir="ltr">₪{fmt(current)}</span>
                            <span style={{ color: "#9ca3af", fontSize: "0.85rem" }}>/ ₪{fmt(target)}</span>
                            <button onClick={() => { setNewTarget(target > 0 ? String(Math.round(target)) : ""); setIsEditing(true); }}
                                style={{ background: "none", border: "none", color: "#6366f1", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", marginRight: "auto" }}>
                                עדכן יעד ✏️
                            </button>
                        </div>
                    )}

                    {/* Mini stats row */}
                    <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
                        <div>
                            <div style={{ fontSize: "0.65rem", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>נותר</div>
                            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: color }} dir="ltr">₪{fmt(remaining)}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: "0.65rem", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>ממוצע יומי</div>
                            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1a1a2e" }} dir="ltr">{hasAverage ? `₪${fmt(dailyAvg)}` : "—"}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: "0.65rem", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>נדרש ביום</div>
                            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: !hasAverage ? "#1a1a2e" : isOnTrack ? "#10b981" : "#ef4444" }} dir="ltr">₪{fmt(dailyNeeded)}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: "0.65rem", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>ימי עבודה שנותרו</div>
                            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1a1a2e" }}>{progress.days_remaining}</div>
                        </div>
                        {pace && (
                            <div style={{ display: "flex", alignItems: "center" }}>
                                <span style={{ fontSize: "0.75rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: 20, background: pace.good ? "#d1fae5" : "#fee2e2", color: pace.good ? "#059669" : "#dc2626" }}>
                                    {pace.text}
                                </span>
                            </div>
                        )}
                    </div>
                    <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", color: "#9ca3af" }}>
                        {offDays.length ? `לא נספרים ימי ${joinHe(offDays)}` : "כל ימי השבוע נספרים"}
                        {" · "}
                        <Link href="/automation?tab=branding#work-days" style={{ color: "#6366f1", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>שינוי ימי עבודה</Link>
                    </div>
                </div>

                {/* Trend sparkline */}
                <div style={{ width: 140, flexShrink: 0 }}>
                    <div style={{ fontSize: "0.7rem", color: "#9ca3af", fontWeight: 600, marginBottom: "0.3rem", textAlign: "center" }}>מגמת הכנסות יומית</div>
                    {hasTrend ? (
                        <ResponsiveContainer width="100%" height={60}>
                            <AreaChart data={trendData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                                <defs>
                                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="day" hide />
                                <Tooltip
                                    contentStyle={{ fontSize: "0.7rem", padding: "2px 6px", border: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", borderRadius: 6 }}
                                    formatter={(v) => [`₪${fmt(Number(v))}`, "הכנסות"]}
                                    labelFormatter={(day) => `${day} בחודש`}
                                />
                                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#sparkGrad)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.72rem", color: "#9ca3af" }}>
                            עוד אין הכנסות החודש
                        </div>
                    )}
                </div>
            </div>

            {isTargetMet && (
                <div style={{ marginTop: "0.75rem", background: "#d1fae5", color: "#065f46", padding: "0.5rem 1rem", borderRadius: 10, fontSize: "0.82rem", fontWeight: 700, textAlign: "center" }}>
                    ✨ כל הכבוד! עברת את היעד החודשי!
                </div>
            )}
        </div>
    );
}
