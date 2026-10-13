"use client";

import { useEffect, useState } from "react";
import { Nfc, Copy, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// The superadmin's card for a business's NFC attendance clock (app/services/nfc_clock.py): on / off, the link to write
// on the sticker he sends, and a new code when a sticker is lost or its link got out. Only he sees the code.

type Clock = { on: boolean; link: string | null };

export default function NfcClockAdmin({ studioId }: { studioId: string }) {
    const [clock, setClock] = useState<Clock | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        apiFetch<Clock>(`/api/admin/studios/${studioId}/nfc-clock`).then(setClock).catch(() => setClock(null));
    }, [studioId]);

    const act = async (path: string, body?: object, done?: string) => {
        setBusy(true);
        try {
            const c = await apiFetch<Clock>(`/api/admin/studios/${studioId}/nfc-clock${path}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
            setClock(c);
            if (done) toast.success(done);
        } catch (e) {
            toast.error((e as Error)?.message || "שגיאה");
        } finally {
            setBusy(false);
        }
    };

    if (!clock) return null;
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
                <Nfc className="w-4 h-4 text-gray-500" aria-hidden />
                <h2 id="nfc-clock-title" className="text-sm font-semibold text-gray-700 flex-1">שעון נוכחות NFC</h2>
                <span className={`text-xs font-bold ${clock.on ? "text-emerald-700" : "text-gray-400"}`}>{clock.on ? "פעיל" : "כבוי"}</span>
                <Switch checked={clock.on} disabled={busy} labelledBy="nfc-clock-title"
                    onChange={v => act("", { on: v }, v ? "שעון ה-NFC הופעל — נוצר קישור למדבקה" : "שעון ה-NFC כובה — המדבקה הפסיקה לעבוד")} />
            </div>
            {clock.on && clock.link ? (
                <div className="p-4 space-y-3 text-sm">
                    <div>
                        <div className="text-xs font-semibold text-gray-500 mb-1">הקישור לכתיבה על המדבקה</div>
                        <div className="flex items-center gap-2">
                            <code dir="ltr" className="flex-1 min-w-0 truncate rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs">{clock.link}</code>
                            <button type="button" onClick={() => { navigator.clipboard?.writeText(clock.link!); toast.success("הקישור הועתק"); }}
                                className="shrink-0 inline-flex items-center gap-1 min-h-10 px-3 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50">
                                <Copy className="w-3.5 h-3.5" aria-hidden /> העתק
                            </button>
                        </div>
                    </div>
                    <ol className="list-decimal pr-5 space-y-1 text-gray-600">
                        <li>באפליקציה <b>NFC Tools</b>: <bdi dir="ltr">Write → Add a record → URL</bdi>, והדבק את הקישור.</li>
                        <li>Write, וקרב את המדבקה לטלפון.</li>
                        <li>שלח את המדבקה לעסק — מדביקים אותה בכניסה.</li>
                    </ol>
                    <button type="button" disabled={busy}
                        onClick={() => { if (confirm("קוד חדש — המדבקה הנוכחית תפסיק לעבוד, וצריך לשלוח לעסק מדבקה חדשה. להמשיך?")) act("/new-code", undefined, "נוצר קוד חדש — המדבקה הישנה הפסיקה לעבוד"); }}
                        className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50">
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden /> קוד חדש (מדבקה אבדה או שהקישור דלף)
                    </button>
                </div>
            ) : (
                <p className="p-4 text-sm text-gray-500">כשמפעילים, נוצר לעסק קישור לכתיבה על מדבקת NFC — העובדים נוגעים בה עם הטלפון ונרשמים לכניסה וליציאה.</p>
            )}
        </div>
    );
}
