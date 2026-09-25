"use client";

import { useRef, useState } from "react";
import {
    MessageCircle, Mail, Bell, Lock, ChevronDown, Send, RotateCcw, Loader2, Users, UserCog,
    type LucideIcon,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { fillTerms, type Terms } from "@/lib/useTerms";

// Class and membership messages (GET/PATCH /api/classes/notifications): on/off per channel, the wording,
// and a test to the owner's own phone or e-mail — once per wording (the server refuses the same text twice).
// The server holds the events, their default texts, the placeholders and their sample values.

export type NotifChannel = { channel: "whatsapp" | "email" | "bell"; enabled: boolean; body: string; default_body: string; is_default_body: boolean };
export type NotifEvent = {
    event: string; label: string; audience: "client" | "staff"; recipient: string; always_on: boolean; module: string;
    channels: NotifChannel[]; placeholders: { key: string; label: string; sample: string }[];
};

const CHANNEL: Record<NotifChannel["channel"], { label: string; icon: LucideIcon }> = {
    whatsapp: { label: "וואטסאפ", icon: MessageCircle },
    email: { label: "מייל", icon: Mail },
    bell: { label: "פעמון", icon: Bell },
};

export default function ClassNotifications({ events, canEdit, terms, onChange }: {
    events: NotifEvent[]; canEdit: boolean; terms: Terms; onChange: (e: NotifEvent[]) => void;
}) {
    const [open, setOpen] = useState<string | null>(null);
    const groups = [
        { title: `הודעות ל${terms.client_plural}`, icon: Users, note: "הודעות שירות — נשלחות גם למי שהסיר/ה את עצמו/ה מהודעות שיווקיות.", items: events.filter(e => e.audience === "client") },
        { title: "התראות לצוות", icon: UserCog, note: "מופיעות בפעמון שבראש המסך.", items: events.filter(e => e.audience === "staff") },
    ].filter(g => g.items.length);

    return (
        <div className="space-y-4">
            {!canEdit && (
                <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    אפשר לראות את ההודעות. שינוי — רק לבעלים או למנהל.
                </p>
            )}
            {groups.map(g => (
                <section key={g.title} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
                            <g.icon className="w-4.5 h-4.5 text-indigo-600" aria-hidden />
                            {g.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">{g.note}</p>
                    </div>
                    <ul className="divide-y divide-slate-100">
                        {g.items.map(ev => (
                            <EventRow key={ev.event} ev={ev} terms={terms} canEdit={canEdit} onChange={onChange}
                                open={open === ev.event} onToggleOpen={() => setOpen(o => (o === ev.event ? null : ev.event))} />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function EventRow({ ev, terms, canEdit, open, onToggleOpen, onChange }: {
    ev: NotifEvent; terms: Terms; canEdit: boolean; open: boolean; onToggleOpen: () => void; onChange: (e: NotifEvent[]) => void;
}) {
    const [busy, setBusy] = useState<string | null>(null);

    const setEnabled = async (ch: NotifChannel) => {
        setBusy(ch.channel);
        try {
            onChange(await apiFetch<NotifEvent[]>(`/api/classes/notifications/${ev.event}`, {
                method: "PATCH", body: JSON.stringify({ channel: ch.channel, enabled: !ch.enabled }),
            }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(null);
        }
    };

    const panelId = `notif-${ev.event}`;
    return (
        <li className="px-5 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{fillTerms(ev.label, terms)}</p>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>אל: {fillTerms(ev.recipient, terms)}</span>
                        {ev.always_on && (
                            <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                <Lock className="w-3 h-3" aria-hidden /> תמיד נשלחת — {terms.client_plural} חייבים לדעת
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {ev.channels.map(ch => {
                        const C = CHANNEL[ch.channel];
                        const locked = ev.always_on || !canEdit;
                        return (
                            <button key={ch.channel} type="button" role="switch" aria-checked={ch.enabled}
                                aria-label={`${C.label}: ${ch.enabled ? "פעיל" : "כבוי"}`}
                                disabled={locked || busy !== null} onClick={() => setEnabled(ch)}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 min-h-11 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${ch.enabled ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-400 line-through decoration-slate-300"} ${locked ? "cursor-default" : "hover:border-indigo-400"}`}>
                                {busy === ch.channel ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <C.icon className="w-4 h-4" aria-hidden />}
                                {C.label}
                            </button>
                        );
                    })}
                    <button type="button" onClick={onToggleOpen} aria-expanded={open} aria-controls={panelId}
                        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-indigo-700 px-2 min-h-11">
                        נוסח
                        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                </div>
            </div>
            {open && <Wording id={panelId} ev={ev} terms={terms} canEdit={canEdit} onChange={onChange} />}
        </li>
    );
}

function Wording({ id, ev, terms, canEdit, onChange }: {
    id: string; ev: NotifEvent; terms: Terms; canEdit: boolean; onChange: (e: NotifEvent[]) => void;
}) {
    const [channel, setChannel] = useState<NotifChannel["channel"]>(ev.channels[0].channel);
    const ch = ev.channels.find(c => c.channel === channel)!;
    const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(ev.channels.map(c => [c.channel, c.body])));
    const [busy, setBusy] = useState<"save" | "reset" | "test" | null>(null);
    const box = useRef<HTMLTextAreaElement>(null);

    const draft = drafts[channel];
    const dirty = draft.trim() !== ch.body.trim();
    const known = new Set(ev.placeholders.map(p => p.key));
    const unknown = [...new Set([...draft.matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => !known.has(k)))];
    const samples = Object.fromEntries(ev.placeholders.map(p => [p.key, p.sample]));
    const preview = draft.replace(/\{(\w+)\}/g, (whole, k: string) => (k in samples ? samples[k] : whole));

    const insert = (key: string) => {
        const el = box.current;
        const token = `{${key}}`;
        const at = el ? el.selectionStart : draft.length;
        const end = el ? el.selectionEnd : draft.length;
        setDrafts(d => ({ ...d, [channel]: draft.slice(0, at) + token + draft.slice(end) }));
        requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
    };

    const save = async (body: string, kind: "save" | "reset") => {
        setBusy(kind);
        try {
            const next = await apiFetch<NotifEvent[]>(`/api/classes/notifications/${ev.event}`, {
                method: "PATCH", body: JSON.stringify({ channel, body }),
            });
            onChange(next);
            const saved = next.find(e => e.event === ev.event)?.channels.find(c => c.channel === channel);
            if (saved) setDrafts(d => ({ ...d, [channel]: saved.body }));
            toast.success(kind === "reset" ? "חזר הנוסח המקורי" : "הנוסח נשמר");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(null);
        }
    };

    const test = async () => {
        setBusy("test");
        try {
            const r = await apiFetch<{ sent_to: string }>(`/api/classes/notifications/${ev.event}/test`, {
                method: "POST", body: JSON.stringify({ channel }),
            });
            toast.success(`נשלחה בדיקה אל ${r.sent_to}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הבדיקה לא נשלחה");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div id={id} className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            {ev.channels.length > 1 && (
                <div role="tablist" className="inline-flex rounded-xl bg-white border border-slate-200 p-1">
                    {ev.channels.map(c => {
                        const C = CHANNEL[c.channel];
                        const on = c.channel === channel;
                        return (
                            <button key={c.channel} type="button" role="tab" aria-selected={on} onClick={() => setChannel(c.channel)}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-3 min-h-9 text-sm font-medium ${on ? "bg-indigo-600 text-white" : "text-slate-600 hover:text-slate-900"}`}>
                                <C.icon className="w-4 h-4" aria-hidden /> {C.label}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
                <div>
                    <label htmlFor={`${id}-${channel}`} className="block text-xs font-semibold text-slate-600 mb-1">
                        הנוסח {ch.is_default_body && !dirty ? "(המקורי)" : ""}
                    </label>
                    <textarea id={`${id}-${channel}`} ref={box} dir="rtl" rows={6} maxLength={2000} disabled={!canEdit || busy !== null}
                        value={draft} onChange={e => setDrafts(d => ({ ...d, [channel]: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:text-slate-500" />
                    {canEdit && (
                        <div className="mt-2">
                            <p className="text-xs text-slate-500 mb-1.5">לחיצה מוסיפה למקום הסמן:</p>
                            <div className="flex flex-wrap gap-1.5">
                                {ev.placeholders.map(p => (
                                    <button key={p.key} type="button" onClick={() => insert(p.key)}
                                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-700">
                                        {fillTerms(p.label, terms)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {unknown.length > 0 && (
                        <p className="text-xs text-red-600 mt-2">
                            {unknown.map(k => `{${k}}`).join(", ")} — לא מוכר בהודעה הזו. בחר מהרשימה.
                        </p>
                    )}
                </div>

                <div>
                    <p className="text-xs font-semibold text-slate-600 mb-1">
                        {channel === "bell" ? "כך זה ייראה בפעמון" : `כך זה יגיע ל${terms.client} (דוגמה)`}
                    </p>
                    <div className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed min-h-[9.5rem] ${channel === "whatsapp" ? "bg-[#dcf8c6] text-slate-900" : "bg-white border border-slate-200 text-slate-800"}`}>
                        {preview || <span className="text-slate-400">אין נוסח</span>}
                    </div>
                </div>
            </div>

            {canEdit && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button type="button" onClick={() => save(draft, "save")} disabled={!dirty || !draft.trim() || unknown.length > 0 || busy !== null}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold px-4 min-h-11">
                        {busy === "save" && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                        שמור נוסח
                    </button>
                    {!ch.is_default_body && (
                        <button type="button" onClick={() => save("", "reset")} disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 text-sm text-slate-700 px-3 min-h-11">
                            <RotateCcw className="w-4 h-4" aria-hidden /> חזרה לנוסח המקורי
                        </button>
                    )}
                    {channel !== "bell" && (
                        <button type="button" onClick={test} disabled={dirty || busy !== null}
                            title={dirty ? "שמור קודם את הנוסח" : undefined}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-400 disabled:opacity-40 text-sm text-slate-700 px-3 min-h-11">
                            {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />}
                            שלח לי בדיקה
                        </button>
                    )}
                    {channel !== "bell" && (
                        <span className="text-xs text-slate-500">
                            {dirty ? "שמור קודם, ואז אפשר לבדוק." : `הבדיקה מגיעה ל${channel === "whatsapp" ? "טלפון" : "מייל"} שלך, פעם אחת לכל נוסח.`}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
