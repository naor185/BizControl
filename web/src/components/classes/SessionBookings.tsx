"use client";

import { useEffect, useState } from "react";
import { UserPlus, CheckCheck, X, Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Terms } from "@/lib/useTerms";
import type { Booking, BookingStatus, ClassSession } from "@/lib/classes";

// The class list inside a class: who is booked, adding a client, attendance and cancelling a booking.
// The server decides (spots, the free-cancel window, who may) — this only asks and shows the answer.
// Attendance opens an hour before the class, as on the server.

type Perms = { book: boolean; override: boolean; mark: boolean };
type Found = { id: string; full_name: string; phone: string | null };

const STATUS: Record<BookingStatus, { label: string; cls: string } | null> = {
    booked: null,
    attended: { label: "הגיע/ה", cls: "text-emerald-800 bg-emerald-100" },
    no_show: { label: "לא הגיע/ה", cls: "text-rose-800 bg-rose-100" },
    late_canceled: { label: "ביטול מאוחר", cls: "text-amber-800 bg-amber-100" },
};

export default function SessionBookings({ s, terms, perms, onChanged }: {
    s: ClassSession; terms: Terms; perms: Perms; onChanged: (s: ClassSession) => void;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [cancelling, setCancelling] = useState<Booking | null>(null);
    const list = s.bookings ?? [];
    const open = s.status === "scheduled";
    const [now] = useState(() => Date.now());   // when the class was opened — decides which buttons show
    const attendance = perms.mark && (open || s.status === "done") && now >= new Date(s.starts_at).getTime() - 60 * 60 * 1000;
    const canAdd = perms.book && open && now < new Date(s.ends_at).getTime();

    const run = async (key: string, path: string, body?: object) => {
        setBusy(key);
        try {
            onChanged(await apiFetch<ClassSession>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
            return true;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
            return false;
        } finally {
            setBusy(null);
        }
    };

    const markOne = (b: Booking, status: "attended" | "no_show") =>
        run(b.id, `/api/classes/bookings/${b.id}/attendance`, { status: b.status === status ? "booked" : status });

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-500">
                    {terms.client_plural} ברשימה <span className="tabular-nums">({s.booked}/{s.capacity})</span>
                </p>
                {attendance && list.some(b => b.status === "booked") && (
                    <button type="button" onClick={() => run("all", `/api/classes/sessions/${s.id}/attendance`)} disabled={busy !== null}
                        className="inline-flex items-center gap-1 min-h-9 px-2.5 rounded-lg text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100">
                        {busy === "all" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <CheckCheck className="w-3.5 h-3.5" aria-hidden />}
                        כולם הגיעו
                    </button>
                )}
            </div>

            {list.length === 0 ? (
                <p className="text-sm text-slate-400">אין רשומים</p>
            ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {list.map(b => {
                        const chip = STATUS[b.status];
                        return (
                            <li key={b.id} className="px-3 py-2 flex items-center gap-2 min-h-12">
                                <div className="min-w-0 flex-1">
                                    <p className={`text-sm text-slate-900 truncate ${b.status === "late_canceled" ? "line-through decoration-slate-400" : ""}`}>{b.full_name}</p>
                                    {(chip || b.over_capacity) && (
                                        <p className="flex gap-1 mt-0.5">
                                            {chip && <span className={`text-[11px] font-semibold rounded-full px-1.5 ${chip.cls}`}>{chip.label}</span>}
                                            {b.over_capacity && <span className="text-[11px] font-semibold rounded-full px-1.5 text-slate-700 bg-slate-100">מעל המקומות</span>}
                                        </p>
                                    )}
                                </div>
                                {attendance && b.status !== "late_canceled" && (
                                    <div className="flex gap-1 shrink-0" role="group" aria-label={`נוכחות: ${b.full_name}`}>
                                        {(["attended", "no_show"] as const).map(st => (
                                            <button key={st} type="button" aria-pressed={b.status === st} disabled={busy !== null}
                                                onClick={() => markOne(b, st)}
                                                className={`min-h-9 px-2 rounded-lg text-xs font-semibold border ${b.status === st
                                                    ? (st === "attended" ? "bg-emerald-600 border-emerald-600 text-white" : "bg-rose-600 border-rose-600 text-white")
                                                    : "border-slate-200 text-slate-600 hover:border-slate-400"}`}>
                                                {st === "attended" ? "הגיע/ה" : "לא הגיע/ה"}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {perms.book && open && b.status === "booked" && !attendance && (
                                    <button type="button" onClick={() => setCancelling(b)} aria-label={`ביטול ההרשמה של ${b.full_name}`}
                                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-700 shrink-0">
                                        <X className="w-4 h-4" aria-hidden />
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {cancelling && (
                <CancelBooking b={cancelling} busy={busy !== null} onBack={() => setCancelling(null)}
                    onConfirm={async waive => {
                        if (await run(cancelling.id, `/api/classes/bookings/${cancelling.id}/cancel`, { waive_late: waive })) setCancelling(null);
                    }} />
            )}

            {canAdd && !cancelling && (adding ? (
                <AddClient s={s} terms={terms} canOverride={perms.override} busy={busy !== null} onClose={() => setAdding(false)}
                    onBook={async (clientId, over) => run(`add-${clientId}`, `/api/classes/sessions/${s.id}/bookings`, { client_id: clientId, over_capacity: over })} />
            ) : (
                <button type="button" onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-700 hover:border-indigo-400 hover:text-indigo-700">
                    <UserPlus className="w-4 h-4" aria-hidden /> הוספה לשיעור
                </button>
            ))}
        </div>
    );
}

function CancelBooking({ b, busy, onBack, onConfirm }: { b: Booking; busy: boolean; onBack: () => void; onConfirm: (waive: boolean) => void }) {
    const [waive, setWaive] = useState(false);
    return (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 space-y-2">
            <p className="text-sm text-slate-800">לבטל את ההרשמה של {b.full_name}? תישלח הודעה על הביטול.</p>
            <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={waive} onChange={e => setWaive(e.target.checked)} className="mt-1" />
                <span>בלי שייחשב כביטול מאוחר (למשל סיבה מוצדקת)</span>
            </label>
            <div className="flex gap-2">
                <button type="button" onClick={() => onConfirm(waive)} disabled={busy}
                    className="min-h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-40">
                    לבטל את ההרשמה
                </button>
                <button type="button" onClick={onBack} className="min-h-11 px-3 rounded-xl text-sm text-slate-600">חזרה</button>
            </div>
        </div>
    );
}

function AddClient({ s, terms, canOverride, busy, onClose, onBook }: {
    s: ClassSession; terms: Terms; canOverride: boolean; busy: boolean; onClose: () => void;
    onBook: (clientId: string, over: boolean) => Promise<boolean>;
}) {
    const [q, setQ] = useState("");
    const [found, setFound] = useState<Found[]>([]);
    const [full, setFull] = useState<Found | null>(null);
    const inList = new Set((s.bookings ?? []).filter(b => b.status !== "late_canceled").map(b => b.client_id));

    useEffect(() => {
        const term = q.trim();
        const t = setTimeout(() => {
            if (term.length < 2) { setFound([]); return; }
            apiFetch<Found[]>(`/api/clients?q=${encodeURIComponent(term)}&limit=8`).then(setFound).catch(() => setFound([]));
        }, 250);
        return () => clearTimeout(t);
    }, [q]);

    const pick = async (c: Found) => {
        if (s.booked >= s.capacity) { setFull(c); return; }
        if (await onBook(c.id, false)) { setQ(""); setFound([]); }
    };

    return (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center gap-2">
                <label className="relative flex-1">
                    <span className="sr-only">חיפוש {terms.client}</span>
                    <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" aria-hidden />
                    <input value={q} onChange={e => { setQ(e.target.value); setFull(null); }} autoFocus placeholder="שם או טלפון"
                        className="w-full min-h-11 rounded-xl border border-slate-200 pr-9 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </label>
                <button type="button" onClick={onClose} aria-label="סגירה" className="w-11 h-11 flex items-center justify-center text-slate-500">
                    <X className="w-4 h-4" aria-hidden />
                </button>
            </div>
            {full ? (
                <div className="text-sm text-slate-800 space-y-2">
                    <p>השיעור מלא ({s.booked}/{s.capacity}).</p>
                    {canOverride ? (
                        <button type="button" disabled={busy} onClick={async () => { if (await onBook(full.id, true)) { setFull(null); setQ(""); } }}
                            className="min-h-11 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-40">
                            לרשום את {full.full_name} מעל המקומות
                        </button>
                    ) : <p className="text-slate-500">רישום מעל המקומות — רק לבעלים או למנהל.</p>}
                </div>
            ) : (
                <ul className="max-h-56 overflow-y-auto">
                    {found.map(c => (
                        <li key={c.id}>
                            <button type="button" disabled={busy || inList.has(c.id)} onClick={() => pick(c)}
                                className="w-full flex items-center justify-between gap-2 px-2 min-h-11 rounded-lg text-right hover:bg-slate-50 disabled:opacity-50">
                                <span className="text-sm text-slate-900 truncate">{c.full_name}</span>
                                <span className="text-xs text-slate-500 tabular-nums" dir="ltr">{inList.has(c.id) ? "ברשימה" : c.phone}</span>
                            </button>
                        </li>
                    ))}
                    {q.trim().length >= 2 && found.length === 0 && <li className="px-2 py-2 text-sm text-slate-400">לא נמצאו</li>}
                </ul>
            )}
        </div>
    );
}
