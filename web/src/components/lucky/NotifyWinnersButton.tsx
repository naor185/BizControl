"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { tx } from "@/lib/i18n";
import { Draw } from "@/lib/luckyClub";

// The WhatsApp to every winner not told yet (app/services/lucky_draw.notify; the owner, 2026-11-04) — pressed after the
// reveal, never sent at the draw itself, so no winner's phone gives the wheel away. On the draw's page and at the end
// of the wheel's screen.

export default function NotifyWinnersButton({ draw, onSent, className }: { draw: Draw; onSent?: (d: Draw) => void; className?: string }) {
    const [busy, setBusy] = useState(false);
    const waiting = draw.winners.filter(w => !w.notified_at).length;
    const send = async () => {
        setBusy(true);
        try {
            const r = await apiFetch<{ sent: number; no_phone: string[] }>(`/api/lucky-club/draws/${draw.id}/notify`, {
                method: "POST", body: JSON.stringify({}),
            });
            if (r.sent) toast.success(r.sent === 1 ? tx("ההודעה נשלחה לזוכה") : tx("ההודעה נשלחה ל-{0} זוכים", { 0: r.sent }));
            if (r.no_phone.length) toast.error(tx("אין טלפון ל: {0}", { 0: r.no_phone.join(", ") }));
            const now = new Date().toISOString();
            onSent?.({ ...draw, winners: draw.winners.map(w => (w.notified_at || r.no_phone.includes(w.full_name)) ? w : { ...w, notified_at: now }) });
        } catch (e) {
            toast.error((e as Error)?.message || tx("השליחה נכשלה"));
        } finally {
            setBusy(false);
        }
    };
    if (draw.status !== "done" || waiting === 0) return null;
    return (
        <button type="button" onClick={send} disabled={busy}
            className={className ?? "inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"}>
            <Send className="h-4 w-4" aria-hidden /> {busy ? tx("שולח...") : waiting === 1 ? tx("שליחת הודעה לזוכה") : tx("שליחת הודעה לזוכים")}
        </button>
    );
}
