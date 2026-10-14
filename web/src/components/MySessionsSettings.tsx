"use client";

import { useEffect, useState } from "react";
import { ChevronDown, LogOut, Smartphone } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { type SessionOut, describeDevice, formatSessionDate } from "@/lib/sessionFormat";

// Where I'm signed in — one line per login still alive (app/services/login_sessions.py; it showed 1,236 "devices" for
// 13 real ones, owner 2026-10-14). Sign a lost phone out, or every device but this one.

export default function MySessionsSettings() {
    const [sessions, setSessions] = useState<SessionOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);

    const load = () => apiFetch<SessionOut[]>("/api/auth/sessions").then(setSessions).catch(() => {}).finally(() => setLoading(false));
    useEffect(() => { load(); }, []);

    const revoke = async (id: string) => {
        setBusy(id);
        try {
            await apiFetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
            setSessions(prev => prev.filter(s => s.id !== id));
            toast.success("המכשיר נותק");
        } catch (e) {
            toast.error((e as Error)?.message || "הניתוק נכשל");
        } finally {
            setBusy(null);
        }
    };

    const revokeOthers = async () => {
        if (!confirm("לנתק את כל המכשירים חוץ מזה? בהם תצטרכו להתחבר מחדש.")) return;
        setBusy("others");
        try {
            const refresh = localStorage.getItem("bizcontrol_refresh_token") || "";
            const r = await apiFetch<{ signed_out: number }>("/api/auth/sessions/revoke-others", { method: "POST", body: JSON.stringify({ refresh_token: refresh }) });
            toast.success(r.signed_out ? `נותקו ${r.signed_out} מכשירים` : "אין מכשירים אחרים מחוברים");
            load();
        } catch (e) {
            toast.error((e as Error)?.message || "הניתוק נכשל");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-6">
            <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} className="w-full flex items-center gap-3 text-right">
                <Smartphone className="w-6 h-6 text-slate-500 shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800">המכשירים שלי{!loading && ` (${sessions.length})`}</h3>
                    <p className="text-sm text-slate-500">איפה החשבון שלך מחובר עכשיו — טלפון שאבד או מחשב של מישהו אחר מנתקים מכאן</p>
                </div>
                <ChevronDown className={`w-5 h-5 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
            </button>

            {expanded && (
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                    {loading ? (
                        <p className="text-sm text-slate-400">טוען...</p>
                    ) : sessions.length === 0 ? (
                        <p className="text-sm text-slate-400">לא נמצאו מכשירים מחוברים</p>
                    ) : (
                        <ul className="space-y-2">
                            {sessions.map(s => (
                                <li key={s.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-slate-700">{describeDevice(s.user_agent)}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">
                                            מחובר מאז {formatSessionDate(s.session_started_at)} · פעיל לאחרונה {formatSessionDate(s.last_active_at)}
                                        </div>
                                    </div>
                                    <button type="button" onClick={() => revoke(s.id)} disabled={busy !== null}
                                        className="shrink-0 text-xs font-bold px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                                        {busy === s.id ? "..." : "ניתוק"}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {sessions.length > 1 && (
                        <button type="button" onClick={revokeOthers} disabled={busy !== null}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-bold hover:bg-red-50 disabled:opacity-50">
                            <LogOut className="w-4 h-4" aria-hidden /> {busy === "others" ? "מנתק..." : "ניתוק כל שאר המכשירים"}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
