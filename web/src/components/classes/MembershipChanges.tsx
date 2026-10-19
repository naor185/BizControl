"use client";

import { cn } from "@/lib/utils";
import PickerBox from "@/components/ui/picker-box";
import { useState } from "react";
import { Snowflake, Sun, CirclePause, CirclePlay, Ban, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { type MembershipDetail, fullDate, ilDate, ilDay, shekels } from "@/lib/classes";

import { tx } from "@/lib/i18n";
// Changing a membership: freeze (with a return date), back from a freeze, stop at the end of the period,
// undo the stop, cancel now — only what its status allows (the server checks the same) — and its change
// log. Owner / manager only.

type Mode = null | "freeze" | "stop" | "cancel";

const ACTION: Record<string, string> = {
    sold: tx("נמכר"), freeze: tx("הקפאה"), unfreeze: tx("חזרה מהקפאה"), freeze_start: tx("ההקפאה התחילה"), start: tx("התחיל"),
    stop: tx("נעצר בסוף התקופה"), unstop: tx("העצירה בוטלה"), cancel: tx("בוטל"), expire: tx("הסתיים"),
};
const today = () => ilDay(new Date().toISOString());      // the date in Israel
const field = "block mt-1 w-full min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm";

export function freezeLine(m: Pick<MembershipDetail, "freeze_from" | "freeze_until">): string | null {
    if (!m.freeze_from || !m.freeze_until || m.freeze_until <= today()) return null;
    return m.freeze_from > today()
        ? tx("הקפאה מתוכננת: {0} – חוזר ב-{1}", { 0: fullDate(m.freeze_from), 1: fullDate(m.freeze_until) })
        : tx("מוקפא · חוזר לפעילות ב-{0}", { 0: fullDate(m.freeze_until) });
}

export default function MembershipChanges({ m, canChange, onDone }: { m: MembershipDetail; canChange: boolean; onDone: (m: MembershipDetail) => void }) {
    const [mode, setMode] = useState<Mode>(null);
    const [busy, setBusy] = useState(false);
    const [from, setFrom] = useState(today());
    const [until, setUntil] = useState("");
    const [reason, setReason] = useState("");
    const [fee, setFee] = useState<number | "">(m.freeze.fee_cents ? m.freeze.fee_cents / 100 : "");
    const hasFreeze = !!(m.freeze_until && m.freeze_until > today());

    const post = async (path: string, body: object, msg: string) => {
        setBusy(true);
        try {
            onDone(await apiFetch<MembershipDetail>(`/api/classes/memberships/${m.id}/${path}`, { method: "POST", body: JSON.stringify(body) }));
            toast.success(msg);
            setMode(null);
            setReason("");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : tx("הפעולה נכשלה"));
        } finally {
            setBusy(false);
        }
    };

    const btn = "inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-indigo-400 disabled:opacity-40";
    const f = m.freeze;
    const rules = [
        f.max_days ? tx("עד {0} ימים בסך הכול (נוצלו {1})", { 0: f.max_days, 1: f.used_days }) : null,
        f.min_days ? tx("לפחות {0} ימים", { 0: f.min_days }) : null,
        f.max_count ? tx("עד {0} הקפאות (נוצלו {1})", { 0: f.max_count, 1: f.count }) : null,
    ].filter(Boolean).join(" · ");

    return (
        <div className="space-y-3">
            {canChange && mode === null && (
                <div className="flex flex-wrap gap-2">
                    {m.status === "active" && !hasFreeze && f.allowed && (
                        <button type="button" className={btn} onClick={() => setMode("freeze")}><Snowflake className="w-4 h-4" aria-hidden />{tx("הקפאה")}</button>
                    )}
                    {hasFreeze && (m.status === "frozen" || m.status === "active") && (
                        <button type="button" className={btn} disabled={busy}
                            onClick={() => post("unfreeze", {}, m.status === "frozen" ? tx("המנוי חזר לפעילות") : tx("ההקפאה המתוכננת בוטלה"))}>
                            <Sun className="w-4 h-4" aria-hidden />{m.status === "frozen" ? tx("חזרה מהקפאה עכשיו") : tx("ביטול ההקפאה המתוכננת")}
                        </button>
                    )}
                    {m.status === "active" && (
                        <button type="button" className={btn} onClick={() => setMode("stop")}><CirclePause className="w-4 h-4" aria-hidden />{tx("עצירה בסוף התקופה")}</button>
                    )}
                    {m.status === "ending" && (
                        <button type="button" className={btn} disabled={busy} onClick={() => post("unstop", {}, tx("העצירה בוטלה — המנוי פעיל"))}>
                            <CirclePlay className="w-4 h-4" aria-hidden />{tx("ביטול העצירה")}
                        </button>
                    )}
                    {["active", "frozen", "ending", "pending"].includes(m.status) && (
                        <button type="button" className={`${btn} text-rose-700 border-rose-200 hover:border-rose-400`} onClick={() => setMode("cancel")}>
                            <Ban className="w-4 h-4" aria-hidden />{tx("ביטול המנוי")}
                        </button>
                    )}
                </div>
            )}

            {mode === "freeze" && (
                <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-slate-600">{tx("מתחילה ב-")}
                            <PickerBox type="date" label={tx("מתאריך")} value={from} onChange={v => setFrom(v)} min={today()} className={cn(field, "text-start")} />
                        </label>
                        <label className="text-xs text-slate-600">{tx("חוזר לפעילות ב-")}
                            <PickerBox type="date" label={tx("עד תאריך")} value={until} onChange={v => setUntil(v)} min={from} className={cn(field, "text-start")} />
                        </label>
                        <label className="text-xs text-slate-600">{tx("סיבה")}
                            <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder={tx("למשל: חופשה")} className={field} />
                        </label>
                        <label className="text-xs text-slate-600">{tx("עמלת הקפאה (₪)")}
                            <input type="number" min={0} value={fee} onChange={e => setFee(e.target.value === "" ? "" : Number(e.target.value))} className={`${field} tabular-nums`} dir="ltr" />
                        </label>
                    </div>
                    {rules && <p className="text-xs text-slate-500">{rules}</p>}
                    <p className="text-xs text-slate-500">
                        {tx("סוף המנוי יידחה בימי ההקפאה. הרשמות בתקופה הזו יבוטלו")}{m.kind === "punch" ? tx(" והכניסות יחזרו") : ""}{tx(", ותישלח הודעה ל")}{m.client_name}{tx(". העמלה נרשמת במנוי — לא נגבית.")}
                    </p>
                    <div className="flex gap-2">
                        <button type="button" disabled={busy || !until}
                            onClick={() => post("freeze", { from_on: from, until_on: until, reason: reason.trim() || null, fee_cents: fee === "" ? 0 : Math.round(fee * 100) }, tx("המנוי הוקפא"))}
                            className="inline-flex items-center gap-2 min-h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}{tx("הקפאה")}
                        </button>
                        <button type="button" onClick={() => setMode(null)} className="min-h-10 px-3 text-sm text-slate-600">{tx("ביטול")}</button>
                    </div>
                </div>
            )}

            {(mode === "stop" || mode === "cancel") && (
                <div className={`rounded-xl border p-3 space-y-2 ${mode === "cancel" ? "border-rose-200 bg-rose-50/50" : "border-slate-200"}`}>
                    <p className="text-sm text-slate-800">
                        {mode === "stop"
                            ? tx("המנוי ימשיך עד {0} ואז יסתיים בלי חידוש. ההרשמות נשארות.", { 0: m.ends_on ? fullDate(m.ends_on) : tx("סוף הכניסות") })
                            : tx("המנוי יסתיים היום.{0} אין החזר כספי אוטומטי.", { 0: m.coming_bookings ? ` ${m.coming_bookings === 1 ? tx("הרשמה עתידית אחת תבוטל") : tx("{0} הרשמות עתידיות יבוטלו", { 0: m.coming_bookings })}${m.kind === "punch" ? tx(" והכניסות יחזרו") : ""}.` : "" })}
                    </p>
                    <label className="block text-xs text-slate-600">{tx("סיבה (לא חובה)")}
                        <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} className={field} />
                    </label>
                    <div className="flex gap-2">
                        <button type="button" disabled={busy}
                            onClick={() => post(mode, { reason: reason.trim() || null }, mode === "stop" ? tx("המנוי ייעצר בסוף התקופה") : tx("המנוי בוטל"))}
                            className={`inline-flex items-center gap-2 min-h-10 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-40 ${mode === "cancel" ? "bg-rose-600" : "bg-indigo-600"}`}>
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}{mode === "stop" ? tx("עצירה בסוף התקופה") : tx("לבטל את המנוי")}
                        </button>
                        <button type="button" onClick={() => setMode(null)} className="min-h-10 px-3 text-sm text-slate-600">{tx("חזרה")}</button>
                    </div>
                </div>
            )}

            {m.events.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1">{tx("היסטוריית המנוי")}</p>
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {[...m.events].reverse().map((e, i) => (
                            <li key={i} className="px-3 py-2 flex items-start justify-between gap-2 text-sm">
                                <span className="text-slate-800">
                                    {ACTION[e.action] ?? e.action}
                                    {e.action === "freeze" && e.effective_on ? tx(" מ-{0}, {1} ימים", { 0: fullDate(e.effective_on), 1: e.days }) : ""}
                                    {e.action === "unfreeze" && e.days ? tx(" (הוחזרו {0} ימים)", { 0: -e.days }) : ""}
                                    {e.fee_cents ? tx(" · עמלה {0}", { 0: shekels(e.fee_cents) }) : ""}
                                    {e.reason ? ` · ${e.reason}` : ""}
                                    {e.by ? <span className="text-slate-500"> · {e.by}</span> : null}
                                </span>
                                <span className="text-xs text-slate-400 tabular-nums shrink-0" dir="ltr">{ilDate(e.at)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
