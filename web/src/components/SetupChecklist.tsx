"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Circle, RotateCcw, X } from "lucide-react";
import { apiFetch, dismissSetupItem, restoreSetupItem, SetupProgress } from "@/lib/api";
import { toast } from "@/lib/toast";

function Ring({ pct, size = 64 }: { pct: number; size?: number }) {
    const r = (size - 10) / 2;
    const circ = 2 * Math.PI * r;
    return (
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={7} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--primary)" strokeWidth={7}
                strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(pct, 100) / 100)}
                strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
        </svg>
    );
}

// Business-setup checklist. Every item's done-state is computed live on the server
// (GET /api/dashboard/setup-progress), so the moment all shown items are done the whole
// section disappears, and it comes back by itself when a new item is added to the system.
export default function SetupChecklist() {
    const [progress, setProgress] = useState<SetupProgress | null>(null);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [showDone, setShowDone] = useState(false);

    useEffect(() => {
        apiFetch<SetupProgress>("/api/dashboard/setup-progress")
            .then(setProgress)
            .catch(() => setProgress(null))
            .finally(() => setLoading(false));
    }, []);

    const act = async (id: string, fn: (id: string) => Promise<SetupProgress>) => {
        setBusyId(id);
        try {
            setProgress(await fn(id));
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "שגיאה");
        } finally {
            setBusyId(null);
        }
    };

    if (loading) return <div className="h-28 bg-slate-50 animate-pulse rounded-2xl" />;
    if (!progress || progress.percent >= 100) return null;

    const remaining = progress.items.filter(i => !i.done);
    const done = progress.items.filter(i => i.done);

    return (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5" dir="rtl">
            <div className="flex items-center gap-4 mb-4">
                <div className="relative shrink-0">
                    <Ring pct={progress.percent} />
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold text-slate-800">{progress.percent}%</span>
                </div>
                <div className="min-w-0">
                    <h3 className="font-bold text-slate-800">הקמת העסק</h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                        {progress.completed_count} מתוך {progress.total_count} משימות הושלמו · האיזור הזה ייעלם כשתסיימו את כולן
                    </p>
                </div>
            </div>

            <div className="divide-y divide-slate-100 border-t border-slate-100">
                {remaining.map(item => (
                    <div key={item.id} className="flex items-center gap-3 py-2.5">
                        <Circle className="h-4 w-4 text-slate-300 shrink-0" />
                        <Link href={item.href} className="flex-1 min-w-0 text-sm font-semibold text-slate-800 hover:underline truncate">{item.label}</Link>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${item.tier === "required" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"}`}>
                            {item.tier === "required" ? "חובה" : "מומלץ"}
                        </span>
                        {item.tier === "recommended" && (
                            <button
                                onClick={() => act(item.id, dismissSetupItem)}
                                disabled={busyId === item.id}
                                title="לא רלוונטי עבורי"
                                className="text-slate-300 hover:text-slate-600 disabled:opacity-40"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {(done.length > 0 || progress.dismissed_items.length > 0) && (
                <div className="border-t border-slate-100 pt-3">
                    <button onClick={() => setShowDone(v => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600">
                        <ChevronDown className={`h-4 w-4 transition-transform ${showDone ? "rotate-180" : ""}`} />
                        {done.length} הושלמו{progress.dismissed_items.length > 0 ? ` · ${progress.dismissed_items.length} סומנו כלא רלוונטי` : ""}
                    </button>
                    {showDone && (
                        <div className="mt-2 space-y-1.5">
                            {done.map(item => (
                                <div key={item.id} className="flex items-center gap-3 text-sm text-slate-400">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                                    <span className="line-through">{item.label}</span>
                                </div>
                            ))}
                            {progress.dismissed_items.map(item => (
                                <div key={item.id} className="flex items-center gap-3 text-sm text-slate-400">
                                    <span className="flex-1">{item.label} <span className="text-xs">(לא רלוונטי)</span></span>
                                    <button
                                        onClick={() => act(item.id, restoreSetupItem)}
                                        disabled={busyId === item.id}
                                        className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-40"
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" /> החזר
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
