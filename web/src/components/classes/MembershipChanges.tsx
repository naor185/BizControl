"use client";

import { useState } from "react";
import { Snowflake, Sun, CirclePause, CirclePlay, Ban, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { type MembershipDetail, fullDate, ilDate, ilDay, shekels } from "@/lib/classes";

// Changing a membership: freeze (with a return date), back from a freeze, stop at the end of the period,
// undo the stop, cancel now — only what its status allows (the server checks the same) — and its change
// log. Owner / manager only.

type Mode = null | "freeze" | "stop" | "cancel";

const ACTION: Record<string, string> = {
    sold: "נמכר", freeze: "הקפאה", unfreeze: "חזרה מהקפאה", freeze_start: "ההקפאה התחילה", start: "התחיל",
    stop: "נעצר בסוף התקופה", unstop: "העצירה בוטלה", cancel: "בוטל", expire: "הסתיים",
};
const today = () => ilDay(new Date().toISOString());      // the date in Israel
const field = "block mt-1 w-full min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm";

export function freezeLine(m: Pick<MembershipDetail, "freeze_from" | "freeze_until">): string | null {
    if (!m.freeze_from || !m.freeze_until || m.freeze_until <= today()) return null;
    return m.freeze_from > today()
        ? `הקפאה מתוכננת: ${fullDate(m.freeze_from)} – חוזר ב-${fullDate(m.freeze_until)}`
        : `מוקפא · חוזר לפעילות ב-${fullDate(m.freeze_until)}`;
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
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    const btn = "inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-indigo-400 disabled:opacity-40";
    const f = m.freeze;
    const rules = [
        f.max_days ? `עד ${f.max_days} ימים בסך הכול (נוצלו ${f.used_days})` : null,
        f.min_days ? `לפחות ${f.min_days} ימים` : null,
        f.max_count ? `עד ${f.max_count} הקפאות (נוצלו ${f.count})` : null,
    ].filter(Boolean).join(" · ");

    return (
        <div className="space-y-3">
            {canChange && mode === null && (
                <div className="flex flex-wrap gap-2">
                    {m.status === "active" && !hasFreeze && f.allowed && (
                        <button type="button" className={btn} onClick={() => setMode("freeze")}><Snowflake className="w-4 h-4" aria-hidden />הקפאה</button>
                    )}
                    {hasFreeze && (m.status === "frozen" || m.status === "active") && (
                        <button type="button" className={btn} disabled={busy}
                            onClick={() => post("unfreeze", {}, m.status === "frozen" ? "המנוי חזר לפעילות" : "ההקפאה המתוכננת בוטלה")}>
                            <Sun className="w-4 h-4" aria-hidden />{m.status === "frozen" ? "חזרה מהקפאה עכשיו" : "ביטול ההקפאה המתוכננת"}
                        </button>
                    )}
                    {m.status === "active" && (
                        <button type="button" className={btn} onClick={() => setMode("stop")}><CirclePause className="w-4 h-4" aria-hidden />עצירה בסוף התקופה</button>
                    )}
                    {m.status === "ending" && (
                        <button type="button" className={btn} disabled={busy} onClick={() => post("unstop", {}, "העצירה בוטלה — המנוי פעיל")}>
                            <CirclePlay className="w-4 h-4" aria-hidden />ביטול העצירה
                        </button>
                    )}
                    {["active", "frozen", "ending", "pending"].includes(m.status) && (
                        <button type="button" className={`${btn} text-rose-700 border-rose-200 hover:border-rose-400`} onClick={() => setMode("cancel")}>
                            <Ban className="w-4 h-4" aria-hidden />ביטול המנוי
                        </button>
                    )}
                </div>
            )}

            {mode === "freeze" && (
                <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-slate-600">מתחילה ב-
                            <input type="date" value={from} min={today()} onChange={e => setFrom(e.target.value)} className={field} dir="ltr" />
                        </label>
                        <label className="text-xs text-slate-600">חוזר לפעילות ב-
                            <input type="date" value={until} min={from} onChange={e => setUntil(e.target.value)} className={field} dir="ltr" />
                        </label>
                        <label className="text-xs text-slate-600">סיבה
                            <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="למשל: חופשה" className={field} />
                        </label>
                        <label className="text-xs text-slate-600">עמלת הקפאה (₪)
                            <input type="number" min={0} value={fee} onChange={e => setFee(e.target.value === "" ? "" : Number(e.target.value))} className={`${field} tabular-nums`} dir="ltr" />
                        </label>
                    </div>
                    {rules && <p className="text-xs text-slate-500">{rules}</p>}
                    <p className="text-xs text-slate-500">
                        סוף המנוי יידחה בימי ההקפאה. הרשמות בתקופה הזו יבוטלו{m.kind === "punch" ? " והכניסות יחזרו" : ""}, ותישלח הודעה ל{m.client_name}.
                        העמלה נרשמת במנוי — לא נגבית.
                    </p>
                    <div className="flex gap-2">
                        <button type="button" disabled={busy || !until}
                            onClick={() => post("freeze", { from_on: from, until_on: until, reason: reason.trim() || null, fee_cents: fee === "" ? 0 : Math.round(fee * 100) }, "המנוי הוקפא")}
                            className="inline-flex items-center gap-2 min-h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}הקפאה
                        </button>
                        <button type="button" onClick={() => setMode(null)} className="min-h-10 px-3 text-sm text-slate-600">ביטול</button>
                    </div>
                </div>
            )}

            {(mode === "stop" || mode === "cancel") && (
                <div className={`rounded-xl border p-3 space-y-2 ${mode === "cancel" ? "border-rose-200 bg-rose-50/50" : "border-slate-200"}`}>
                    <p className="text-sm text-slate-800">
                        {mode === "stop"
                            ? `המנוי ימשיך עד ${m.ends_on ? fullDate(m.ends_on) : "סוף הכניסות"} ואז יסתיים בלי חידוש. ההרשמות נשארות.`
                            : `המנוי יסתיים היום.${m.coming_bookings ? ` ${m.coming_bookings === 1 ? "הרשמה עתידית אחת תבוטל" : `${m.coming_bookings} הרשמות עתידיות יבוטלו`}${m.kind === "punch" ? " והכניסות יחזרו" : ""}.` : ""} אין החזר כספי אוטומטי.`}
                    </p>
                    <label className="block text-xs text-slate-600">סיבה (לא חובה)
                        <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} className={field} />
                    </label>
                    <div className="flex gap-2">
                        <button type="button" disabled={busy}
                            onClick={() => post(mode, { reason: reason.trim() || null }, mode === "stop" ? "המנוי ייעצר בסוף התקופה" : "המנוי בוטל")}
                            className={`inline-flex items-center gap-2 min-h-10 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-40 ${mode === "cancel" ? "bg-rose-600" : "bg-indigo-600"}`}>
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}{mode === "stop" ? "עצירה בסוף התקופה" : "לבטל את המנוי"}
                        </button>
                        <button type="button" onClick={() => setMode(null)} className="min-h-10 px-3 text-sm text-slate-600">חזרה</button>
                    </div>
                </div>
            )}

            {m.events.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1">היסטוריית המנוי</p>
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {[...m.events].reverse().map((e, i) => (
                            <li key={i} className="px-3 py-2 flex items-start justify-between gap-2 text-sm">
                                <span className="text-slate-800">
                                    {ACTION[e.action] ?? e.action}
                                    {e.action === "freeze" && e.effective_on ? ` מ-${fullDate(e.effective_on)}, ${e.days} ימים` : ""}
                                    {e.action === "unfreeze" && e.days ? ` (הוחזרו ${-e.days} ימים)` : ""}
                                    {e.fee_cents ? ` · עמלה ${shekels(e.fee_cents)}` : ""}
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
