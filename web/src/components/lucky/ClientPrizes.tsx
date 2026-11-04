"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Send, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { tx } from "@/lib/i18n";
import { usePlan } from "@/lib/usePlan";
import { ClientPrize, daysLeft, placeLabel, PRIZE_STATUS, prizeDetails } from "@/lib/luckyClub";

// What the client won in Lucky Club, on their card in the CRM (the owner, 2026-11-04: "kept in the client's CRM, so the
// system knows they have a discount or extra points until a date") — the prize, its code, until when, whether it was
// used; a reminder on WhatsApp while it waits. Only where the business has Lucky Club, for the managers (workers get
// nothing from the server, and nothing shows).

export default function ClientPrizes({ clientId }: { clientId: string }) {
    const plan = usePlan();
    const on = plan.ready && plan.has("lucky_club");
    const [prizes, setPrizes] = useState<ClientPrize[]>([]);
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        if (!on) return;
        apiFetch<ClientPrize[]>(`/api/lucky-club/clients/${clientId}/prizes`).then(setPrizes).catch(() => setPrizes([]));
    }, [on, clientId]);

    const remind = async (p: ClientPrize) => {
        setBusy(p.id);
        try {
            const r = await apiFetch<{ sent: number }>(`/api/lucky-club/draws/${p.draw_id}/notify`, {
                method: "POST", body: JSON.stringify({ winner_id: p.id }),
            });
            if (r.sent) {
                toast.success(tx("ההודעה נשלחה"));
                setPrizes(list => list.map(x => x.id === p.id ? { ...x, notified_at: new Date().toISOString() } : x));
            } else toast.error(tx("ללקוח אין טלפון"));
        } catch (e) {
            toast.error((e as Error)?.message || tx("השליחה נכשלה"));
        } finally {
            setBusy(null);
        }
    };

    const markUsed = async (p: ClientPrize) => {
        setBusy(p.id);
        try {
            const w = await apiFetch<{ status: ClientPrize["status"]; redeemed_at: string | null }>(`/api/lucky-club/winners/${p.id}/redeem`, {
                method: "POST", body: JSON.stringify({ redeemed: true }),
            });
            setPrizes(list => list.map(x => x.id === p.id ? { ...x, status: w.status, redeemed_at: w.redeemed_at } : x));
        } catch (e) {
            toast.error((e as Error)?.message || tx("העדכון נכשל"));
        } finally {
            setBusy(null);
        }
    };

    if (!on || prizes.length === 0) return null;
    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                <Trophy className="h-4 w-4 text-amber-500" aria-hidden /> {tx("פרסים מהגרלות")}
            </h3>
            <ul className="space-y-2.5">
                {prizes.map(p => {
                    const left = p.status === "pending" ? daysLeft(p.expires_on) : null;
                    return (
                        <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="font-bold text-slate-900">{p.prize_title}</div>
                                    <div className="text-xs text-slate-500">
                                        {p.in_history
                                            ? <Link href={`/clients/lucky/${p.draw_id}`} className="hover:underline">{p.draw_name}</Link>
                                            : p.draw_name} · {placeLabel(p.place)}
                                    </div>
                                </div>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PRIZE_STATUS[p.status].chip}`}>{PRIZE_STATUS[p.status].label}</span>
                            </div>
                            {prizeDetails(p).length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600">
                                    {prizeDetails(p).map(t => <span key={t} dir="auto">{t}</span>)}
                                </div>
                            )}
                            {left !== null && left <= 7 && (
                                <p className="mt-1 text-xs font-semibold text-rose-600">
                                    {left === 0 ? tx("היום היום האחרון למימוש") : left === 1 ? tx("נשאר יום אחד למימוש") : tx("נשארו {0} ימים למימוש", { 0: left })}
                                </p>
                            )}
                            {p.status === "pending" && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    <button type="button" onClick={() => remind(p)} disabled={busy === p.id}
                                        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                                        <Send className="h-3.5 w-3.5" aria-hidden /> {p.notified_at ? tx("תזכורת בוואטסאפ") : tx("הודעה בוואטסאפ")}
                                    </button>
                                    {p.prize_kind !== "points" && (
                                        <button type="button" onClick={() => markUsed(p)} disabled={busy === p.id}
                                            className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                                            <Check className="h-3.5 w-3.5" aria-hidden /> {tx("סימון כמומש")}
                                        </button>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
