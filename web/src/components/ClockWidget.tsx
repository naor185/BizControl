"use client";

import { useState, useEffect } from "react";
import { getClockStatus, clockIn, clockOut, ClockStatus } from "@/lib/api";

export default function ClockWidget() {
    const [status, setStatus] = useState<ClockStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date());

    const fetchStatus = async () => {
        try {
            const data = await getClockStatus();
            setStatus(data);
        } catch (err) {
            console.error("Failed to fetch clock status", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    if (loading) return null;

    const handleAction = async () => {
        setLoading(true);
        try {
            if (status?.is_clocked_in) {
                await clockOut();
            } else {
                await clockIn();
            }
            await fetchStatus();
        } catch (err) {
            alert("שגיאה בפעולת נוכחות");
        } finally {
            setLoading(false);
        }
    };

    const isClockedIn = status?.is_clocked_in;

    return (
        <div className="fixed bottom-6 left-6 z-40">
            <div className={`flex items-center gap-4 bg-white/80 backdrop-blur-md p-2 pl-4 pr-2 rounded-2xl shadow-2xl border ${isClockedIn ? 'border-emerald-200' : 'border-slate-200'} animate-in slide-in-from-left-4 duration-500`}>
                <div className="text-right">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">נוכחות צוות</div>
                    <div className="text-sm font-black text-slate-800 tabular-nums">
                        {currentTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                </div>

                <button
                    onClick={handleAction}
                    className={`px-4 py-2 rounded-xl font-bold text-xs transition-all shadow-lg active:scale-95 flex items-center gap-2 ${
                        isClockedIn 
                        ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-rose-200' 
                        : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200'
                    }`}
                >
                    <span>{isClockedIn ? 'יציאה' : 'כניסה'}</span>
                    <span>{isClockedIn ? '⏹️' : '▶️'}</span>
                </button>

                {isClockedIn && (
                    <div className="flex flex-col items-center">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                        <span className="text-[8px] font-bold text-emerald-600 mt-0.5">פעיל</span>
                    </div>
                )}
            </div>
        </div>
    );
}
