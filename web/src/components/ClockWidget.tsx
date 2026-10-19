"use client";

import { toast } from "@/lib/toast";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { BarChart3, CalendarRange, Coffee, Play, Timer, Users } from "lucide-react";
import { apiFetch, getCurrentUserRole } from "@/lib/api";
import { PresenceList, type PresenceEntry } from "@/components/team/PresenceNow";

import { tx, intl } from "@/lib/i18n";
type ClockStatus = {
    is_clocked_in: boolean;
    pay_type?: string;
    active_session?: { start_time: string; break_minutes?: number; break_started_at?: string | null } | null;
    nfc?: boolean;              // the business clocks in at the barcode (or NFC sticker) at the door — no button here
    available?: boolean;        // the plan has the attendance clock, and this is a worker or a manager (not the owner)
};

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
                toast.success(tx("יציאה נרשמה בהצלחה"));
            } else {
                await apiFetch("/api/staff/clock-in", { method: "POST" });
                toast.success(tx("כניסה נרשמה בהצלחה"));
            }
            await fetchData();
        } catch {
            toast.error(tx("שגיאה בפעולת נוכחות"));
        } finally {
            setLoading(false);
            setExpanded(false);
        }
    };

    // a break (the owner, 2026-10-19) — from here with the barcode too; not counted in the hours or the pay
    const handleBreak = async (action: "start" | "end") => {
        setLoading(true);
        try {
            await apiFetch(`/api/staff/break/${action}`, { method: "POST" });
            toast.success(action === "start" ? tx("יצאת להפסקה — הזמן לא נספר עד שתחזור/י") : tx("חזרת מההפסקה"));
            await fetchData();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : tx("שגיאה"));
        } finally {
            setLoading(false);
        }
    };

    if (!myStatus) return null;

    // every worker and manager, whatever their pay — the hours are kept (owner, 2026-10-16); the owner doesn't clock
    const showClock = !!myStatus.available;
    const activeCount = presence.length;

    if (!showClock && activeCount === 0) return null;

    const isClockedIn = myStatus.is_clocked_in;
    const onBreakSince = myStatus.active_session?.break_started_at ?? null;
    const hm = (iso: string) => new Date(iso).toLocaleTimeString(intl(), { hour: "2-digit", minute: "2-digit" });

    return (
        <div className="relative flex items-center gap-2">
            {/* Active employees count — visible for managers/owners */}
            {activeCount > 0 && (
                <button
                    onClick={() => setExpanded(o => !o)}
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <span className="text-xs font-semibold text-emerald-700">{activeCount}{tx(" פעילים")}</span>
                </button>
            )}

            {/* With the barcode clock: where they stand, not a button — clocking is a scan at the door */}
            {showClock && myStatus.nfc && (
                <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold ${onBreakSince ? "bg-amber-50 text-amber-800 border border-amber-200" : isClockedIn ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500"}`}
                    title={tx("כניסה ויציאה — סורקים את הברקוד שבכניסה (או נוגעים בטלפון במדבקה)")}>
                    {onBreakSince ? tx("בהפסקה מ-{0}", { 0: hm(onBreakSince) })
                        : isClockedIn && myStatus.active_session ? tx("בעבודה מ-{0}", { 0: hm(myStatus.active_session.start_time) })
                        : tx("החתמה בכניסה")}
                </span>
            )}

            {/* On shift: a break, and back from it */}
            {showClock && isClockedIn && (
                <button type="button" onClick={() => handleBreak(onBreakSince ? "end" : "start")} disabled={loading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 ${onBreakSince ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                    {onBreakSince ? <Play className="w-4 h-4" aria-hidden /> : <Coffee className="w-4 h-4" aria-hidden />}
                    {onBreakSince ? tx("חזרה") : tx("הפסקה")}
                </button>
            )}

            {/* Clock-in / Clock-out button */}
            {showClock && !myStatus.nfc && (
                <button
                    onClick={handleClockToggle}
                    disabled={loading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 ${
                        isClockedIn
                            ? "bg-rose-500 text-white hover:bg-rose-600"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                    }`}
                >
                    <Timer className="w-4 h-4" aria-hidden />
                    {loading ? "..." : isClockedIn ? tx("יציאה") : tx("כניסה")}
                </button>
            )}

            {/* Presence dropdown */}
            {expanded && activeCount > 0 && (
                <>
                    <div className="fixed inset-0 z-30" onClick={() => setExpanded(false)} />
                    <div className="absolute top-full end-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 min-w-64 z-40 overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                            <div className="text-xs font-bold text-slate-500">{tx("בעבודה עכשיו")}</div>
                        </div>
                        <PresenceList entries={presence} />
                        {/* the owner and a manager: straight to the workers center (the owner, 2026-10-19) */}
                        {(getCurrentUserRole() === "owner" || getCurrentUserRole() === "admin") && (
                            <div className="grid grid-cols-3 border-t border-slate-100 bg-slate-50/60">
                                {([["/team?tab=schedule", tx("סידור עבודה"), CalendarRange], ["/team?tab=reports", tx("דוחות"), BarChart3], ["/team", tx("מרכז העובדים"), Users]] as const).map(([href, label, Icon]) => (
                                    <Link key={href} href={href} onClick={() => setExpanded(false)}
                                        className="flex flex-col items-center gap-1 px-2 py-2.5 text-xs font-semibold text-slate-700 hover:bg-white">
                                        <Icon className="w-4 h-4 text-sky-700" aria-hidden /> {label}
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
