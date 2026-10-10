"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, HeartPulse, PenLine, Printer, Send, Trash2, TriangleAlert, X } from "lucide-react";
import { API_BASE, apiFetch, getToken } from "@/lib/api";
import { toast } from "@/lib/toast";
import HealthFormFill, { type ClientPart, type HealthAnswer, type HealthFormView } from "./HealthFormFill";
import SignaturePad from "./SignaturePad";

// The health declarations of an appointment, or of a client (their file) — and the full screen they're signed on:
// the client fills and signs on the studio's device (or from a link sent on WhatsApp, app/health/[token]),
// hands it over, and the one giving the service signs.
// The rules: app/services/health_forms.py.

export type DeclarationRow = {
    id: string; status: "waiting_client" | "waiting_performer" | "signed"; title: string;
    appointment_id: string | null; appointment_at: string | null; appointment_title: string | null;
    client_signed_at: string | null; client_signed_via: "studio" | "link" | null; performer_name: string | null;
    performer_signed_at: string | null; link_sent_at: string | null; created_at: string | null; flagged: string[];
    link: string | null;          // while it waits for the client
};
export type Declaration = DeclarationRow & HealthFormView & {
    answers: Record<string, HealthAnswer> | null; id_number: string | null;
    client_signature: string | null; performer_signature: string | null; client_id: string; client_phone: string | null;
};

const STATUS: Record<DeclarationRow["status"], { label: string; cls: string }> = {
    waiting_client:    { label: "ממתין למילוי הלקוח", cls: "bg-slate-100 text-slate-600" },
    waiting_performer: { label: "ממתין לחתימת המבצע", cls: "bg-amber-50 text-amber-800" },
    signed:            { label: "חתום",                cls: "bg-emerald-50 text-emerald-700" },
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "");

// a file of the form, fetched with the signed-in user's token (it isn't at an open address)
export function useFormFile(fileId: string | null | undefined): string | null {
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
        if (!fileId) return;
        let url: string | null = null;
        let gone = false;
        fetch(`${API_BASE}/api/health-form/files/${fileId}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
            .then(r => (r.ok ? r.blob() : Promise.reject()))
            .then(b => { if (!gone) { url = URL.createObjectURL(b); setSrc(url); } })
            .catch(() => { if (!gone) setSrc(null); });
        return () => { gone = true; if (url) URL.revokeObjectURL(url); };
    }, [fileId]);
    return fileId ? src : null;
}

function SignFlow({ declarationId, onClose }: { declarationId: string; onClose: () => void }) {
    const [d, setD] = useState<Declaration | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [handedOver, setHandedOver] = useState(false);
    const [signature, setSignature] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const fileSrc = useFormFile(d?.file?.id);

    useEffect(() => {
        apiFetch<Declaration>(`/api/health-declarations/${declarationId}`).then(setD)
            .catch(e => setErr(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, [declarationId]);

    const clientSigns = async (part: ClientPart) => {
        setD(await apiFetch<Declaration>(`/api/health-declarations/${declarationId}/client`, { method: "POST", body: JSON.stringify(part) }));
        window.scrollTo({ top: 0 });
    };
    const performerSigns = async () => {
        if (!signature) return;
        setSaving(true); setErr(null);
        try {
            setD(await apiFetch<Declaration>(`/api/health-declarations/${declarationId}/performer`, { method: "POST", body: JSON.stringify({ signature }) }));
        } catch (e) {
            setErr(e instanceof Error ? e.message : "החתימה נכשלה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] bg-slate-50 overflow-y-auto" role="dialog" aria-modal="true">
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
                <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between" dir="rtl">
                    <span className="inline-flex items-center gap-2 font-bold text-slate-900"><HeartPulse className="h-5 w-5 text-rose-600" aria-hidden /> הצהרת בריאות</span>
                    <button onClick={onClose} aria-label="סגירה" className="p-2 -m-2 text-slate-500 hover:text-slate-900"><X className="h-6 w-6" /></button>
                </div>
            </div>
            <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
                {!d ? (
                    <p className="text-center text-slate-400 py-16">{err ?? "טוען..."}</p>
                ) : d.status === "waiting_client" ? (
                    <HealthFormFill form={d} fileSrc={fileSrc} onSubmit={clientSigns} />
                ) : d.status === "waiting_performer" && !handedOver && d.client_signed_via === "studio" ? (
                    <div className="text-center space-y-6 py-16">
                        <Check className="h-14 w-14 mx-auto text-emerald-600" aria-hidden />
                        <div>
                            <p className="text-2xl font-black text-slate-900">תודה, {d.client_name}!</p>
                            <p className="text-slate-600 mt-2">אפשר להחזיר את המכשיר לצוות.</p>
                        </div>
                        <button onClick={() => setHandedOver(true)} className="px-6 py-3 rounded-2xl bg-slate-900 text-white font-bold">
                            המשך לחתימת המבצע
                        </button>
                    </div>
                ) : d.status === "waiting_performer" ? (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-xl font-black text-slate-900">חתימת המבצע</h2>
                            <p className="text-sm text-slate-600 mt-1">{d.client_name} מילא/ה וחתם/ה {when(d.client_signed_at)}{d.client_signed_via === "link" ? " מהטלפון" : ""}.</p>
                        </div>
                        <Answers d={d} />
                        <SignaturePad label="חתימת המבצע" onChange={setSignature} />
                        {err && <p className="text-sm text-rose-600">{err}</p>}
                        <button onClick={performerSigns} disabled={!signature || saving}
                            className="w-full py-4 rounded-2xl bg-slate-900 text-white text-lg font-bold disabled:opacity-40">
                            {saving ? "שומר..." : "חתימה ושמירה"}
                        </button>
                    </div>
                ) : (
                    <div className="text-center space-y-6 py-16">
                        <Check className="h-14 w-14 mx-auto text-emerald-600" aria-hidden />
                        <p className="text-2xl font-black text-slate-900">ההצהרה חתומה ונשמרה</p>
                        <p className="text-slate-600">בתור ובתיק של {d.client_name}.</p>
                        <div className="flex justify-center gap-3">
                            <Link href={`/health-declarations/${d.id}`} className="px-5 py-3 rounded-2xl bg-slate-100 font-bold text-slate-800 inline-flex items-center gap-2">
                                <Printer className="h-4 w-4" aria-hidden /> צפייה והדפסה
                            </Link>
                            <button onClick={onClose} className="px-6 py-3 rounded-2xl bg-slate-900 text-white font-bold">סיום</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// the client's answers — "yes" marked, so the one giving the service sees it first
export function Answers({ d }: { d: Declaration }) {
    return (
        <ol className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {d.questions.map((q, i) => {
                const a = d.answers?.[q.id] ?? {};
                const yes = a.answer === "yes";
                return (
                    <li key={q.id} className={`px-4 py-3 ${yes ? "bg-amber-50" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                            <p className="text-sm text-slate-800"><span className="text-slate-400 tabular-nums ml-1">{i + 1}.</span>{q.text}</p>
                            {q.kind === "yes_no" && (
                                <span className={`shrink-0 text-sm font-bold ${yes ? "text-amber-800" : "text-slate-500"}`}>{yes ? "כן" : "לא"}</span>
                            )}
                        </div>
                        {(a.details || a.text) && <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{a.details || a.text}</p>}
                    </li>
                );
            })}
        </ol>
    );
}

type Overview = { enabled: boolean; in_force: { id: string; client_signed_at: string } | null; rows: DeclarationRow[] };

// boxClassName: the frame around it — not drawn at all when the business turned the declaration off and there's
// nothing to show
export default function HealthDeclarations({ clientId, appointmentId, boxClassName = "" }: {
    clientId: string; appointmentId?: string; boxClassName?: string;
}) {
    const [rows, setRows] = useState<DeclarationRow[] | null>(null);
    const [enabled, setEnabled] = useState(true);
    const [inForce, setInForce] = useState<Overview["in_force"]>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const load = useCallback(() => {
        const q = appointmentId ? `appointment_id=${appointmentId}` : `client_id=${clientId}`;
        apiFetch<Overview>(`/api/health-declarations?${q}`)
            .then(o => { setRows(o.rows); setEnabled(o.enabled); setInForce(o.in_force); })
            .catch(() => setRows([]));
    }, [clientId, appointmentId]);
    useEffect(() => { load(); }, [load]);

    // open one (an appointment's open one is reused) — to fill now on this device, or to send the link
    const start = async (then: "fill" | "send") => {
        setBusy(true); setErr(null);
        try {
            const d = await apiFetch<Declaration>("/api/health-declarations", {
                method: "POST", body: JSON.stringify({ client_id: clientId, appointment_id: appointmentId ?? null }),
            });
            if (then === "fill") setOpen(d.id);
            else await sendLink(d.id);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "הפתיחה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    const sendLink = async (id: string) => {
        setErr(null);
        try {
            await apiFetch(`/api/health-declarations/${id}/send-link`, { method: "POST" });
            toast.success("הקישור נשלח ללקוח ב-WhatsApp");
        } catch (e) {
            setErr(e instanceof Error ? e.message : "השליחה נכשלה");
        }
        load();
    };
    const copyLink = async (link: string) => {
        try {
            await navigator.clipboard.writeText(link);
            toast.success("הקישור הועתק");
        } catch {
            window.prompt("העתיקו את הקישור:", link);
        }
    };
    const remove = async (id: string) => {
        if (!window.confirm("למחוק את ההצהרה שעוד לא מולאה?")) return;
        try {
            await apiFetch(`/api/health-declarations/${id}`, { method: "DELETE" });
            load();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "המחיקה נכשלה");
        }
    };

    const pending = rows?.some(r => r.status !== "signed");
    if (rows === null || (!enabled && rows.length === 0)) return null;
    // a declaration the client filled that still counts — from another appointment (on this one it's in the list)
    const forceElsewhere = inForce && !rows.some(r => r.id === inForce.id) ? inForce : null;
    return (
        <div className={`space-y-2 ${boxClassName}`} dir="rtl">
            <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                    <HeartPulse className="h-4 w-4 text-rose-600" aria-hidden /> הצהרת בריאות
                </span>
                {enabled && !(appointmentId && pending) && (
                    <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => start("send")} disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 disabled:opacity-50">
                            <Send className="h-3.5 w-3.5" aria-hidden /> שליחת קישור
                        </button>
                        <button type="button" onClick={() => start("fill")} disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50">
                            <PenLine className="h-3.5 w-3.5" aria-hidden /> {busy ? "רגע..." : (rows.length && appointmentId) || forceElsewhere ? "הצהרה חדשה" : "מילוי וחתימה"}
                        </button>
                    </div>
                )}
            </div>
            {err && <p className="text-xs text-rose-600">{err}</p>}
            {forceElsewhere && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 rounded-lg px-2.5 py-1.5">
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    יש הצהרה בתוקף מ-{new Date(forceElsewhere.client_signed_at).toLocaleDateString("he-IL")} — לא צריך חדשה.
                    <Link href={`/health-declarations/${forceElsewhere.id}`} className="font-bold underline mr-auto">צפייה</Link>
                </p>
            )}
            {rows.length === 0 ? (
                !forceElsewhere && <p className="text-xs text-slate-400">עוד לא נחתמה הצהרת בריאות{appointmentId ? " לתור הזה" : ""}.</p>
            ) : (
                <ul className="space-y-2">
                    {rows.map(r => (
                        <li key={r.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap text-xs">
                                    <span className={`font-bold px-2 py-0.5 rounded-full ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                                    {!appointmentId && inForce?.id === r.id && <span className="font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white">בתוקף</span>}
                                    <span className="text-slate-500">
                                        {r.status === "signed" ? `נחתם ${when(r.performer_signed_at)}`
                                            : r.status === "waiting_performer" ? `הלקוח חתם ${when(r.client_signed_at)}${r.client_signed_via === "link" ? " מהטלפון" : ""}`
                                            : r.link_sent_at ? `קישור נשלח ${when(r.link_sent_at)}` : `נפתח ${when(r.created_at)}`}
                                        {!appointmentId && r.appointment_at ? ` · לתור ${new Date(r.appointment_at).toLocaleDateString("he-IL")}` : ""}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    {r.status === "signed" ? (
                                        <Link href={`/health-declarations/${r.id}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100">
                                            <Printer className="h-3.5 w-3.5" aria-hidden /> צפייה
                                        </Link>
                                    ) : (
                                        <button type="button" onClick={() => setOpen(r.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-900 text-white">
                                            <PenLine className="h-3.5 w-3.5" aria-hidden /> {r.status === "waiting_client" ? "מילוי וחתימה" : "חתימת המבצע"}
                                        </button>
                                    )}
                                    {r.status === "waiting_client" && r.link && (
                                        <>
                                            <button type="button" onClick={() => sendLink(r.id)} title={r.link_sent_at ? "לשלוח שוב ב-WhatsApp" : "שליחה ב-WhatsApp"}
                                                aria-label={r.link_sent_at ? "לשלוח שוב ב-WhatsApp" : "שליחה ב-WhatsApp"}
                                                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                                                <Send className="h-3.5 w-3.5" />
                                            </button>
                                            <button type="button" onClick={() => copyLink(r.link as string)} title="העתקת הקישור" aria-label="העתקת הקישור"
                                                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                                                <Copy className="h-3.5 w-3.5" />
                                            </button>
                                        </>
                                    )}
                                    {r.status === "waiting_client" && (
                                        <button type="button" onClick={() => remove(r.id)} aria-label="מחיקה" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            {r.flagged.length > 0 && (
                                <p className="flex items-start gap-1.5 text-xs text-amber-800">
                                    <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                                    <span>סימן/ה &quot;כן&quot;: {r.flagged.join(" · ")}</span>
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {open && <SignFlow declarationId={open} onClose={() => { setOpen(null); load(); }} />}
        </div>
    );
}
