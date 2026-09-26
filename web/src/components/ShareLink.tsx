"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink, MessageCircle, Printer, QrCode } from "lucide-react";
import { toast } from "@/lib/toast";

// A link the business hands out (the gift card shop, a coupon): the address, copy, send on WhatsApp, open, and a QR
// code to print. One piece for every such link.
export default function ShareLink({ url, whatsappText, printTitle, printLine }: {
    url: string;
    whatsappText: string;          // the message the link goes out with
    printTitle: string;            // the printed QR page's heading
    printLine: string;             // and the line under it
}) {
    const [qr, setQr] = useState<string | null>(null);
    const [showQr, setShowQr] = useState(false);

    useEffect(() => {
        if (!showQr || qr) return;
        import("qrcode").then(m => m.default.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: "M" })).then(setQr);
    }, [showQr, qr, url]);
    useEffect(() => { setQr(null); }, [url]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success("הקישור הועתק");
        } catch {
            toast.error("לא הצלחנו להעתיק — סמנו את הקישור והעתיקו ידנית");
        }
    };

    const print = () => {
        if (!qr) return;
        const w = window.open("", "_blank", "width=720,height=900");
        if (!w) { toast.error("הדפדפן חסם את חלון ההדפסה"); return; }
        const esc = (t: string) => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch] as string));
        w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(printTitle)}</title>
<style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#111}h1{font-size:34px;margin:0 0 8px}p{font-size:20px;margin:0 0 28px;color:#333}img{width:420px;height:420px}small{display:block;margin-top:24px;font-size:14px;color:#555;direction:ltr}</style>
</head><body><h1>${esc(printTitle)}</h1><p>${esc(printLine)}</p><img src="${qr}" alt=""><small>${esc(url)}</small>
<script>window.onload=function(){window.print()}</script></body></html>`);
        w.document.close();
    };

    const btn = "inline-flex items-center justify-center gap-1.5 min-h-10 px-3 rounded-xl text-sm font-semibold transition-colors";
    return (
        <div className="space-y-3">
            <div dir="ltr" className="text-sm font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-700 break-all select-all">{url}</div>
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copy} className={`${btn} bg-slate-900 hover:bg-slate-700 text-white`}>
                    <Copy className="w-4 h-4" aria-hidden /> העתקה
                </button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`${whatsappText}\n${url}`)}`} target="_blank" rel="noopener"
                    className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
                    <MessageCircle className="w-4 h-4" aria-hidden /> שליחה בוואטסאפ
                </a>
                <a href={url} target="_blank" rel="noopener" className={`${btn} border border-slate-200 text-slate-700 hover:border-slate-400`}>
                    <ExternalLink className="w-4 h-4" aria-hidden /> פתיחה
                </a>
                <button type="button" onClick={() => setShowQr(v => !v)} className={`${btn} border border-slate-200 text-slate-700 hover:border-slate-400`}>
                    <QrCode className="w-4 h-4" aria-hidden /> קוד QR
                </button>
            </div>
            {showQr && (
                <div className="flex items-center gap-4">
                    {qr ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qr} alt="קוד QR של הקישור" className="w-40 h-40 rounded-xl border border-slate-200" />
                    ) : <div className="w-40 h-40 rounded-xl bg-slate-100 animate-pulse" />}
                    <button type="button" onClick={print} disabled={!qr} className={`${btn} border border-slate-200 text-slate-700 hover:border-slate-400 disabled:opacity-40`}>
                        <Printer className="w-4 h-4" aria-hidden /> הדפסה
                    </button>
                </div>
            )}
        </div>
    );
}
