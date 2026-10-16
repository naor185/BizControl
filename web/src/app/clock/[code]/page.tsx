"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LogIn, LogOut, CircleAlert, CircleCheck, Undo2 } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

// The page the barcode (or the NFC sticker) at the business's door opens (app/services/nfc_clock.py): the worker's own
// phone, signed in to their own account, scanned or touched it — they're clocked in, or out, at once. A touch by mistake is taken back here within
// two minutes; later, the owner or a manager fixes it.

// "check": the owner scanned it — the barcode works; the owner doesn't clock
type Tap = { action: "in" | "out" | "check"; at: string; name: string; session_id: string; repeat: boolean };

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
            .catch(e => setErr((e as Error)?.message || "משהו השתבש — נסו לסרוק שוב"));
    }, [code]);

    useEffect(() => {
        if (!tap || tap.action === "check") return;
        const t = setTimeout(() => setCanUndo(false), 110_000);
        return () => clearTimeout(t);
    }, [tap]);

    const undo = async () => {
        if (!tap) return;
        try {
            await apiFetch("/api/nfc/undo", { method: "POST", body: JSON.stringify({ session_id: tap.session_id }) });
            setUndone(true);
        } catch (e) {
            setErr((e as Error)?.message || "לא ניתן לבטל");
        }
    };

    const time = tap ? new Date(tap.at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "";
    const date = tap ? new Date(tap.at).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }) : "";
    const isIn = tap?.action === "in";

    return (
        <main className="min-h-dvh flex items-center justify-center bg-slate-50 p-6" dir="rtl">
            <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center" role="status" aria-live="polite">
                {err ? (
                    <>
                        <CircleAlert className="w-14 h-14 mx-auto text-rose-500" aria-hidden />
                        <p className="mt-4 text-lg font-bold text-slate-900">{err}</p>
                    </>
                ) : !tap ? (
                    <p className="text-slate-500 py-10">רושם…</p>
                ) : tap.action === "check" ? (
                    <>
                        <CircleCheck className="w-14 h-14 mx-auto text-emerald-600" aria-hidden />
                        <p className="mt-4 text-xl font-black text-slate-900">הברקוד עובד</p>
                        <p className="mt-2 text-slate-600 leading-relaxed">כשעובד או מנהל סורקים אותו מהטלפון שלהם, נרשמת להם כניסה — ובסריקה הבאה יציאה. בעל העסק לא מחתים שעון.</p>
                    </>
                ) : undone ? (
                    <>
                        <Undo2 className="w-14 h-14 mx-auto text-slate-400" aria-hidden />
                        <p className="mt-4 text-xl font-black text-slate-900">בוטל</p>
                        <p className="mt-1 text-slate-600">{isIn ? "הכניסה לא נרשמה." : "המשמרת ממשיכה — היציאה לא נרשמה."}</p>
                    </>
                ) : (
                    <>
                        <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${isIn ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                            {isIn ? <LogIn className="w-10 h-10" aria-hidden /> : <LogOut className="w-10 h-10" aria-hidden />}
                        </div>
                        <p className="mt-5 text-slate-600">שלום {tap.name}</p>
                        <p className="mt-1 text-2xl font-black text-slate-900">{isIn ? "נכנסת לעבודה" : "יצאת מהעבודה"}</p>
                        <p className="mt-3 text-5xl font-black tabular-nums text-slate-900">{time}</p>
                        <p className="mt-1 text-sm text-slate-500">{date}</p>
                        {tap.repeat && <p className="mt-3 text-sm text-slate-500">כבר נרשם לפני רגע — לא נרשם שוב.</p>}
                        {canUndo && (
                            <button type="button" onClick={undo}
                                className="mt-6 inline-flex items-center gap-1.5 min-h-11 px-5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50">
                                <Undo2 className="w-4 h-4" aria-hidden /> טעות? ביטול
                            </button>
                        )}
                    </>
                )}
                <Link href="/calendar" className="mt-6 block text-sm font-semibold text-sky-700 hover:underline">ליומן</Link>
            </div>
        </main>
    );
}

export default function ClockPage() {
    return <RequireAuth><ClockTap /></RequireAuth>;
}
