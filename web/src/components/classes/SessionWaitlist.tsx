"use client";

import { useState } from "react";
import { ArrowUp, X, Check, Hourglass } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { type ClassSession, ilTime } from "@/lib/classes";

// A full class's waitlist, for the staff: who waits and in which order, moving someone up, taking
// someone off, and taking an offered spot for a client. The server moves the line up by itself when a
// spot frees up (the owner's mode: booked at once, or offered for a confirm window).

export default function SessionWaitlist({ s, canManage, onChanged }: {
    s: ClassSession; canManage: boolean; onChanged: (s: ClassSession) => void;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const line = s.waitlist ?? [];
    if (!s.waitlist_enabled || line.length === 0) return null;

    const run = async (key: string, path: string, body?: object) => {
        setBusy(key);
        try {
            onChanged(await apiFetch<ClassSession>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Hourglass className="w-3.5 h-3.5" aria-hidden /> רשימת המתנה ({line.length})
            </p>
            <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {line.map(w => (
                    <li key={w.id} className="px-3 py-2 flex items-center gap-2 min-h-12">
                        <span className="w-6 text-center text-xs font-bold text-slate-400 tabular-nums">{w.position}</span>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-900 truncate">{w.full_name}</p>
                            {w.status === "notified" && w.offer_expires_at && (
                                <p className="text-[11px] font-semibold text-amber-800">הוצע מקום — מחכה לאישור עד <span dir="ltr">{ilTime(w.offer_expires_at)}</span></p>
                            )}
                        </div>
                        {canManage && (
                            <div className="flex items-center gap-1 shrink-0">
                                {w.status === "notified" && (
                                    <button type="button" disabled={busy !== null} onClick={() => run(w.id, `/api/classes/waitlist/${w.id}/confirm`, {})}
                                        className="inline-flex items-center gap-1 min-h-9 px-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white">
                                        <Check className="w-3.5 h-3.5" aria-hidden /> לרשום
                                    </button>
                                )}
                                {w.position > 1 && (
                                    <button type="button" disabled={busy !== null} aria-label={`להקדים את ${w.full_name}`}
                                        onClick={() => run(w.id, `/api/classes/waitlist/${w.id}/move`, { position: w.position - 1 })}
                                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-indigo-700">
                                        <ArrowUp className="w-4 h-4" aria-hidden />
                                    </button>
                                )}
                                <button type="button" disabled={busy !== null} aria-label={`להוציא את ${w.full_name} מהרשימה`}
                                    onClick={() => run(w.id, `/api/classes/waitlist/${w.id}/leave`)}
                                    className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-700">
                                    <X className="w-4 h-4" aria-hidden />
                                </button>
                            </div>
                        )}
                    </li>
                ))}
            </ol>
            <p className="text-xs text-slate-500">כשמתפנה מקום הוא עובר לראשון/ה ברשימה — לפי ההגדרה בהגדרות השיעורים.</p>
        </div>
    );
}
