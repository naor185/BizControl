"use client";

import { toast } from "@/lib/toast";
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";

type PresenceEntry = {
    user_id: string;
    user_name: string;
    clocked_in_at: string;
    duration_minutes: number;
};

type ClockStatus = {
    is_clocked_in: boolean;
    pay_type?: string;
};

function fmtDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}ד׳`;
    return `${h}ש׳ ${m}ד׳`;
}

export default function ClockWidget() {
    const [presence, setPresence] = useState<PresenceEntry[]>([]);
    const [myStatus, setMyStatus] = useState<ClockStatus | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [statusData, presenceData] = await Promise.all([
                apiFetch<ClockStatus>("/api/staff/clock-status"),
                apiFetch<PresenceEntry[]>("/api/nfc/presence"),
            ]);
            setMyStatus(statusData);
            setPresence(presenceData);
        } catch { }
    }, []);

    useEffect(() => {
        fetchData();
        const poll = setInterval(fetchData, 30000);
        return () => clearInterval(poll);
    }, [fetchData]);

    const handleClockToggle = async () => {
        if (!myStatus) return;
        setLoading(true);
        try {
            if (myStatus.is_clocked_in) {
                await apiFetch("/api/staff/clock-out", { method: "POST" });
                toast.success("יציאה נרשמה בהצלחה");
            } else {
                await apiFetch("/api/staff/clock-in", { method: "POST" });
                toast.success("כניסה נרשמה בהצלחה");
            }
            await fetchData();
        } catch {
            toast.error("שגיאה בפעולת נוכחות");
        } finally {
            setLoading(false);
            setExpanded(false);
        }
    };

    if (!myStatus) return null;

    const showClock = myStatus.pay_type === "hourly" || myStatus.pay_type === "global";
    const activeCount = presence.length;

    if (!showClock && activeCount === 0) return null;

    const isClockedIn = myStatus.is_clocked_in;

    return (
        <div className="relative flex items-center gap-2">
            {/* Active employees count — visible for managers/owners */}
            {activeCount > 0 && (
                <button
                    onClick={() => setExpanded(o => !o)}
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <span className="text-xs font-semibold text-emerald-700">{activeCount} פעילים</span>
                </button>
            )}

            {/* Clock-in / Clock-out button — only for hourly/global employees */}
            {showClock && (
                <button
                    onClick={handleClockToggle}
                    disabled={loading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 ${
                        isClockedIn
                            ? "bg-rose-500 text-white hover:bg-rose-600"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                    }`}
                >
                    {loading ? "..." : isClockedIn ? "⏱ יציאה" : "⏱ כניסה"}
                </button>
            )}

            {/* Presence dropdown */}
            {expanded && activeCount > 0 && (
                <>
                    <div className="fixed inset-0 z-30" onClick={() => setExpanded(false)} />
                    <div className="absolute top-full end-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 min-w-52 z-40 overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">עובדים פעילים</div>
                        </div>
                        {presence.map(p => (
                            <div key={p.user_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                                <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700 shrink-0">
                                    {p.user_name.charAt(0)}
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-semibold text-slate-800">{p.user_name}</div>
                                    <div className="text-xs text-slate-400">{fmtDuration(p.duration_minutes)}</div>
                                </div>
                                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
