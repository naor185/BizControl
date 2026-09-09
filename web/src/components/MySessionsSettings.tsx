"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { type SessionOut, describeDevice, formatSessionDate } from "@/lib/sessionFormat";

export default function MySessionsSettings() {
    const [sessions, setSessions] = useState<SessionOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    // Collapsed by default — this list only grows (a fresh login/refresh-
    // token rotation is a new row, old sessions are never auto-pruned), so
    // rendering it inline and always-open made the settings page get longer
    // and longer over time. The count still shows in the closed header, so
    // opening it is a deliberate choice, not the only way to see anything.
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        apiFetch<SessionOut[]>("/api/auth/sessions")
            .then(setSessions)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const revoke = async (id: string) => {
        setRevokingId(id);
        try {
            await apiFetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
            setSessions(prev => prev.filter(s => s.id !== id));
        } catch {
            // leave the list as-is — the button just stops spinning
        } finally {
            setRevokingId(null);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mt-6">
            <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center gap-3 text-right"
            >
                <span className="text-2xl">📱</span>
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800">
                        המכשירים שלי{!loading && ` (${sessions.length})`}
                    </h3>
                    <p className="text-sm text-slate-500">כל מכשיר שמחובר כרגע לחשבון שלך — אפשר להתנתק מרחוק ממכשיר שכבר לא בשימוש</p>
                </div>
                <span className={`shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
            </button>

            {expanded && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                    {loading ? (
                        <p className="text-sm text-slate-400">טוען...</p>
                    ) : sessions.length === 0 ? (
                        <p className="text-sm text-slate-400">לא נמצאו מכשירים מחוברים</p>
                    ) : (
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                            {sessions.map(s => (
                                <div key={s.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-slate-700">{describeDevice(s.user_agent)}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">
                                            מחובר מאז {formatSessionDate(s.session_started_at)} · פעיל לאחרונה {formatSessionDate(s.last_active_at)}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => revoke(s.id)}
                                        disabled={revokingId === s.id}
                                        className="shrink-0 text-xs font-bold px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                                    >
                                        {revokingId === s.id ? "..." : "התנתק"}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
