"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LogIn, LogOut, CircleAlert, CircleCheck, Coffee, Play, Undo2 } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { PresenceList, usePresence } from "@/components/team/PresenceNow";

import { tx, intl } from "@/lib/i18n";
// The page the barcode (or the NFC sticker) at the business's door opens (app/services/nfc_clock.py): the worker's own
// phone, signed in to their own account, scanned or touched it — they're clocked in, or out, at once. A touch by mistake is taken back here within
// two minutes; later, the owner or a manager fixes it.

// "check": the owner scanned it — the barcode works; the owner doesn't clock, and sees who is on shift now and for how
// long (the owner, 2026-10-18: "it opens the clock — I want to see the workers' clock")
// "back": the worker was on a break — the scan ends it, the shift goes on; "break": the clock-out just now was a break
type Tap = { action: "in" | "out" | "back" | "break" | "check"; at: string; name: string; session_id: string; repeat: boolean };

function ClockTap() {
    const { code } = useParams<{ code: string }>();
    const [tap, setTap] = useState<Tap | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [undone, setUndone] = useState(false);
    const [canUndo, setCanUndo] = useState(true);
    const sent = useRef(false);

    useEffect(() => {
        if (sent.current) return;               // one touch, one request — even when React runs the effect twice
        sent.current = true;
        apiFetch<Tap>("/api/nfc/tap", { method: "POST", body: JSON.stringify({ code }) })
            .then(setTap)
            .catch(e => setErr((e as Error)?.message || tx("משהו השתבש — נסו לסרוק שוב")));
    }, [code]);

    useEffect(() => {
        if (!tap || tap.action === "check") return;
        const t = setTimeout(() => setCanUndo(false), 110_000);
        return () => clearTimeout(t);
    }, [tap]);

    const wasBreak = async () => {
        if (!tap) return;
        try {
            const r = await apiFetch<{ at: string }>("/api/nfc/to-break", { method: "POST", body: JSON.stringify({ session_id: tap.session_id }) });
            setTap({ ...tap, action: "break", at: r.at });
        } catch (e) {
            setErr((e as Error)?.message || tx("לא ניתן"));
        }
    };

    const undo = async () => {
        if (!tap) return;
        try {
            await apiFetch("/api/nfc/undo", { method: "POST", body: JSON.stringify({ session_id: tap.session_id }) });
            setUndone(true);
        } catch (e) {
            setErr((e as Error)?.message || tx("לא ניתן לבטל"));
        }
    };

    const time = tap ? new Date(tap.at).toLocaleTimeString(intl(), { hour: "2-digit", minute: "2-digit" }) : "";
    const date = tap ? new Date(tap.at).toLocaleDateString(intl(), { weekday: "long", day: "numeric", month: "long" }) : "";
    const isIn = tap?.action === "in";
    const LOOK = {
        in: { icon: LogIn, tone: "bg-emerald-100 text-emerald-700", words: tx("נכנסת לעבודה") },
        out: { icon: LogOut, tone: "bg-sky-100 text-sky-700", words: tx("יצאת מהעבודה") },
        back: { icon: Play, tone: "bg-emerald-100 text-emerald-700", words: tx("חזרת מההפסקה") },
        break: { icon: Coffee, tone: "bg-amber-100 text-amber-700", words: tx("יצאת להפסקה") },
    } as const;
    const look = tap && tap.action !== "check" ? LOOK[tap.action] : LOOK.in;

    return (
        <main className="min-h-dvh flex items-center justify-center bg-[var(--background)] p-6">
            <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center" role="status" aria-live="polite">
                {err ? (
                    <>
                        <CircleAlert className="w-14 h-14 mx-auto text-rose-500" aria-hidden />
                        <p className="mt-4 text-lg font-bold text-slate-900">{err}</p>
                    </>
                ) : !tap ? (
                    <p className="text-slate-500 py-10">{tx("רושם…")}</p>
                ) : tap.action === "check" ? (
                    <OwnerView />
                ) : undone ? (
                    <>
                        <Undo2 className="w-14 h-14 mx-auto text-slate-400" aria-hidden />
                        <p className="mt-4 text-xl font-black text-slate-900">{tx("בוטל")}</p>
                        <p className="mt-1 text-slate-600">{isIn ? tx("הכניסה לא נרשמה.") : tx("המשמרת ממשיכה — היציאה לא נרשמה.")}</p>
                    </>
                ) : (
                    <>
                        <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${look.tone}`}>
                            <look.icon className="w-10 h-10" aria-hidden />
                        </div>
                        <p className="mt-5 text-slate-600">{tx("שלום ")}{tap.name}</p>
                        <p className="mt-1 text-2xl font-black text-slate-900">{look.words}</p>
                        <p className="mt-3 text-5xl font-black tabular-nums text-slate-900">{time}</p>
                        <p className="mt-1 text-sm text-slate-500">{date}</p>
                        {tap.repeat && <p className="mt-3 text-sm text-slate-500">{tx("כבר נרשם לפני רגע — לא נרשם שוב.")}</p>}
                        {tap.action === "break" && <p className="mt-3 text-sm text-slate-600">{tx("זמן ההפסקה לא נספר. בחזרה — סורקים שוב את הברקוד.")}</p>}
                        {tap.action === "out" && !tap.repeat && canUndo && (
                            <button type="button" onClick={wasBreak}
                                className="mt-6 w-full inline-flex items-center justify-center gap-1.5 min-h-12 px-5 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600">
                                <Coffee className="w-5 h-5" aria-hidden /> {tx("רק יצאתי להפסקה")}
                            </button>
                        )}
                        {canUndo && (tap.action === "in" || tap.action === "out") && (
                            <button type="button" onClick={undo}
                                className="mt-6 inline-flex items-center gap-1.5 min-h-11 px-5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50">
                                <Undo2 className="w-4 h-4" aria-hidden /> {tx("טעות? ביטול")}
                            </button>
                        )}
                    </>
                )}
                <Link href="/calendar" className="mt-6 block text-sm font-semibold text-sky-700 hover:underline">{tx("ליומן")}</Link>
            </div>
        </main>
    );
}

// the owner at the door: who is on shift now and for how long — the barcode itself works
function OwnerView() {
    const presence = usePresence();
    return (
        <>
            <p className="text-xl font-black text-slate-900">{tx("בעבודה עכשיו")}</p>
            <div className="mt-3 -mx-4 text-start rounded-2xl border border-slate-100 overflow-hidden">
                {presence ? <PresenceList entries={presence} /> : <p className="px-4 py-3 text-sm text-slate-500">{tx("טוען…")}</p>}
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-start text-xs text-slate-500 leading-relaxed">
                <CircleCheck className="w-4 h-4 shrink-0 text-emerald-600" aria-hidden />
                {tx("הברקוד עובד: עובד או מנהל שסורקים אותו מהטלפון שלהם נרשמים לכניסה, ובסריקה הבאה ליציאה. בעל העסק לא מחתים שעון.")}
            </p>
        </>
    );
}

export default function ClockPage() {
    return <RequireAuth><ClockTap /></RequireAuth>;
}
