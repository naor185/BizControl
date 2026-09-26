"use client";

import { useEffect, useState } from "react";
import { UserPlus, CheckCheck, X, Loader2, ShieldCheck, ArrowLeftRight } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Terms } from "@/lib/useTerms";
import { type Booking, type BookingStatus, type ClassSession, type SwapOptions, shekels, whenShort } from "@/lib/classes";
import ClientSearch, { type FoundClient } from "@/components/classes/ClientSearch";
import PayForm from "@/components/classes/PayForm";

// The class list inside a class: who is booked (and what covers each: a membership, a single entry),
// adding a client, attendance, cancelling a booking, moving it to another class (the entry and a single
// entry's payment move with it), and marking a late cancel or a no-show as justified.
// The server decides everything (spots, membership, the free-cancel window, the owner's rules, who may)
// — this asks and shows the answer. Attendance opens an hour before the class, as on the server.

type Perms = { book: boolean; override: boolean; mark: boolean };
type Eligibility = { required: boolean; membership: string | null; reason: string | null };

const STATUS: Record<BookingStatus, { label: string; cls: string } | null> = {
    booked: null,
    attended: { label: "הגיע/ה", cls: "text-emerald-800 bg-emerald-100" },
    no_show: { label: "לא הגיע/ה", cls: "text-rose-800 bg-rose-100" },
    late_canceled: { label: "ביטול מאוחר", cls: "text-amber-800 bg-amber-100" },
};
const chip = "text-[11px] font-semibold rounded-full px-1.5";

export default function SessionBookings({ s, terms, perms, onChanged }: {
    s: ClassSession; terms: Terms; perms: Perms; onChanged: (s: ClassSession) => void;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [cancelling, setCancelling] = useState<Booking | null>(null);
    const [moving, setMoving] = useState<Booking | null>(null);
    const [paying, setPaying] = useState<Booking | null>(null);
    const [now] = useState(() => Date.now());   // when the class was opened — decides which buttons show
    const list = s.bookings ?? [];
    const open = s.status === "scheduled";
    const attendance = perms.mark && (open || s.status === "done") && now >= new Date(s.starts_at).getTime() - 60 * 60 * 1000;
    const canAdd = perms.book && open && now < new Date(s.ends_at).getTime();
    const canMove = perms.book && open && now < new Date(s.starts_at).getTime();   // a swap — until the class starts

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

    const paySingle = async (b: Booking, p: { amount_cents: number; method: string; send_receipt: boolean }) => {
        setBusy(b.id);
        try {
            await apiFetch(`/api/classes/bookings/${b.id}/payments`, { method: "POST", body: JSON.stringify(p) });
            onChanged(await apiFetch<ClassSession>(`/api/classes/sessions/${s.id}`));
            setPaying(null);
            toast.success("התשלום נרשם");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
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
                        const st = STATUS[b.status];
                        const penalized = (b.status === "late_canceled" || b.status === "no_show") && !b.justified;
                        return (
                            <li key={b.id} className="px-3 py-2 flex items-center gap-2 min-h-12">
                                <div className="min-w-0 flex-1">
                                    <p className={`text-sm text-slate-900 truncate ${b.status === "late_canceled" ? "line-through decoration-slate-400" : ""}`}>{b.full_name}</p>
                                    <p className="flex flex-wrap gap-1 mt-0.5">
                                        {st && <span className={`${chip} ${st.cls}`}>{st.label}</span>}
                                        {b.justified && <span className={`${chip} text-slate-700 bg-slate-100`}>מוצדק</span>}
                                        {b.membership && <span className={`${chip} text-indigo-800 bg-indigo-50`}>{b.membership}</span>}
                                        {b.drop_in && (
                                            <span className={`${chip} ${b.paid_cents > 0 ? "text-emerald-800 bg-emerald-50" : "text-slate-700 bg-slate-100"}`}>
                                                כניסה בודדת{b.paid_cents > 0 ? ` · שולם ${shekels(b.paid_cents)}` : ""}
                                            </span>
                                        )}
                                        {b.over_capacity && <span className={`${chip} text-slate-700 bg-slate-100`}>מעל המקומות</span>}
                                        {b.fee && (
                                            <span className={`${chip} ${b.fee.status === "pending" ? "text-rose-800 bg-rose-50" : "text-slate-500 bg-slate-100 line-through"}`}>
                                                חיוב {shekels(b.fee.amount_cents)}{b.fee.status === "waived" ? " · נמחל" : ""}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                {perms.book && b.drop_in && b.paid_cents === 0 && b.status !== "late_canceled" && (
                                    <button type="button" onClick={() => setPaying(b)} disabled={busy !== null}
                                        className="min-h-9 px-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
                                        תשלום
                                    </button>
                                )}
                                {perms.book && penalized && (
                                    <button type="button" onClick={() => run(b.id, `/api/classes/bookings/${b.id}/justify`)} disabled={busy !== null}
                                        title="לא ייספר ולא יחויב, והכניסה תחזור"
                                        className="inline-flex items-center gap-1 min-h-9 px-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:border-slate-400 shrink-0">
                                        <ShieldCheck className="w-3.5 h-3.5" aria-hidden /> מוצדק
                                    </button>
                                )}
                                {attendance && b.status !== "late_canceled" && (
                                    <div className="flex gap-1 shrink-0" role="group" aria-label={`נוכחות: ${b.full_name}`}>
                                        {(["attended", "no_show"] as const).map(st2 => (
                                            <button key={st2} type="button" aria-pressed={b.status === st2} disabled={busy !== null}
                                                onClick={() => markOne(b, st2)}
                                                className={`min-h-9 px-2 rounded-lg text-xs font-semibold border ${b.status === st2
                                                    ? (st2 === "attended" ? "bg-emerald-600 border-emerald-600 text-white" : "bg-rose-600 border-rose-600 text-white")
                                                    : "border-slate-200 text-slate-600 hover:border-slate-400"}`}>
                                                {st2 === "attended" ? "הגיע/ה" : "לא הגיע/ה"}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {canMove && b.status === "booked" && (
                                    <button type="button" onClick={() => { setCancelling(null); setMoving(b); }} aria-label={`העברת ${b.full_name} לשיעור אחר`}
                                        title="העברה לשיעור אחר"
                                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-700 shrink-0">
                                        <ArrowLeftRight className="w-4 h-4" aria-hidden />
                                    </button>
                                )}
                                {perms.book && open && b.status === "booked" && !attendance && (
                                    <button type="button" onClick={() => { setMoving(null); setCancelling(b); }} aria-label={`ביטול ההרשמה של ${b.full_name}`}
                                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-700 shrink-0">
                                        <X className="w-4 h-4" aria-hidden />
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {paying && (
                <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-600">תשלום על כניסה בודדת: {paying.full_name}</p>
                    <PayForm defaultAmountCents={s.price_cents ?? 0} busy={busy !== null} onCancel={() => setPaying(null)}
                        onPay={p => paySingle(paying, p)} />
                </div>
            )}

            {cancelling && (
                <CancelBooking b={cancelling} busy={busy !== null} onBack={() => setCancelling(null)}
                    onConfirm={async waive => {
                        if (await run(cancelling.id, `/api/classes/bookings/${cancelling.id}/cancel`, { waive_late: waive })) setCancelling(null);
                    }} />
            )}

            {moving && (
                <MoveBooking b={moving} busy={busy !== null} onBack={() => setMoving(null)}
                    onMove={async (target, label) => {
                        if (await run(moving.id, `/api/classes/bookings/${moving.id}/swap`, { session_id: target })) {
                            toast.success(`${moving.full_name} הועבר/ה ל${label}`);
                            setMoving(null);
                        }
                    }} />
            )}

            {canAdd && !cancelling && !moving && (adding ? (
                <AddClient s={s} terms={terms} canOverride={perms.override} busy={busy !== null} onClose={() => setAdding(false)}
                    onBook={(clientId, extra) => run(`add-${clientId}`, `/api/classes/sessions/${s.id}/bookings`, { client_id: clientId, ...extra })}
                    onWait={clientId => run(`wait-${clientId}`, `/api/classes/sessions/${s.id}/waitlist`, { client_id: clientId })} />
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

/** Pick a client; the server says what covers them. Not covered → the reason, and a single paid entry.
 *  Full → owner/manager may book beyond the spots. */
function AddClient({ s, terms, canOverride, busy, onClose, onBook, onWait }: {
    s: ClassSession; terms: Terms; canOverride: boolean; busy: boolean; onClose: () => void;
    onBook: (clientId: string, extra: { over_capacity?: boolean; drop_in?: boolean }) => Promise<boolean>;
    onWait: (clientId: string) => Promise<boolean>;
}) {
    const [picked, setPicked] = useState<FoundClient | null>(null);
    const [check, setCheck] = useState<Eligibility | null>(null);
    const inList = new Set((s.bookings ?? []).filter(b => b.status !== "late_canceled").map(b => b.client_id));
    const waiting = new Set((s.waitlist ?? []).map(w => w.client_id));
    const full = (s.spots_left ?? s.capacity - s.booked) <= 0;
    const canWait = !!s.waitlist_enabled && full;

    const pick = async (c: FoundClient) => {
        setPicked(c);
        setCheck(null);
        try {
            const r = await apiFetch<Eligibility>(`/api/classes/sessions/${s.id}/eligibility?client_id=${c.id}`);
            setCheck(r);
            if (!full && (!r.required || r.membership) && await onBook(c.id, {})) { setPicked(null); onClose(); }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הבדיקה נכשלה");
        }
    };
    const book = async (extra: { over_capacity?: boolean; drop_in?: boolean }) => {
        if (picked && await onBook(picked.id, extra)) { setPicked(null); onClose(); }
    };
    const waitFor = async () => {
        if (picked && await onWait(picked.id)) { setPicked(null); onClose(); }
    };

    const notCovered = check && check.required && !check.membership;
    return (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-start gap-2">
                <div className="flex-1">
                    {picked ? (
                        <p className="text-sm font-semibold text-slate-900 min-h-11 flex items-center">{picked.full_name}</p>
                    ) : (
                        <ClientSearch terms={terms} busy={busy} onPick={pick}
                            note={id => (inList.has(id) ? "ברשימה" : waiting.has(id) ? "בהמתנה" : null)} />
                    )}
                </div>
                <button type="button" onClick={onClose} aria-label="סגירה" className="w-11 h-11 flex items-center justify-center text-slate-500">
                    <X className="w-4 h-4" aria-hidden />
                </button>
            </div>
            {picked && !check && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" aria-label="בודק" />}
            {picked && check && (
                <div className="space-y-2 text-sm text-slate-800">
                    {check.membership && <p>מכוסה ע״י: <span className="font-semibold">{check.membership}</span></p>}
                    {notCovered && <p className="text-amber-900 bg-amber-50 rounded-lg px-2 py-1.5">{check.reason}</p>}
                    {full && <p>השיעור מלא ({s.booked}/{s.capacity}){canWait ? " — אפשר להוסיף לרשימת ההמתנה." : "."}</p>}
                    <div className="flex flex-wrap gap-2">
                        {full && canOverride && (
                            <button type="button" disabled={busy} onClick={() => book({ over_capacity: true, drop_in: !!notCovered })}
                                className="min-h-11 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-40">
                                לרשום מעל המקומות{notCovered ? " (כניסה בודדת)" : ""}
                            </button>
                        )}
                        {!full && notCovered && (
                            <button type="button" disabled={busy} onClick={() => book({ drop_in: true })}
                                className="min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-40">
                                לרשום ככניסה בודדת
                            </button>
                        )}
                        {full && canWait && (
                            <button type="button" disabled={busy} onClick={() => waitFor()}
                                className="min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-40">
                                הוספה לרשימת ההמתנה
                            </button>
                        )}
                        {full && !canOverride && !canWait && <p className="text-slate-500">רישום מעל המקומות — רק לבעלים או למנהל.</p>}
                        <button type="button" onClick={() => { setPicked(null); setCheck(null); }} className="min-h-11 px-3 text-sm text-slate-600">
                            {terms.client} אחר/ת
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Move a booking to another class of the next two weeks — the server lists them and says why one is not
 *  possible (full, not covered by the membership…). */
function MoveBooking({ b, busy, onBack, onMove }: {
    b: Booking; busy: boolean; onBack: () => void; onMove: (sessionId: string, label: string) => void;
}) {
    const [opts, setOpts] = useState<SwapOptions | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    useEffect(() => {
        apiFetch<SwapOptions>(`/api/classes/bookings/${b.id}/swap-options`).then(setOpts)
            .catch(e => setFailed(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, [b.id]);
    return (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">להעביר את {b.full_name} לשיעור:</p>
                <button type="button" onClick={onBack} aria-label="סגירה" className="w-9 h-9 flex items-center justify-center text-slate-500">
                    <X className="w-4 h-4" aria-hidden />
                </button>
            </div>
            <p className="text-xs text-slate-500">לא נחשב ביטול מאוחר ואין חיוב. הכניסה עוברת לשיעור החדש, ותישלח הודעה.</p>
            {failed && <p className="text-sm text-rose-700">{failed}</p>}
            {!opts && !failed && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" aria-label="טוען" />}
            {opts && !opts.allowed && <p className="text-sm text-amber-900">{opts.reason}</p>}
            {opts?.allowed && (opts.sessions.length === 0 ? (
                <p className="text-sm text-slate-500">אין שיעורים בשבועיים הקרובים.</p>
            ) : (
                <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                    {opts.sessions.map(o => (
                        <li key={o.id}>
                            <button type="button" disabled={busy || !o.can_swap} onClick={() => onMove(o.id, `${o.name} · ${whenShort(o.starts_at)}`)}
                                className="w-full text-right px-3 py-2 min-h-12 flex items-center gap-2 hover:bg-indigo-50 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                                <span className="flex-1 min-w-0">
                                    <span className={`block text-sm font-semibold ${o.can_swap ? "text-slate-900" : "text-slate-400"}`}>{o.name}</span>
                                    <span className="block text-xs text-slate-500">{whenShort(o.starts_at)}</span>
                                </span>
                                <span className={`text-[11px] font-semibold shrink-0 ${o.can_swap ? "text-emerald-700" : "text-slate-400"}`}>
                                    {o.can_swap ? `${o.spots_left} מקומות` : o.why_not}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            ))}
        </div>
    );
}
