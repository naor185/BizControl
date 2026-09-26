"use client";

import { useEffect, useState } from "react";
import { Printer, RefreshCw, Loader2, QrCode } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { BIZFIND_URL } from "@/lib/config";

// The business's check-in code (GET /api/classes/checkin-code): a QR code of its BizFind check-in page with a
// secret key — printed and hung at the entrance. Clients scan it signed in on BizFind: a booked class starting
// now is marked as attended (app/services/class_checkin.py). Replacing it makes old prints stop working.

type Code = { slug: string; name: string; key: string };

export default function CheckinCode() {
    const [code, setCode] = useState<Code | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmRenew, setConfirmRenew] = useState(false);
    const url = code && BIZFIND_URL ? `${BIZFIND_URL}/b/${code.slug}/checkin?k=${encodeURIComponent(code.key)}` : null;

    useEffect(() => {
        apiFetch<Code>("/api/classes/checkin-code").then(setCode).catch(e => setError(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, []);
    useEffect(() => {
        if (!url) return;
        import("qrcode").then(m => m.default.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: "M" })).then(setQr);
    }, [url]);

    const renew = async () => {
        setBusy(true);
        try {
            setCode(await apiFetch<Code>("/api/classes/checkin-code/renew", { method: "POST" }));
            setConfirmRenew(false);
            toast.success("נוצר קוד חדש — הדפיסו ותלו אותו במקום הישן");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    const print = () => {
        if (!qr || !code) return;
        const w = window.open("", "_blank", "width=720,height=900");
        if (!w) { toast.error("הדפדפן חסם את חלון ההדפסה"); return; }
        const esc = (t: string) => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch] as string));
        w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>צ׳ק-אין · ${esc(code.name)}</title>
<style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#111}h1{font-size:34px;margin:0 0 8px}p{font-size:20px;margin:0 0 28px;color:#333}img{width:420px;height:420px}small{display:block;margin-top:24px;font-size:15px;color:#555}</style>
</head><body><h1>${esc(code.name)}</h1><p>סורקים בכניסה — צ׳ק-אין לשיעור</p><img src="${qr}" alt="קוד צ׳ק-אין"><small>פותחים את המצלמה בטלפון, מכוונים לקוד ומתחברים עם מספר הטלפון.</small>
<script>window.onload=function(){window.print()}</script></body></html>`);
        w.document.close();
    };

    if (error) {
        return <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">{error.includes("הרשאה") ? "קוד הצ׳ק-אין — לבעלים או למנהל." : error}</p>;
    }
    return (
        <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 space-y-4">
            <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-800"><QrCode className="w-4.5 h-4.5 text-indigo-600" aria-hidden />קוד צ׳ק-אין לכניסה</h3>
                <p className="text-sm text-slate-500 mt-1 max-w-xl">
                    מדפיסים ותולים בכניסה. הלקוח סורק בטלפון ומסומן/ת &quot;הגיע/ה&quot; לשיעור שנרשם/ה אליו. מתי אפשר לסרוק ומה קורה כשאין הרשמה — בלשונית הכללים, תחת &quot;צ׳ק-אין בכניסה&quot;.
                </p>
            </div>
            {!BIZFIND_URL ? (
                <p className="text-sm text-amber-900 bg-amber-50 rounded-xl px-3 py-2">כתובת BizFind לא מוגדרת במערכת — פנו לתמיכה של BizControl.</p>
            ) : !qr ? (
                <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label="טוען" />
            ) : (
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt="קוד צ׳ק-אין לכניסה" className="w-56 h-56 rounded-xl border border-slate-200" />
                    <div className="flex flex-col gap-2 w-full sm:w-auto">
                        <button type="button" onClick={print}
                            className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold">
                            <Printer className="w-4 h-4" aria-hidden /> הדפסה
                        </button>
                        {confirmRenew ? (
                            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 space-y-2 max-w-xs">
                                <p className="text-sm text-slate-800">קוד חדש? הקוד המודפס הישן יפסיק לעבוד מיד.</p>
                                <div className="flex gap-2">
                                    <button type="button" disabled={busy} onClick={renew}
                                        className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-40">
                                        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} ליצור קוד חדש
                                    </button>
                                    <button type="button" onClick={() => setConfirmRenew(false)} className="min-h-10 px-3 text-sm text-slate-600">חזרה</button>
                                </div>
                            </div>
                        ) : (
                            <button type="button" onClick={() => setConfirmRenew(true)}
                                className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:border-slate-400">
                                <RefreshCw className="w-4 h-4" aria-hidden /> החלפת הקוד
                            </button>
                        )}
                        <p className="text-xs text-slate-400 max-w-xs">כדאי להחליף אם הקוד צולם והופץ מחוץ לעסק.</p>
                    </div>
                </div>
            )}
        </section>
    );
}
