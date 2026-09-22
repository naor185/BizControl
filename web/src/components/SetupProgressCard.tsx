"use client";

import Link from "next/link";
import { SetupProgress } from "@/lib/api";

function RingProgress({ pct, size = 96, color }: { pct: number; size?: number; color: string }) {
    const r = (size - 14) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - Math.min(pct, 100) / 100);
    return (
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={9} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={9}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
        </svg>
    );
}

function greetingWord(): string {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "בוקר טוב";
    if (h >= 12 && h < 17) return "צהריים טובים";
    if (h >= 17 && h < 21) return "ערב טוב";
    return "לילה טוב";
}

export default function SetupProgressCard({ progress }: { progress: SetupProgress }) {
    const { items, completed_count, total_count, percent } = progress;
    const name = progress.owner_first_name || progress.studio_name || "";
    const color = percent >= 70 ? "#10b981" : percent >= 35 ? "#f59e0b" : "#6366f1";

    const nextItem =
        items.find(i => i.tier === "required" && !i.done) ??
        items.find(i => i.tier === "recommended" && !i.done) ??
        null;

    const remaining = items.filter(i => !i.done);

    return (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }} dir="rtl">
            <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <RingProgress pct={percent} color={color} />
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                        <span style={{ fontSize: "1.15rem", fontWeight: 800, color }}>{percent}%</span>
                    </div>
                </div>

                <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#1a1a2e", marginBottom: "0.2rem" }}>
                        {greetingWord()}{name ? `, ${name}` : ""} 👋
                    </div>
                    <div style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "0.75rem" }}>
                        {completed_count} מתוך {total_count} משימות הושלמו
                        {nextItem && ` · נשארו לך ${total_count - completed_count} פעולות קטנות כדי להשלים את הקמת העסק`}
                    </div>

                    {nextItem ? (
                        <Link
                            href={nextItem.href}
                            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", background: "#0f172a", color: "#fff", padding: "0.65rem 1.2rem", borderRadius: 12, fontWeight: 700, fontSize: "0.88rem", textDecoration: "none" }}
                        >
                            הצעד הבא שלך: {nextItem.label} ←
                        </Link>
                    ) : (
                        <div style={{ background: "#d1fae5", color: "#065f46", padding: "0.5rem 1rem", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700, display: "inline-block" }}>
                            כל הכבוד! השלמתם את כל שלבי הקמת העסק 🎉
                        </div>
                    )}
                </div>
            </div>

            {remaining.length > 0 && (
                <div style={{ marginTop: "1.25rem", paddingTop: "1.1rem", borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                        מה עוד נשאר?
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                        {remaining.map(item => (
                            <Link
                                key={item.id}
                                href={item.href}
                                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.6rem", borderRadius: 10, textDecoration: "none", color: "#1a1a2e", fontSize: "0.88rem", fontWeight: 600 }}
                                className="hover:bg-slate-50"
                            >
                                <span style={{ fontSize: "1rem" }}>⬜</span>
                                <span style={{ flex: 1 }}>{item.label}</span>
                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: 20, background: item.tier === "required" ? "#fee2e2" : "#e0e7ff", color: item.tier === "required" ? "#dc2626" : "#4338ca" }}>
                                    {item.tier === "required" ? "נדרש" : "מומלץ"}
                                </span>
                                <span style={{ color: "#cbd5e1" }}>←</span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
