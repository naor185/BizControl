"use client";

import { useCallback, useEffect, useState } from "react";
import { GraduationCap, UserPlus, X, Loader2, Check, Hourglass } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Terms } from "@/lib/useTerms";
import { type CourseView, type CourseEnrollment, ilTime, shekels } from "@/lib/classes";
import ClientSearch, { type FoundClient } from "@/components/classes/ClientSearch";
import PayForm from "@/components/classes/PayForm";

// A course inside one of its sessions: registration for the whole course (one price for all the sessions),
// who is registered and what they paid, cancelling a registration (the refund the owner's rule gives), recording
// a payment or a refund, and the course's own waitlist. The server decides everything — this asks and shows.

type Perms = { book: boolean; override: boolean; refund: boolean };
type Panel = { kind: "pay" | "cancel" | "refund"; e: CourseEnrollment } | null;

export default function CourseEnrollments({ templateId, terms, perms, onChanged }: {
    templateId: string; terms: Terms; perms: Perms; onChanged: () => void;
}) {
    const [c, setC] = useState<CourseView | null>(null);
    const [busy, setBusy] = useState(false);
    const [adding, setAdding] = useState(false);
    const [panel, setPanel] = useState<Panel>(null);

    const load = useCallback(() => {
        apiFetch<CourseView>(`/api/classes/courses/${templateId}`).then(setC).catch(() => setC(null));
    }, [templateId]);
    useEffect(() => { load(); }, [load]);

    const run = async (path: string, body: object | undefined, ok: string) => {
        setBusy(true);
        try {
            const next = await apiFetch<CourseView & { result?: { refund_due_cents: number | null } }>(path,
                { method: "POST", body: body ? JSON.stringify(body) : undefined });
            setC(next);
            toast.success(ok);
            onChanged();
            return next;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
            return null;
        } finally {
            setBusy(false);
        }
    };

    if (!c) return null;
    const active = c.enrollments.filter(e => e.status === "active");
    const line = c.enrollments.filter(e => e.status === "waiting" || e.status === "offered");
    const gone = c.enrollments.filter(e => e.status === "canceled" && e.paid_cents - e.refunded_cents > 0);
    const full = c.spots <= 0;

    return (
        <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-3 space-y-3" aria-labelledby="course-title">
            <div>
                <h3 id="course-title" className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <GraduationCap className="w-4 h-4 text-violet-700" aria-hidden /> קורס · הרשמה לכל המפגשים
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                    {c.sessions_total} מפגשים · נשארו {c.sessions_left} · רשומים {c.enrolled}/{c.capacity}
                    {c.covered_by_membership ? " · במנוי" : c.price_cents != null ? ` · ${shekels(c.price_cents)} לקורס` : " · אין מחיר לקורס"}
                    {!c.covered_by_membership && c.price_now_cents != null && c.price_now_cents !== c.price_cents ? ` (הצטרפות עכשיו: ${shekels(c.price_now_cents)})` : ""}
                </p>
            </div>

            {active.length > 0 && (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                    {active.map(e => {
                        const due = Math.max(0, e.price_cents - e.paid_cents + e.refunded_cents);
                        return (
                            <li key={e.id} className="px-3 py-2 flex items-center gap-2 min-h-12">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm text-slate-900 truncate">{e.full_name}</p>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                        {e.price_cents ? `${shekels(e.price_cents)} · ` : ""}{e.sessions_total} מפגשים
                                        {e.paid_cents > 0 && <span className="text-emerald-700"> · שולם {shekels(e.paid_cents)}</span>}
                                        {due > 0 && <span className="text-amber-800"> · יתרה {shekels(due)}</span>}
                                    </p>
                                </div>
                                {perms.book && due > 0 && (
                                    <button type="button" disabled={busy} onClick={() => setPanel({ kind: "pay", e })}
                                        className="min-h-9 px-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">תשלום</button>
                                )}
                                {perms.book && (
                                    <button type="button" disabled={busy} onClick={() => setPanel({ kind: "cancel", e })} aria-label={`ביטול ההרשמה של ${e.full_name} לקורס`}
                                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-700 shrink-0">
                                        <X className="w-4 h-4" aria-hidden />
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {panel?.kind === "pay" && (
                <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-600">תשלום על הקורס: {panel.e.full_name}</p>
                    <PayForm defaultAmountCents={Math.max(0, panel.e.price_cents - panel.e.paid_cents + panel.e.refunded_cents)} busy={busy}
                        onCancel={() => setPanel(null)}
                        onPay={async p => { if (await run(`/api/classes/enrollments/${panel.e.id}/payments`, p, "התשלום נרשם")) setPanel(null); }} />
                </div>
            )}

            {panel?.kind === "cancel" && (
                <CancelEnrollment e={panel.e} busy={busy} onBack={() => setPanel(null)}
                    onConfirm={async reason => {
                        const next = await run(`/api/classes/enrollments/${panel.e.id}/cancel`, { reason }, `ההרשמה של ${panel.e.full_name} לקורס בוטלה`);
                        if (!next) return;
                        const after = next.enrollments.find(x => x.id === panel.e.id);
                        const due = next.result?.refund_due_cents;
                        // money was paid — offer to record the refund (the rule's amount, or the owner's own)
                        setPanel(perms.refund && after && after.paid_cents - after.refunded_cents > 0
                            ? { kind: "refund", e: { ...after, refund_due_cents: due ?? null } } : null);
                    }} />
            )}

            {panel?.kind === "refund" && (
                <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-600">
                        החזר על הקורס: {panel.e.full_name}
                        {panel.e.refund_due_cents != null ? ` · לפי הכלל: ${shekels(panel.e.refund_due_cents)}` : " · הסכום לפי החלטתך"}
                    </p>
                    <PayForm refund defaultAmountCents={panel.e.refund_due_cents ?? panel.e.paid_cents - panel.e.refunded_cents} busy={busy}
                        onCancel={() => setPanel(null)}
                        onPay={async p => {
                            if (await run(`/api/classes/enrollments/${panel.e.id}/refund`, { amount_cents: p.amount_cents, method: p.method }, "ההחזר נרשם")) setPanel(null);
                        }} />
                </div>
            )}

            {perms.refund && gone.length > 0 && !panel && (
                <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-semibold">בוטלו — שולם ולא הוחזר:</p>
                    {gone.map(e => (
                        <button key={e.id} type="button" onClick={() => setPanel({ kind: "refund", e })}
                            className="block text-indigo-700 hover:text-indigo-900 underline-offset-2 hover:underline">
                            {e.full_name} · {shekels(e.paid_cents - e.refunded_cents)} — רישום החזר
                        </button>
                    ))}
                </div>
            )}

            {line.length > 0 && (
                <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Hourglass className="w-3.5 h-3.5" aria-hidden /> רשימת המתנה לקורס ({line.length})</p>
                    <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                        {line.map((e, i) => (
                            <li key={e.id} className="px-3 py-2 flex items-center gap-2 min-h-11">
                                <span className="w-5 text-center text-xs font-bold text-slate-400 tabular-nums">{i + 1}</span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm text-slate-900 truncate">{e.full_name}</p>
                                    {e.status === "offered" && e.offer_expires_at && (
                                        <p className="text-[11px] font-semibold text-amber-800">הוצע מקום — מחכה לאישור עד <span dir="ltr">{ilTime(e.offer_expires_at)}</span></p>
                                    )}
                                </div>
                                {perms.book && e.status === "offered" && (
                                    <button type="button" disabled={busy} onClick={() => run(`/api/classes/enrollments/${e.id}/take`, undefined, `${e.full_name} נרשם/ה לקורס`)}
                                        className="inline-flex items-center gap-1 min-h-9 px-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white">
                                        <Check className="w-3.5 h-3.5" aria-hidden /> לרשום
                                    </button>
                                )}
                                {perms.book && (
                                    <button type="button" disabled={busy} aria-label={`להוציא את ${e.full_name} מרשימת ההמתנה`}
                                        onClick={() => run(`/api/classes/enrollments/${e.id}/leave`, undefined, "הוצא/ה מרשימת ההמתנה")}
                                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-700">
                                        <X className="w-4 h-4" aria-hidden />
                                    </button>
                                )}
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {perms.book && c.sessions_left > 0 && !panel && (adding ? (
                <AddToCourse c={c} terms={terms} canPrice={perms.override} busy={busy} onClose={() => setAdding(false)}
                    onEnroll={async (client, price) => {
                        if (await run(`/api/classes/courses/${templateId}/enrollments`, { client_id: client.id, ...(price != null ? { price_cents: price } : {}) },
                            `${client.full_name} נרשם/ה לקורס`)) setAdding(false);
                    }}
                    onWait={async client => {
                        if (await run(`/api/classes/courses/${templateId}/waitlist`, { client_id: client.id }, `${client.full_name} ברשימת ההמתנה לקורס`)) setAdding(false);
                    }} />
            ) : (
                <button type="button" onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border border-dashed border-violet-300 text-sm font-semibold text-violet-800 hover:border-violet-500">
                    <UserPlus className="w-4 h-4" aria-hidden /> {full ? "הקורס מלא — רשימת המתנה" : "הרשמה לקורס"}
                </button>
            ))}
        </section>
    );
}

function CancelEnrollment({ e, busy, onBack, onConfirm }: { e: CourseEnrollment; busy: boolean; onBack: () => void; onConfirm: (reason: string) => void }) {
    const [reason, setReason] = useState("");
    return (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 space-y-2">
            <p className="text-sm text-slate-800">
                לבטל את ההרשמה של {e.full_name} לקורס? המפגשים שעוד לא התקיימו יבוטלו ותישלח הודעה.
                {e.refund_due_cents != null ? ` לפי הכלל מגיע החזר של ${shekels(e.refund_due_cents)}.` : ""}
            </p>
            <input value={reason} onChange={x => setReason(x.target.value)} maxLength={300} placeholder="סיבה (לא חובה)"
                className="w-full rounded-xl border border-slate-200 px-3 min-h-11 text-sm bg-white" />
            <div className="flex gap-2">
                <button type="button" onClick={() => onConfirm(reason)} disabled={busy}
                    className="min-h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-40">לבטל את ההרשמה</button>
                <button type="button" onClick={onBack} className="min-h-11 px-3 rounded-xl text-sm text-slate-600">חזרה</button>
            </div>
        </div>
    );
}

function AddToCourse({ c, terms, canPrice, busy, onClose, onEnroll, onWait }: {
    c: CourseView; terms: Terms; canPrice: boolean; busy: boolean; onClose: () => void;
    onEnroll: (client: FoundClient, priceCents: number | null) => void; onWait: (client: FoundClient) => void;
}) {
    const [picked, setPicked] = useState<FoundClient | null>(null);
    const [price, setPrice] = useState<number | "">("");
    const inCourse = new Set(c.enrollments.filter(e => e.status !== "canceled" && e.status !== "expired").map(e => e.client_id));
    const full = c.spots <= 0;
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <div className="flex items-start gap-2">
                <div className="flex-1">
                    {picked ? <p className="text-sm font-semibold text-slate-900 min-h-11 flex items-center">{picked.full_name}</p>
                        : <ClientSearch terms={terms} busy={busy} onPick={setPicked} note={id => (inCourse.has(id) ? "בקורס" : null)} />}
                </div>
                <button type="button" onClick={onClose} aria-label="סגירה" className="w-11 h-11 flex items-center justify-center text-slate-500"><X className="w-4 h-4" aria-hidden /></button>
            </div>
            {picked && (
                <div className="flex flex-wrap items-end gap-2">
                    {!full && canPrice && !c.covered_by_membership && (
                        <label className="text-xs text-slate-600">מחיר אחר (₪, לא חובה)
                            <input type="number" min={0} dir="ltr" value={price} placeholder={c.price_now_cents != null ? String(c.price_now_cents / 100) : ""}
                                onChange={e => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
                                className="block mt-1 w-28 min-h-10 rounded-lg border border-slate-200 text-center tabular-nums" />
                        </label>
                    )}
                    {full ? (
                        c.waitlist_enabled ? (
                            <button type="button" disabled={busy} onClick={() => onWait(picked)}
                                className="min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-40">הוספה לרשימת ההמתנה</button>
                        ) : <p className="text-sm text-slate-500">הקורס מלא.</p>
                    ) : (
                        <button type="button" disabled={busy} onClick={() => onEnroll(picked, price === "" ? null : Math.round(price * 100))}
                            className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-40">
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} הרשמה לכל המפגשים
                        </button>
                    )}
                    <button type="button" onClick={() => setPicked(null)} className="min-h-11 px-3 text-sm text-slate-600">{terms.client} אחר/ת</button>
                </div>
            )}
        </div>
    );
}
