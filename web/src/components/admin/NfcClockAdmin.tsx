"use client";

import { useEffect, useState } from "react";
import { Nfc, Copy, RefreshCw, Download, Printer, MessageCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { clockQr, downloadClockCard, printClockCard } from "@/lib/clockCard";
import { whatsappNumber } from "@/lib/format";

import { tx } from "@/lib/i18n";
// The superadmin's card for a business's attendance clock (app/services/nfc_clock.py): on / off, and the business's
// own clock link — to write on an NFC sticker, or as a barcode to print and hang at the door (the camera opens the
// same link). The owner, 2026-10-16: "the superadmin opens it, with the barcode — I send the business owner the
// barcode and the link": the barcode as an image to download or print, and a message for the owner ready to copy or
// open in WhatsApp (attach the image there). A new code when a sticker or a print is lost or its link got out.

type Clock = { on: boolean; link: string | null; included: boolean };   // included: the plan has the attendance clock

export default function NfcClockAdmin({ studioId, studioName, ownerName, ownerPhone }: {
    studioId: string; studioName: string; ownerName: string | null; ownerPhone: string | null;
}) {
    const [clock, setClock] = useState<Clock | null>(null);
    const [busy, setBusy] = useState(false);
    const [qr, setQr] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<Clock>(`/api/admin/studios/${studioId}/nfc-clock`).then(setClock).catch(() => setClock(null));
    }, [studioId]);
    useEffect(() => {
        if (!clock?.link) return;
        clockQr(clock.link).then(setQr);
    }, [clock?.link]);

    const act = async (path: string, body?: object, done?: string) => {
        setBusy(true);
        try {
            const c = await apiFetch<Clock>(`/api/admin/studios/${studioId}/nfc-clock${path}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
            setClock(c);
            if (done) toast.success(done);
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה"));
        } finally {
            setBusy(false);
        }
    };

    const message = clock?.link
        ? `שלום${ownerName ? ` ${ownerName}` : ""}, הפעלנו לך שעון נוכחות ב-BizControl.\n`
          + "העובדים מחתימים כניסה ויציאה בטלפון שלהם — סורקים עם המצלמה את הברקוד המצורף (או נוגעים במדבקה בכניסה), כשהם מחוברים לחשבון שלהם.\n"
          + "מומלץ להדפיס את הברקוד ולתלות אותו ליד הכניסה. השעות נכנסות לדוח השכר.\n"
          + `הקישור של העסק: ${clock.link}`
        : "";

    const download = () => { if (qr) downloadClockCard(qr, studioName); };
    const print = () => { if (qr && !printClockCard(qr, studioName)) toast.error("הדפדפן חסם את חלון ההדפסה"); };

    if (!clock) return null;
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
                <Nfc className="w-4 h-4 text-gray-500" aria-hidden />
                <h2 id="nfc-clock-title" className="text-sm font-semibold text-gray-700 flex-1">{tx("שעון נוכחות — מדבקה וברקוד")}</h2>
                <span className={`text-xs font-bold ${clock.on ? "text-emerald-700" : "text-gray-400"}`}>{clock.on ? tx("פעיל") : tx("כבוי")}</span>
                <Switch checked={clock.on} disabled={busy} labelledBy="nfc-clock-title"
                    onChange={v => act("", { on: v }, v ? tx("שעון הנוכחות הופעל — נוצר קישור וברקוד לעסק") : tx("שעון הנוכחות כובה — המדבקה והברקוד הפסיקו לעבוד"))} />
            </div>
            {!clock.included && (
                <p className="mx-4 mt-3 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-900">
                    {tx("המסלול של העסק לא כולל שעון נוכחות (הוא בפרו, בחברה גדולה ובחודש הניסיון) — העובדים לא יוכלו להחתים, גם כשהשעון פעיל כאן. אפשר לפתוח לעסק הזה \"שעון נוכחות\" בנפרד, במסך")} <a href="/admin/modules" className="underline font-semibold">{tx("מודולים")}</a>.
                </p>
            )}
            {clock.on && clock.link ? (
                <div className="p-4 space-y-4 text-sm">
                    <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
                        {qr && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qr} alt={tx("הברקוד להחתמת נוכחות")} className="w-40 h-40 rounded-xl border border-gray-200 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0 w-full space-y-2">
                            <div className="text-xs font-semibold text-gray-500">{tx("הקישור של העסק — במדבקה או בברקוד")}</div>
                            <div className="flex items-center gap-2">
                                <code dir="ltr" className="flex-1 min-w-0 truncate rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs">{clock.link}</code>
                                <button type="button" onClick={() => { navigator.clipboard?.writeText(clock.link!); toast.success(tx("הקישור הועתק")); }}
                                    className="shrink-0 inline-flex items-center gap-1 min-h-10 px-3 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50">
                                    <Copy className="w-3.5 h-3.5" aria-hidden /> {tx("העתק")}
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" disabled={!qr} onClick={download}
                                    className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg bg-gray-900 text-white text-xs font-bold hover:bg-gray-700 disabled:opacity-50">
                                    <Download className="w-3.5 h-3.5" aria-hidden /> {tx("הורדת הברקוד (תמונה)")}
                                </button>
                                <button type="button" disabled={!qr} onClick={print}
                                    className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">
                                    <Printer className="w-3.5 h-3.5" aria-hidden /> {tx("הדפסה")}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* the message to the business owner */}
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
                        <div className="text-xs font-semibold text-gray-500">{tx("הודעה לבעל העסק")}</div>
                        <p className="whitespace-pre-line text-xs text-gray-700 leading-relaxed">{message}</p>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => { navigator.clipboard?.writeText(message); toast.success(tx("ההודעה הועתקה")); }}
                                className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold hover:bg-gray-50">
                                <Copy className="w-3.5 h-3.5" aria-hidden /> {tx("העתקת ההודעה")}
                            </button>
                            {ownerPhone && (
                                <a href={`https://wa.me/${whatsappNumber(ownerPhone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                                    <MessageCircle className="w-3.5 h-3.5" aria-hidden />{tx(" פתיחה בוואטסאפ ל")}{ownerName || tx("בעל העסק")}
                                </a>
                            )}
                        </div>
                        <p className="text-[11px] text-gray-400">{tx("בוואטסאפ: צרפו את תמונת הברקוד שהורדתם.")}</p>
                    </div>

                    <details className="text-gray-600">
                        <summary className="cursor-pointer text-xs font-semibold text-gray-500">{tx("כתיבה על מדבקת NFC")}</summary>
                        <ol className="list-decimal ps-5 space-y-1 mt-2">
                            <li>{tx("באפליקציה ")}<b>NFC Tools</b>: <bdi dir="ltr">Write → Add a record → URL</bdi>{tx(", והדבק את הקישור.")}</li>
                            <li>{tx("Write, וקרב את המדבקה לטלפון.")}</li>
                            <li>{tx("שלח את המדבקה לעסק — מדביקים אותה בכניסה.")}</li>
                        </ol>
                    </details>

                    <button type="button" disabled={busy}
                        onClick={() => { if (confirm(tx("קוד חדש — המדבקה והברקוד הנוכחיים יפסיקו לעבוד, וצריך לשלוח לעסק חדשים. להמשיך?"))) act("/new-code", undefined, tx("נוצר קוד חדש — המדבקה והברקוד הישנים הפסיקו לעבוד")); }}
                        className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50">
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden /> {tx("קוד חדש (מדבקה או ברקוד אבדו, או שהקישור דלף)")}
                    </button>
                </div>
            ) : (
                <p className="p-4 text-sm text-gray-500">{tx("כשמפעילים, נוצרים לעסק קישור וברקוד משלו — העובדים סורקים את הברקוד (או נוגעים במדבקת NFC) עם הטלפון ונרשמים לכניסה וליציאה.")}</p>
            )}
        </div>
    );
}
