"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { type SessionOut, describeDevice, formatSessionDate } from "@/lib/sessionFormat";

// Owner/admin view of a staff member's active devices (require_roles(OWNER,
// ADMIN) enforced server-side on both endpoints — same as MySessionsSettings
// but scoped to another user, and revoking here force-logs-out that person's
// device instead of your own.
export default function StaffSessionsModal({ userId, userName, onClose }: { userId: string; userName: string; onClose: () => void }) {
    const [sessions, setSessions] = useState<SessionOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [revokingId, setRevokingId] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<SessionOut[]>(`/api/auth/users/${userId}/sessions`)
            .then(setSessions)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [userId]);

    const revoke = async (id: string) => {
        setRevokingId(id);
        try {
            await apiFetch(`/api/auth/users/${userId}/sessions/${id}`, { method: "DELETE" });
            setSessions(prev => prev.filter(s => s.id !== id));
        } catch {
            // leave the list as-is — the button just stops spinning
        } finally {
            setRevokingId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90dvh]"
                onClick={e => e.stopPropagation()}
            >
                <div className="bg-slate-50 border-b border-slate-100 p-5 flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">📱 מכשירים מחוברים</h3>
                        <p className="text-sm text-slate-500 mt-0.5">{userName}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-white rounded-full transition-colors">✕</button>
                </div>

                <div className="p-6 space-y-2 overflow-y-auto">
                    {loading ? (
                        <p className="text-sm text-slate-400">טוען...</p>
                    ) : sessions.length === 0 ? (
                        <p className="text-sm text-slate-400">לא נמצאו מכשירים מחוברים</p>
                    ) : (
                        sessions.map(s => (
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
                                    {revokingId === s.id ? "..." : "נתק מכשיר"}
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
