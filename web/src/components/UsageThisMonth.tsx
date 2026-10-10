"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

// This month's use of what the plan counts — WhatsApp messages, עסק קטן's broadcasts, invoice scans
// (GET /api/modules/me/usage; the counting is app/services/message_quota.py). When the WhatsApp messages run out,
// reminders go by e-mail and broadcasts stop until the month starts again.
type Usage = { key: string; label: string; used: number; limit: number | null; remaining: number | null; resets_on: string };

export default function UsageThisMonth() {
    const [rows, setRows] = useState<Usage[] | null>(null);
    useEffect(() => {
        apiFetch<Usage[]>("/api/modules/me/usage").then(setRows).catch(() => setRows([]));
    }, []);
    if (!rows || rows.length === 0) return null;
    const resets = new Date(rows[0].resets_on).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });

    return (
        <section className="rounded-2xl border border-slate-100 p-4 space-y-4" aria-label="ניצול החודש">
            <div className="flex items-baseline justify-between gap-3">
                <h4 className="font-bold text-slate-800 text-sm">ניצול החודש</h4>
                <span className="text-xs text-slate-400">מתאפס ב-{resets}</span>
            </div>
            {rows.map(u => {
                const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
                const tone = pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
                return (
                    <div key={u.key}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="text-slate-700 font-medium">{u.label}</span>
                            <span className="text-slate-500 tabular-nums">
                                {u.limit === null
                                    ? `${u.used.toLocaleString("he-IL")} החודש · ללא הגבלה`
                                    : `${u.used.toLocaleString("he-IL")} מתוך ${u.limit.toLocaleString("he-IL")} · נשארו ${(u.remaining ?? 0).toLocaleString("he-IL")}`}
                            </span>
                        </div>
                        {u.limit !== null && (
                            <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar"
                                aria-valuenow={u.used} aria-valuemin={0} aria-valuemax={u.limit} aria-label={u.label}>
                                <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
                            </div>
                        )}
                        {u.key === "whatsapp" && u.limit !== null && (u.remaining ?? 0) === 0 && (
                            <p className="text-xs text-rose-600 mt-1">נגמרו ההודעות לחודש — תזכורות ואישורים יוצאים במייל ללקוחות שיש להם מייל, ותפוצות לא יוצאות.</p>
                        )}
                    </div>
                );
            })}
        </section>
    );
}
