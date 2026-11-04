"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Trash2, Trophy, Users } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import PlanLock from "@/components/PlanLock";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { intl, tx } from "@/lib/i18n";
import { audienceLabel, Draw, STATUS } from "@/lib/luckyClub";

// Lucky Club — the business's draws: what's being prepared, and the history (the owner's spec, 2026-11-04). Reached from
// the club tab (components/lucky/LuckyClubCard); each draw opens in /clients/lucky/[id].

const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(intl(), { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

function DrawRow({ d }: { d: Draw }) {
    const date = d.status === "done" ? when(d.drawn_at) : when(d.scheduled_at);
    return (
        <Link href={`/clients/lucky/${d.id}`}
            className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
            {d.image_url
                ? <img src={d.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Trophy className="h-7 w-7" aria-hidden /></span>}
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{d.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[d.status].chip}`}>{STATUS[d.status].label}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />
                        {tx("{0} משתתפים", { 0: d.participants_count })}</span>
                    <span>{audienceLabel(d.audience)}</span>
                    <span>{d.winners_count === 1 ? tx("זוכה אחד") : tx("{0} זוכים", { 0: d.winners_count })}</span>
                    {date && <span>{d.status === "done" ? tx("הוגרלה {0}", { 0: date }) : date}</span>}
                </div>
                {d.winners.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                        {d.winners.map(w => (
                            <li key={w.id} className="flex flex-wrap items-center gap-x-2">
                                <span className="font-semibold text-slate-800">{w.place}. {w.full_name}</span>
                                <span className="text-slate-500">— {w.prize_title}</span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${w.status === "redeemed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                                    {w.status === "redeemed" ? tx("מומש") : tx("ממתין למימוש")}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <ChevronLeft className="h-5 w-5 shrink-0 self-center text-slate-400 ltr:-scale-x-100" aria-hidden />
        </Link>
    );
}

function Draws() {
    const [draws, setDraws] = useState<Draw[] | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<Draw[]>("/api/lucky-club/draws").then(setDraws).catch(e => setErr(e?.message || tx("הטעינה נכשלה")));
    }, []);

    // the managers clear the history (the owner, 2026-11-04) — the activity log keeps the line
    const remove = async (d: Draw) => {
        if (!confirm(tx("למחוק את ההגרלה „{0}” מההיסטוריה? אי אפשר לשחזר אותה.", { 0: d.name }))) return;
        try {
            await apiFetch(`/api/lucky-club/draws/${d.id}`, { method: "DELETE" });
            setDraws(prev => (prev || []).filter(x => x.id !== d.id));
            toast.success(tx("ההגרלה נמחקה"));
        } catch (e) {
            toast.error((e as Error)?.message || tx("המחיקה נכשלה"));
        }
    };

    const active = (draws || []).filter(d => d.status === "draft" || d.status === "locked");
    const history = (draws || []).filter(d => d.status === "done" || d.status === "canceled");

    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <Link href="/clients?tab=club" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
                <ChevronRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden /> {tx("מועדון הלקוחות")}
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">{tx("Lucky Club — הגרלות ופרסים")}</h1>
                    <p className="mt-1 text-sm text-slate-600">{tx("הגרלה בין הלקוחות שלך: בוחרים מי משתתף ומה הפרסים, והמערכת בוחרת את הזוכים באקראי.")}</p>
                </div>
                <Link href="/clients/lucky/new"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm hover:bg-amber-600">
                    <Plus className="h-4 w-4" aria-hidden /> {tx("הגרלה חדשה")}
                </Link>
            </div>

            {err && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div>}
            {draws === null && !err && (
                <div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-amber-500" /></div>
            )}
            {draws?.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                    <Trophy className="mx-auto mb-3 h-10 w-10 text-amber-500" aria-hidden />
                    <p className="font-bold text-slate-800">{tx("עוד אין הגרלות")}</p>
                    <p className="mt-1 text-sm text-slate-500">{tx("צרו הגרלה ראשונה — שם, מי משתתף ופרס לכל זוכה.")}</p>
                </div>
            )}
            {active.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{tx("בהכנה")}</h2>
                    {active.map(d => <DrawRow key={d.id} d={d} />)}
                </section>
            )}
            {history.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{tx("היסטוריה")}</h2>
                    {history.map(d => (
                        <div key={d.id} className="flex items-stretch gap-2">
                            <div className="min-w-0 flex-1"><DrawRow d={d} /></div>
                            <button type="button" onClick={() => remove(d)} aria-label={tx("מחיקת ההגרלה „{0}”", { 0: d.name })} title={tx("מחיקת ההגרלה")}
                                className="flex w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                                <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
}

export default function LuckyClubPage() {
    return (
        <RequireAuth>
            <AppShell title={tx("Lucky Club")}>
                <PlanLock module="lucky_club" feature={tx("Lucky Club — הגרלות ופרסים")}>
                    <Draws />
                </PlanLock>
            </AppShell>
        </RequireAuth>
    );
}
