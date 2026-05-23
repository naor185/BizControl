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
    const [tick, setTick] = useState(0);

    const fetchData = useCallback(async () => {
        try {
            const [statusData, presenceData] = await Promise.all([
                apiFetch<ClockStatus>("/api/staff/clock-status"),
                apiFetch<PresenceEntry[]>("/api/nfc/presence"),
            ]);
            setMyStatus(statusData);
            setPresence(presenceData);
        } catch { /* not logged in */ }
    }, []);

    useEffect(() => {
        fetchData();
        const poll = setInterval(fetchData, 30000);
        const timer = setInterval(() => setTick(t => t + 1), 60000);
        return () => { clearInterval(poll); clearInterval(timer); };
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
        }
    };

    if (!myStatus) return null;
    if (myStatus.pay_type !== "hourly" && myStatus.pay_type !== "global" && presence.length === 0) return null;

    const isClockedIn = myStatus.is_clocked_in;
    const activeCount = presence.length;

    return (
        <div className="fixed bottom-6 left-4 md:left-6 z-40">
            <div className={`bg-white/90 backdrop-blur-md rounded-2xl shadow-2xl border transition-all duration-300 overflow-hidden ${isClockedIn ? "border-emerald-200" : "border-slate-200"}`}
                style={{ minWidth: 200 }}>

                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-2.5">
                    {/* Status dot */}
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isClockedIn ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />

                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">נוכחות צוות</div>
                        {activeCount > 0
                            ? <div className="text-xs font-semibold text-emerald-700 mt-0.5">{activeCount} פעילים כעת</div>
                            : <div className="text-xs text-slate-400 mt-0.5">אין עובדים פעילים</div>
                        }
                    </div>

                    {/* Expand toggle */}
                    {activeCount > 0 && (
                        <button
                            onClick={() => setExpanded(o => !o)}
                            className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors text-[10px]"
                        >
                            {expanded ? "▲" : "▼"}
                        </button>
                    )}

                    {/* Clock in/out button */}
                    {(myStatus.pay_type === "hourly" || myStatus.pay_type === "global") && (
                        <button
                            onClick={handleClockToggle}
                            disabled={loading}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all shadow-sm active:scale-95 disabled:opacity-50 ${
                                isClockedIn
                                    ? "bg-rose-500 text-white hover:bg-rose-600"
                                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                            }`}
                        >
                            {isClockedIn ? "יציאה" : "כניסה"}
                        </button>
                    )}
                </div>

                {/* Presence list */}
                {expanded && activeCount > 0 && (
                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                        {presence.map(p => (
                            <div key={p.user_id} className="flex items-center gap-3 px-4 py-2">
                                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-[10px] font-bold text-emerald-700 shrink-0">
                                    {p.user_name.charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-semibold text-slate-800 truncate">{p.user_name}</div>
                                    <div className="text-[10px] text-slate-400">{fmtDuration(p.duration_minutes + tick * 0)}</div>
                                </div>
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
