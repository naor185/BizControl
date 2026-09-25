"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, RefreshCw, PencilLine, X } from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import ClientSearch, { type FoundClient } from "@/components/classes/ClientSearch";
import MembershipTypes, { describeType } from "@/components/classes/MembershipTypes";
import PayForm from "@/components/classes/PayForm";
import MembershipChanges, { freezeLine } from "@/components/classes/MembershipChanges";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Terms } from "@/lib/useTerms";
import {
    type Fee, type MembershipDetail, type MembershipRow, type MembershipType,
    STATUS_LABEL, fullDate, ilDate, ilTime, methodLabel, shekels,
} from "@/lib/classes";

// Memberships: who has what (balance, dates, status), selling one, a membership's entry log, a manual
// correction, renewal — and the membership types, and the open fees the owner's rules recorded.

type Section = "memberships" | "types" | "fees";
const STATUS_CLS: Record<string, string> = {
    active: "text-emerald-800 bg-emerald-100", ending: "text-amber-800 bg-amber-100", pending: "text-sky-800 bg-sky-100",
    frozen: "text-cyan-800 bg-cyan-100", expired: "text-slate-600 bg-slate-100", canceled: "text-slate-600 bg-slate-100",
};

export default function ClassMemberships({ terms, canSell, canChange, canConfigure }: {
    terms: Terms; canSell: boolean; canChange: boolean; canConfigure: boolean;
}) {
    const [section, setSection] = useState<Section>("memberships");
    const sections: { id: Section; label: string }[] = [
        { id: "memberships", label: "מנויים" }, { id: "types", label: "סוגי מנוי" }, { id: "fees", label: "חיובים פתוחים" },
    ];
    return (
        <div className="space-y-4">
            <div role="tablist" className="inline-flex rounded-xl bg-white border border-slate-200 p-1">
                {sections.map(x => (
                    <button key={x.id} type="button" role="tab" aria-selected={section === x.id} onClick={() => setSection(x.id)}
                        className={`px-3 min-h-9 rounded-lg text-sm font-medium ${section === x.id ? "bg-indigo-600 text-white" : "text-slate-600 hover:text-slate-900"}`}>
                        {x.label}
                    </button>
                ))}
            </div>
            {section === "memberships" && <MembershipList terms={terms} canSell={canSell} canChange={canChange} />}
            {section === "types" && <MembershipTypes canConfigure={canConfigure} />}
            {section === "fees" && <Fees canWaive={canChange} canPay={canSell} />}
        </div>
    );
}

function Balance({ m }: { m: MembershipRow }) {
    if (m.kind === "punch" && m.balance) {
        const pct = m.balance.total ? Math.max(0, Math.min(100, (m.balance.available / m.balance.total) * 100)) : 0;
        return (
            <div className="w-28">
                <p className="text-xs text-slate-700 tabular-nums">נותרו {m.balance.available} מתוך {m.balance.total}</p>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} /></div>
            </div>
        );
    }
    return <p className="text-xs text-slate-700">{m.kind === "weekly" ? `${m.weekly_limit} בשבוע` : "ללא הגבלה"}</p>;
}

function MembershipList({ terms, canSell, canChange }: { terms: Terms; canSell: boolean; canChange: boolean }) {
    const [all, setAll] = useState(false);
    const [rows, setRows] = useState<MembershipRow[] | null>(null);
    const [selling, setSelling] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const load = useCallback(() => {
        apiFetch<MembershipRow[]>(`/api/classes/memberships?current_only=${!all}`).then(setRows).catch(() => setRows([]));
    }, [all]);
    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                {canSell && (
                    <button type="button" onClick={() => setSelling(true)}
                        className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold">
                        <Plus className="w-4 h-4" aria-hidden /> מכירת מנוי
                    </button>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> גם מנויים שהסתיימו
                </label>
            </div>
            {rows === null ? <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label="טוען" /> : rows.length === 0 ? (
                <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl px-5 py-8 text-center">אין מנויים עדיין.</p>
            ) : (
                <ul className="bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-100">
                    {rows.map(m => (
                        <li key={m.id}>
                            <button type="button" onClick={() => setOpenId(m.id)} className="w-full text-right px-4 py-3 flex items-center gap-3 hover:bg-slate-50">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-900 truncate">{m.client_name}</p>
                                    <p className="text-xs text-slate-500 truncate">{freezeLine(m) ?? `${m.name} · ${m.ends_on ? `עד ${fullDate(m.ends_on)}` : "ללא תאריך סיום"}`}</p>
                                </div>
                                <Balance m={m} />
                                <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${STATUS_CLS[m.status]}`}>{STATUS_LABEL[m.status]}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {selling && <SellSheet terms={terms} onClose={() => setSelling(false)} onDone={() => { setSelling(false); load(); }} />}
            {openId && <MembershipSheet id={openId} canSell={canSell} canChange={canChange} onClose={() => setOpenId(null)} onChanged={load} />}
        </div>
    );
}

const field = "w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
const label = "block text-xs font-semibold text-slate-600";

function SellSheet({ terms, onClose, onDone }: { terms: Terms; onClose: () => void; onDone: () => void }) {
    const [types, setTypes] = useState<MembershipType[]>([]);
    const [who, setWho] = useState<FoundClient | null>(null);
    const [typeId, setTypeId] = useState("");
    const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
    const [price, setPrice] = useState<number | "">("");
    const [notes, setNotes] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => { apiFetch<MembershipType[]>("/api/classes/membership-types").then(t => setTypes(t.filter(x => x.is_active))).catch(() => {}); }, []);
    const type = types.find(t => t.id === typeId);

    const sell = async () => {
        if (!who || !type) return;
        setBusy(true);
        try {
            await apiFetch("/api/classes/memberships", {
                method: "POST",
                body: JSON.stringify({ client_id: who.id, type_id: type.id, starts_on: start,
                    price_cents: price === "" ? null : Math.round(price * 100), notes: notes.trim() || null }),
            });
            toast.success(`${type.name} נמכר ל${who.full_name}`);
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "המכירה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    return (
        <BottomSheet open onClose={onClose} title="מכירת מנוי" className="sm:max-w-lg"
            footer={
                <button type="button" onClick={sell} disabled={busy || !who || !type}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold">
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    {who && type ? `מכירה: ${type.name} ל${who.full_name}` : "מכירה"}
                </button>
            }>
            <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
                {who ? (
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 min-h-11">
                        <span className="text-sm font-semibold text-slate-900">{who.full_name}</span>
                        <button type="button" onClick={() => setWho(null)} aria-label="החלפת לקוח" className="w-9 h-9 flex items-center justify-center text-slate-400">
                            <X className="w-4 h-4" aria-hidden />
                        </button>
                    </div>
                ) : <ClientSearch terms={terms} onPick={setWho} />}
                <fieldset>
                    <legend className={label}>סוג מנוי</legend>
                    {types.length === 0 ? <p className="text-sm text-slate-500 mt-1">אין סוגי מנוי למכירה — הוסף בלשונית &quot;סוגי מנוי&quot;.</p> : (
                        <div className="mt-1 grid gap-2">
                            {types.map(t => (
                                <button key={t.id} type="button" role="radio" aria-checked={typeId === t.id}
                                    onClick={() => { setTypeId(t.id); setPrice(t.price_cents / 100); }}
                                    className={`text-right rounded-xl border px-3 py-2 ${typeId === t.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200"}`}>
                                    <span className="block text-sm font-semibold text-slate-900">{t.name}</span>
                                    <span className="block text-xs text-slate-500 tabular-nums">{describeType(t)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </fieldset>
                <div className="grid grid-cols-2 gap-3">
                    <label className={label}>מתחיל ב-
                        <input type="date" value={start} min={new Date().toISOString().slice(0, 10)} onChange={e => setStart(e.target.value)} className={`${field} mt-1`} dir="ltr" />
                    </label>
                    <label className={label}>מחיר (₪)
                        <input type="number" min={0} value={price} onChange={e => setPrice(e.target.value === "" ? "" : Number(e.target.value))} className={`${field} mt-1 tabular-nums`} dir="ltr" />
                    </label>
                </div>
                <label className={label}>הערה
                    <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} className={`${field} mt-1`} />
                </label>
                <p className="text-xs text-slate-500">התשלום עצמו נרשם בנפרד — המערכת לא גובה כסף.</p>
            </div>
        </BottomSheet>
    );
}

const ENTRY_TEXT = (e: MembershipDetail["entries"][number]) => {
    const cls = e.class_name && e.class_at ? ` — ${e.class_name} ${ilDate(e.class_at)}` : "";
    if (e.stage === "opening") return `${e.reason ?? "פתיחה"} (+${e.amount})`;
    if (e.stage === "reserve") return `כניסה שמורה${cls}`;
    if (e.stage === "close") return `${e.outcome === "consume" ? "הכניסה נוצלה" : "הכניסה חזרה"}${cls}${e.reason ? ` · ${e.reason}` : ""}`;
    return `תיקון ${e.amount > 0 ? "+" : ""}${e.amount}${cls}${e.reason ? ` · ${e.reason}` : ""}`;
};

function MembershipSheet({ id, canSell, canChange, onClose, onChanged }: {
    id: string; canSell: boolean; canChange: boolean; onClose: () => void; onChanged: () => void;
}) {
    const [m, setM] = useState<MembershipDetail | null>(null);
    const [fixing, setFixing] = useState(false);
    const [paying, setPaying] = useState(false);
    const [delta, setDelta] = useState(1);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const reload = useCallback(() => { apiFetch<MembershipDetail>(`/api/classes/memberships/${id}`).then(setM).catch(() => {}); }, [id]);
    useEffect(() => { reload(); }, [reload]);

    const act = async (path: string, body: object, msg: string) => {
        setBusy(true);
        try {
            await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
            toast.success(msg);
            setFixing(false);
            setPaying(false);
            setReason("");
            reload();
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    return (
        <BottomSheet open onClose={onClose} title={m ? `${m.name} — ${m.client_name}` : "מנוי"} className="sm:max-w-lg">
            {!m ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label="טוען" /></div> : (
                <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0 text-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <p className="text-slate-700">{m.kind_label} · <span dir="ltr">{fullDate(m.starts_on)} – {m.ends_on ? fullDate(m.ends_on) : "…"}</span>{m.ends_on ? "" : " (ללא תאריך סיום)"}</p>
                            {m.price_cents > 0 && <p className="text-slate-500 tabular-nums">מחיר: {shekels(m.price_cents)}</p>}
                            {m.notes && <p className="text-slate-500">{m.notes}</p>}
                            {freezeLine(m) && <p className="text-cyan-800">{freezeLine(m)}</p>}
                        </div>
                        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${STATUS_CLS[m.status]}`}>{STATUS_LABEL[m.status]}</span>
                    </div>
                    {m.kind === "punch" && m.balance && (
                        <div className="grid grid-cols-3 gap-2 text-center">
                            {([["זמינות", m.balance.available], ["שמורות", m.balance.reserved], ["נוצלו", m.balance.consumed]] as const).map(([k, v]) => (
                                <div key={k} className="rounded-xl bg-slate-50 py-2">
                                    <p className="text-lg font-bold text-slate-900 tabular-nums">{v}</p>
                                    <p className="text-xs text-slate-500">{k}</p>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-slate-700 tabular-nums">
                            שולם {shekels(m.paid_cents)}{m.price_cents > 0 ? ` מתוך ${shekels(m.price_cents)}` : ""}
                            {m.price_cents > m.paid_cents && <span className="text-rose-700"> · נותר {shekels(m.price_cents - m.paid_cents)}</span>}
                        </p>
                        {canSell && !paying && (
                            <button type="button" onClick={() => setPaying(true)}
                                className="min-h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">רישום תשלום</button>
                        )}
                    </div>
                    {paying && (
                        <PayForm defaultAmountCents={Math.max(0, m.price_cents - m.paid_cents)} busy={busy} onCancel={() => setPaying(false)}
                            onPay={p => act(`/api/classes/memberships/${m.id}/payments`, p, "התשלום נרשם")} />
                    )}
                    {m.payments.length > 0 && (
                        <ul className="text-xs text-slate-600 space-y-0.5">
                            {m.payments.map(p => (
                                <li key={p.id} className="flex justify-between tabular-nums">
                                    <span>{shekels(p.amount_cents)} · {methodLabel(p.method)}</span>
                                    <span dir="ltr">{ilDate(p.created_at)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {canSell && (
                            <button type="button" disabled={busy} onClick={() => act(`/api/classes/memberships/${m.id}/renew`, {}, "המנוי חודש — המנוי החדש מתחיל כשהנוכחי נגמר")}
                                className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-indigo-400">
                                <RefreshCw className="w-4 h-4" aria-hidden /> חידוש
                            </button>
                        )}
                        {canChange && m.kind === "punch" && !fixing && (
                            <button type="button" onClick={() => setFixing(true)}
                                className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-indigo-400">
                                <PencilLine className="w-4 h-4" aria-hidden /> תיקון כניסות
                            </button>
                        )}
                    </div>
                    {fixing && (
                        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                            <div className="flex gap-2">
                                <label className="text-xs text-slate-600">כניסות (+/-)
                                    <input type="number" value={delta} onChange={e => setDelta(Number(e.target.value))} dir="ltr"
                                        className="block mt-1 w-20 min-h-10 rounded-lg border border-slate-200 text-center tabular-nums" />
                                </label>
                                <label className="text-xs text-slate-600 flex-1">סיבה
                                    <input value={reason} onChange={e => setReason(e.target.value)} maxLength={160} placeholder="למשל: מתנה"
                                        className="block mt-1 w-full min-h-10 rounded-lg border border-slate-200 px-2" />
                                </label>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" disabled={busy || !delta || !reason.trim()}
                                    onClick={() => act(`/api/classes/memberships/${m.id}/adjust`, { delta, reason }, "הכניסות תוקנו")}
                                    className="min-h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">שמירה</button>
                                <button type="button" onClick={() => setFixing(false)} className="min-h-10 px-3 text-sm text-slate-600">ביטול</button>
                            </div>
                        </div>
                    )}
                    <MembershipChanges m={m} canChange={canChange} onDone={next => { setM(next); onChanged(); }} />
                    {m.kind === "punch" && m.entries.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">יומן הכניסות</p>
                            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                                {[...m.entries].reverse().map((e, i) => (
                                    <li key={i} className="px-3 py-2 flex items-start justify-between gap-2">
                                        <span className="text-slate-800">{ENTRY_TEXT(e)}</span>
                                        <span className="text-xs text-slate-400 tabular-nums shrink-0" dir="ltr">{ilDate(e.at)} {ilTime(e.at)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {m.bookings.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">שיעורים</p>
                            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                                {m.bookings.map(b => (
                                    <li key={b.id} className="px-3 py-2 flex items-center justify-between gap-2">
                                        <span className="text-slate-800">{b.class_name}</span>
                                        <span className="text-xs text-slate-500 tabular-nums" dir="ltr">{ilDate(b.starts_at)} {ilTime(b.starts_at)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </BottomSheet>
    );
}

function Fees({ canWaive, canPay }: { canWaive: boolean; canPay: boolean }) {
    const [fees, setFees] = useState<Fee[] | null>(null);
    const [waiving, setWaiving] = useState<string | null>(null);
    const [paying, setPaying] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [reason, setReason] = useState("");
    const load = useCallback(() => { apiFetch<Fee[]>("/api/classes/fees").then(setFees).catch(() => setFees([])); }, []);
    useEffect(() => { load(); }, [load]);

    const waive = async (id: string) => {
        try {
            await apiFetch(`/api/classes/fees/${id}/waive`, { method: "POST", body: JSON.stringify({ reason }) });
            toast.success("החיוב נמחל");
            setWaiving(null);
            setReason("");
            load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        }
    };

    const pay = async (id: string, p: { method: string; send_receipt: boolean }) => {
        setBusy(true);
        try {
            await apiFetch(`/api/classes/fees/${id}/pay`, { method: "POST", body: JSON.stringify(p) });
            toast.success("התשלום נרשם — החיוב שולם");
            setPaying(null);
            load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    if (fees === null) return <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label="טוען" />;
    const total = fees.reduce((a, f) => a + f.amount_cents, 0);
    return (
        <div className="space-y-3">
            <p className="text-sm text-slate-600">
                חיובים שנרשמו לפי כללי הביטול המאוחר ואי-ההגעה. הם נשמרים כחוב על הלקוח — המערכת לא גובה אותם.
                {fees.length > 0 && <span className="font-semibold text-slate-900 tabular-nums"> סה״כ פתוח: {shekels(total)}</span>}
            </p>
            {fees.length === 0 ? (
                <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl px-5 py-8 text-center">אין חיובים פתוחים.</p>
            ) : (
                <ul className="bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-100">
                    {fees.map(f => (
                        <li key={f.id} className="px-4 py-3 space-y-2">
                            <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-900 truncate">{f.client_name}</p>
                                    <p className="text-xs text-slate-500 truncate">{f.reason}</p>
                                </div>
                                <span className="text-sm font-bold text-rose-700 tabular-nums">{shekels(f.amount_cents)}</span>
                                {canPay && paying !== f.id && waiving !== f.id && (
                                    <button type="button" onClick={() => setPaying(f.id)}
                                        className="min-h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">תשלום</button>
                                )}
                                {canWaive && waiving !== f.id && paying !== f.id && (
                                    <button type="button" onClick={() => { setWaiving(f.id); setReason(""); }}
                                        className="min-h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-400">מחילה</button>
                                )}
                            </div>
                            {paying === f.id && (
                                <PayForm defaultAmountCents={f.amount_cents} fixedAmount busy={busy} onCancel={() => setPaying(null)}
                                    onPay={p => pay(f.id, { method: p.method, send_receipt: p.send_receipt })} />
                            )}
                            {waiving === f.id && (
                                <div className="flex gap-2">
                                    <input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} autoFocus placeholder="סיבת המחילה"
                                        className="flex-1 min-h-10 rounded-lg border border-slate-200 px-2 text-sm" />
                                    <button type="button" onClick={() => waive(f.id)} disabled={!reason.trim()}
                                        className="min-h-10 px-3 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">מחילה</button>
                                    <button type="button" onClick={() => setWaiving(null)} className="min-h-10 px-2 text-sm text-slate-600">ביטול</button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
