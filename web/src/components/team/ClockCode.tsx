"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Nfc, Printer, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { clockQr, downloadClockCard, printClockCard } from "@/lib/clockCard";

// The attendance clock on ניהול צוות (app/services/nfc_clock.py). BizControl turns it on for the business; then the
// owner (and a manager allowed the team) sees its barcode here — to print and hang at the door, or to write on an NFC
// sticker — and can replace it when it got out (owner, 2026-10-16). Everyone else sees only that it's on.

type Status = { included: boolean; on: boolean; link?: string | null; name?: string; from_opening?: boolean; opening?: string };

export default function ClockCode() {
    const [st, setSt] = useState<Status | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [confirmRenew, setConfirmRenew] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => { apiFetch<Status>("/api/nfc/status").then(setSt).catch(() => {}); }, []);
    useEffect(() => { if (st?.link) clockQr(st.link).then(setQr); }, [st?.link]);

    const renew = async () => {
        setBusy(true);
        try {
            setSt(await apiFetch<Status>("/api/nfc/new-code", { method: "POST" }));
            setConfirmRenew(false);
            toast.success("נוצר ברקוד חדש — הדפיסו ותלו אותו במקום הישן");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    if (!st?.included) return null;
    const setFromOpening = async (on: boolean) => {
        try {
            setSt(await apiFetch<Status>("/api/nfc/from-opening", { method: "POST", body: JSON.stringify({ on }) }));
            toast.success(on ? "כניסה לפני שעת הפתיחה תיספר משעת הפתיחה" : "כל כניסה תיספר מרגע הכניסה");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        }
    };
    // a worker due at the opening who clocks in early is paid from the opening (the owner, 2026-10-19)
    const opening = (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p id="from-opening" className="flex-1 text-sm text-slate-700 leading-relaxed">
                <b className="text-slate-900">כניסה לפני שעת הפתיחה ({st.opening ?? "08:00"}) נספרת משעת הפתיחה</b>
                <span className="block text-xs text-slate-500">שעת הכניסה עצמה נשמרת כמו שהייתה. את שעת הפתיחה משנים בהגדרות ← שעות היומן.</span>
            </p>
            <Switch checked={st.from_opening !== false} labelledBy="from-opening" onChange={setFromOpening} />
        </div>
    );
    if (!st.on) {
        return (<div className="space-y-4">{opening}
            <div className="flex items-start gap-3 bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm text-slate-600 leading-relaxed">
                <Nfc className="w-5 h-5 mt-0.5 shrink-0 text-slate-400" aria-hidden />
                <p>
                    <b className="text-slate-800">שעון נוכחות:</b> העובדים והמנהלים מחתימים כניסה ויציאה בכפתור &quot;כניסה&quot; שבראש המסך.
                    רוצים ברקוד או מדבקה בכניסה, כדי שיחתימו רק כשהם באמת בעסק? פנו ל-BizControl.
                </p>
            </div>
        </div>);
    }
    return (<div className="space-y-4">{opening}
        <section className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-4">
            <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-800"><Nfc className="w-4.5 h-4.5 text-emerald-600" aria-hidden />שעון נוכחות — ברקוד בכניסה</h3>
                <p className="text-sm text-slate-600 mt-1 max-w-xl leading-relaxed">
                    העובדים והמנהלים מחתימים כניסה ויציאה בטלפון שלהם: סורקים במצלמה את הברקוד שתלוי בכניסה (או נוגעים במדבקה).
                    כל אחד מחובר לחשבון שלו — כך המערכת יודעת מי נכנס ומי יצא. השעות נרשמות, ומי שמשולם לפי שעות — מקבל לפיהן.
                </p>
            </div>
            {st.link && (
                !qr ? <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" aria-label="טוען" /> : (
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qr} alt="הברקוד להחתמת נוכחות" className="w-44 h-44 rounded-xl border border-slate-200" />
                        <div className="flex flex-col gap-2 w-full sm:w-auto">
                            <button type="button" onClick={() => { if (!printClockCard(qr, st.name ?? "")) toast.error("הדפדפן חסם את חלון ההדפסה"); }}
                                className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold">
                                <Printer className="w-4 h-4" aria-hidden /> הדפסה
                            </button>
                            <button type="button" onClick={() => downloadClockCard(qr, st.name ?? "")}
                                className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:border-slate-400">
                                <Download className="w-4 h-4" aria-hidden /> שמירה כתמונה
                            </button>
                            {confirmRenew ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 space-y-2 max-w-xs">
                                    <p className="text-sm text-slate-800">ברקוד חדש? הברקוד המודפס והמדבקה הישנים יפסיקו לעבוד מיד.</p>
                                    <div className="flex gap-2">
                                        <button type="button" disabled={busy} onClick={renew}
                                            className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-40">
                                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} ליצור ברקוד חדש
                                        </button>
                                        <button type="button" onClick={() => setConfirmRenew(false)} className="min-h-10 px-3 text-sm text-slate-600">חזרה</button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setConfirmRenew(true)}
                                    className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:border-slate-400">
                                    <RefreshCw className="w-4 h-4" aria-hidden /> ברקוד חדש
                                </button>
                            )}
                            <p className="text-xs text-slate-400 max-w-xs">כדאי להחליף אם הברקוד צולם ויצא מהעסק — כדי שאף אחד לא יחתים מהבית.</p>
                        </div>
                    </div>
                )
            )}
            {/* the NFC sticker comes only from BizControl (the owner, 2026-10-19) — no instructions to write one here */}
            {st.link && <p className="text-xs text-slate-500">רוצים גם מדבקת NFC בכניסה? מזמינים אותה מ-BizControl.</p>}
        </section>
    </div>);
}
