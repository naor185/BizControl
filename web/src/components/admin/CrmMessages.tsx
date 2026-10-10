"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Mail, MessageCircle, Send, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

// Messages from the company to the businesses' owners — the superadmin's CRM, part ב
// (app/services/platform_outreach.py, /api/admin/crm/templates|send|sent): the compose window, the templates, and the log.

export type CrmRecipient = {
    id: string; name: string; owner_name: string; owner_phone: string | null; owner_email: string | null;
    plan_label: string; days_left: number | null;
};
type Template = { key: string; name: string; email_subject: string; body: string };
type Sent = {
    id: string; channel: string; to: string; subject: string | null; body: string; status: string; error: string | null;
    created_at: string | null; sent_at: string | null; studio_id: string; studio_name: string;
};
type Channel = "whatsapp" | "email" | "both";

const CHANNELS: { key: Channel; label: string }[] = [
    { key: "whatsapp", label: "WhatsApp" }, { key: "email", label: "מייל" }, { key: "both", label: "WhatsApp + מייל" },
];
const FIELDS = [
    { key: "owner_name", label: "שם בעל העסק" }, { key: "business_name", label: "שם העסק" },
    { key: "plan", label: "המסלול" }, { key: "days_left", label: "ימים שנשארו" },
];
const STATUS: Record<string, { label: string; cls: string }> = {
    pending:  { label: "ממתין", cls: "bg-slate-100 text-slate-600" },
    sent:     { label: "נשלח",  cls: "bg-emerald-50 text-emerald-700" },
    failed:   { label: "נכשל",  cls: "bg-rose-50 text-rose-700" },
    canceled: { label: "בוטל",  cls: "bg-slate-100 text-slate-500" },
};
const input = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-slate-300";

// the same filling the server does (platform_outreach.fill) — for the preview only
function fillFor(text: string, r: CrmRecipient): string {
    const values: Record<string, string> = {
        owner_name: r.owner_name || "", business_name: r.name, plan: r.plan_label,
        days_left: r.days_left !== null && r.days_left >= 0 ? String(r.days_left) : "",
    };
    return Object.entries(values).reduce((t, [k, v]) => t.split(`{${k}}`).join(v), text);
}

export function ComposeMessage({ recipients, onClose }: { recipients: CrmRecipient[]; onClose: () => void }) {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [channel, setChannel] = useState<Channel>("whatsapp");
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [confirming, setConfirming] = useState(false);
    const [sending, setSending] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [result, setResult] = useState<{ queued: number; skipped: { name: string; reason: string }[] } | null>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { apiFetch<Template[]>("/api/admin/crm/templates").then(setTemplates).catch(() => setTemplates([])); }, []);

    const email = channel !== "whatsapp";
    const whatsapp = channel !== "email";
    const noPhone = whatsapp ? recipients.filter(r => !r.owner_phone).length : 0;
    const noEmail = email ? recipients.filter(r => !r.owner_email).length : 0;
    const sample = recipients[0];

    const pickTemplate = (t: Template) => { setBody(t.body); setSubject(t.email_subject); setConfirming(false); };
    const insert = (key: string) => {
        const tag = `{${key}}`;
        const el = bodyRef.current;
        if (!el) { setBody(b => b + tag); return; }
        const at = el.selectionStart, end = el.selectionEnd;
        setBody(body.slice(0, at) + tag + body.slice(end));
        requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = at + tag.length; });
    };
    const send = async () => {
        setSending(true); setErr(null);
        try {
            setResult(await apiFetch("/api/admin/crm/send", {
                method: "POST",
                body: JSON.stringify({ studio_ids: recipients.map(r => r.id), channel, body: body.trim(), subject: email ? subject.trim() || null : null }),
            }));
        } catch (e) {
            setErr(e instanceof Error ? e.message : "השליחה נכשלה");
        } finally {
            setSending(false); setConfirming(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col shadow-xl" dir="rtl">
                <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100">
                    <div>
                        <h3 className="font-black text-lg text-slate-900">הודעה לבעלי העסקים</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {recipients.length === 1 ? recipients[0].name : `${recipients.length} עסקים`} · נשלחת מהמספר והמייל של BizControl
                        </p>
                    </div>
                    <button onClick={onClose} aria-label="סגירה" className="text-slate-400 hover:text-slate-900"><X className="h-5 w-5" /></button>
                </div>

                {result ? (
                    <div className="p-6 space-y-4">
                        <div className="flex items-center gap-2 text-emerald-700 font-bold">
                            <Check className="h-5 w-5" /> {result.queued} הודעות בדרך — נשלחות בדקה הקרובה
                        </div>
                        {result.skipped.length > 0 && (
                            <div className="text-sm">
                                <p className="font-semibold text-slate-700 mb-1">לא נשלח ל-{result.skipped.length}:</p>
                                <ul className="text-slate-500 space-y-0.5 max-h-40 overflow-y-auto">
                                    {result.skipped.map((s, i) => <li key={i}>{s.name} — {s.reason}</li>)}
                                </ul>
                            </div>
                        )}
                        <button onClick={onClose} className="w-full bg-slate-900 text-white font-bold py-2.5 rounded-xl">סגירה</button>
                    </div>
                ) : (
                    <>
                        <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4 space-y-4">
                            <div className="flex flex-wrap gap-2">
                                {CHANNELS.map(c => (
                                    <button key={c.key} type="button" onClick={() => { setChannel(c.key); setConfirming(false); }} aria-pressed={channel === c.key}
                                        className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${channel === c.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                                        {c.label}
                                    </button>
                                ))}
                            </div>

                            {templates.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-slate-500 mb-1.5">להתחיל מתבנית</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {templates.map(t => (
                                            <button key={t.key} type="button" onClick={() => pickTemplate(t)}
                                                className="px-2.5 py-1 rounded-lg text-xs border border-slate-200 text-slate-700 hover:bg-slate-50">{t.name}</button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {email && (
                                <label className="block">
                                    <span className="text-xs font-semibold text-slate-500">נושא המייל</span>
                                    <input className={`${input} mt-1`} value={subject} onChange={e => setSubject(e.target.value)} placeholder="הודעה מ-BizControl" maxLength={160} />
                                </label>
                            )}
                            <label className="block">
                                <span className="text-xs font-semibold text-slate-500">ההודעה</span>
                                <textarea ref={bodyRef} className={`${input} mt-1 min-h-[140px] leading-relaxed`} value={body} maxLength={2000}
                                    onChange={e => { setBody(e.target.value); setConfirming(false); }} />
                            </label>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="text-slate-500">להוסיף להודעה:</span>
                                {FIELDS.map(f => (
                                    <button key={f.key} type="button" onClick={() => insert(f.key)}
                                        className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">{f.label}</button>
                                ))}
                            </div>

                            {sample && body.trim() && (
                                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                                    <p className="text-xs font-semibold text-slate-500 mb-1">כך יקבל/תקבל {sample.owner_name || sample.name}:</p>
                                    {email && <p className="text-sm font-bold text-slate-800 mb-1">{fillFor(subject || "הודעה מ-BizControl", sample)}</p>}
                                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{fillFor(body, sample)}</p>
                                </div>
                            )}

                            {(noPhone > 0 || noEmail > 0) && (
                                <p className="text-xs text-amber-700">
                                    {noPhone > 0 && `ל-${noPhone} אין טלפון — לא יקבלו WhatsApp. `}
                                    {noEmail > 0 && `ל-${noEmail} אין מייל — לא יקבלו מייל.`}
                                </p>
                            )}
                            {err && <p className="text-sm text-rose-600">{err}</p>}
                        </div>

                        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
                            {confirming ? (
                                <>
                                    <button onClick={send} disabled={sending}
                                        className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">
                                        <Send className="h-4 w-4" /> {sending ? "שולח..." : `כן, לשלוח ל-${recipients.length} עסקים`}
                                    </button>
                                    <button onClick={() => setConfirming(false)} className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm">חזרה</button>
                                </>
                            ) : (
                                <>
                                    <button onClick={() => setConfirming(true)} disabled={!body.trim()}
                                        className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl disabled:opacity-40 flex items-center justify-center gap-2">
                                        <Send className="h-4 w-4" /> שליחה
                                    </button>
                                    <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm">ביטול</button>
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export function CrmTemplates() {
    const [rows, setRows] = useState<Template[] | null>(null);
    const [saved, setSaved] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => { apiFetch<Template[]>("/api/admin/crm/templates").then(setRows).catch(e => { setRows([]); setErr(e instanceof Error ? e.message : "הטעינה נכשלה"); }); }, []);

    const edit = (key: string, patch: Partial<Template>) => setRows(rs => (rs ?? []).map(t => t.key === key ? { ...t, ...patch } : t));
    const save = async (t: Template) => {
        setErr(null);
        try {
            await apiFetch(`/api/admin/crm/templates/${t.key}`, { method: "PUT", body: JSON.stringify({ name: t.name, email_subject: t.email_subject, body: t.body }) });
            setSaved(t.key);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "השמירה נכשלה");
        }
    };

    if (rows === null) return <p className="text-center text-slate-400 py-12">טוען...</p>;
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">
                ההודעות המוכנות שבוחרים מהן בחלון השליחה. אפשר לכתוב בהן {"{owner_name}"} {"{business_name}"} {"{plan}"} {"{days_left}"} — וכל בעל עסק יקבל את הפרטים שלו.
            </p>
            {err && <p className="text-sm text-rose-600">{err}</p>}
            <div className="grid gap-4 lg:grid-cols-2">
                {rows.map(t => (
                    <div key={t.key} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                        <input className={`${input} font-bold`} value={t.name} maxLength={80} aria-label="שם התבנית"
                            onChange={e => { edit(t.key, { name: e.target.value }); setSaved(null); }} />
                        <input className={input} value={t.email_subject} maxLength={160} placeholder="נושא המייל" aria-label="נושא המייל"
                            onChange={e => { edit(t.key, { email_subject: e.target.value }); setSaved(null); }} />
                        <textarea className={`${input} min-h-[120px] leading-relaxed`} value={t.body} maxLength={2000} aria-label="ההודעה"
                            onChange={e => { edit(t.key, { body: e.target.value }); setSaved(null); }} />
                        <div className="flex items-center justify-end gap-3">
                            {saved === t.key && <span className="text-xs text-emerald-700 flex items-center gap-1"><Check className="h-3.5 w-3.5" /> נשמר</span>}
                            <button onClick={() => save(t)} disabled={!t.name.trim() || !t.body.trim()}
                                className="px-4 py-1.5 text-sm font-bold bg-slate-900 text-white rounded-xl disabled:opacity-40">שמירה</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function CrmSentLog({ studioId }: { studioId?: string }) {
    const [rows, setRows] = useState<Sent[] | null>(null);

    useEffect(() => {
        apiFetch<Sent[]>(`/api/admin/crm/sent${studioId ? `?studio_id=${studioId}` : ""}`).then(setRows).catch(() => setRows([]));
    }, [studioId]);

    const box = "bg-white border border-slate-200 rounded-2xl";
    if (rows === null) return <p className={`${box} text-center text-sm text-slate-400 py-8`}>טוען...</p>;
    if (rows.length === 0) return <p className={`${box} text-center text-sm text-slate-400 py-8`}>עוד לא נשלחו הודעות מהחברה{studioId ? " לעסק הזה" : ""}</p>;
    return (
        <div className={`${box} overflow-x-auto`}>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-slate-500 border-b border-slate-100">
                        {["מתי", ...(studioId ? [] : ["עסק"]), "איך", "אל", "ההודעה", "מצב"].map(h => (
                            <th key={h} className="text-right font-semibold px-4 py-3 whitespace-nowrap">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(m => {
                        const st = STATUS[m.status] ?? { label: m.status, cls: "bg-slate-100 text-slate-600" };
                        return (
                            <tr key={m.id} className="border-b border-slate-50 last:border-0 align-top">
                                <td className="px-4 py-3 whitespace-nowrap text-slate-600 tabular-nums">
                                    {m.created_at ? new Date(m.created_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—"}
                                </td>
                                {!studioId && <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{m.studio_name}</td>}
                                <td className="px-4 py-3">
                                    {m.channel === "whatsapp"
                                        ? <MessageCircle className="h-4 w-4 text-emerald-700" aria-label="WhatsApp" />
                                        : <Mail className="h-4 w-4 text-slate-500" aria-label="מייל" />}
                                </td>
                                <td className="px-4 py-3 text-slate-500 whitespace-nowrap" dir="ltr">{m.to}</td>
                                <td className="px-4 py-3 text-slate-700 max-w-md">
                                    {m.subject && <div className="font-semibold">{m.subject}</div>}
                                    <div className="line-clamp-2 whitespace-pre-wrap" title={m.body}>{m.body}</div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.cls}`} title={m.error ?? undefined}>{st.label}</span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
