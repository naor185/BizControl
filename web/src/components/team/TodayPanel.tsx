"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlarmClock, CircleCheck, Inbox, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { fmtDuration } from "@/components/team/PresenceNow";

// The "היום" tab of the workers center (the owner, 2026-10-19): who is on shift and for how long, who has appointments
// today and hasn't clocked in (from the first one), and the shifts that ended today — GET /api/staff/today, asked again
// every half minute.

type Today = {
    working: { user_id: string; name: string; since: string }[];
    missing: { user_id: string; name: string; first_at: string }[];
    done: { user_id: string; name: string; start: string; end: string; hours: number }[];
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

function Card({ title, icon, tone, children, count }: { title: string; icon: React.ReactNode; tone: string; children: React.ReactNode; count: number }) {
    return (
        <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <span className={tone} aria-hidden>{icon}</span>
                <h3 className="flex-1 font-bold text-slate-800">{title}</h3>
                <span className="text-sm font-bold tabular-nums text-slate-500">{count}</span>
            </div>
            {children}
        </section>
    );
}

export default function TodayPanel() {
    const [t, setT] = useState<Today | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [waiting, setWaiting] = useState(0);         // requests waiting for a decision (services/staff_requests)
    useEffect(() => {
        apiFetch<{ waiting?: { status: string }[] }>("/api/requests")
            .then(r => setWaiting((r.waiting ?? []).filter(x => x.status === "waiting_owner").length)).catch(() => {});
    }, []);

    useEffect(() => {
        let alive = true;
        const load = () => apiFetch<Today>("/api/staff/today").then(d => { if (alive) { setT(d); setNow(Date.now()); } }).catch(() => {});
        load();
        const timer = setInterval(load, 30000);
        return () => { alive = false; clearInterval(timer); };
    }, []);

    if (!t) return <div className="h-40 bg-white/60 animate-pulse rounded-2xl" />;
    const row = "flex items-center gap-3 px-4 py-2.5";
    return (
        <div className="space-y-4">
        {waiting > 0 && (
            <Link href="/team?tab=requests" className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 font-semibold">
                <Inbox className="w-5 h-5 shrink-0" aria-hidden /> {waiting === 1 ? "בקשה אחת מחכה לאישור שלך" : `${waiting} בקשות מחכות לאישור שלך`}
            </Link>
        )}
        <div className="grid gap-4 md:grid-cols-3">
            <Card title="בעבודה עכשיו" icon={<Users className="w-5 h-5" />} tone="text-emerald-600" count={t.working.length}>
                {t.working.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">אף אחד לא במשמרת עכשיו</p> : (
                    <ul className="divide-y divide-slate-100">{t.working.map(w => (
                        <li key={w.user_id} className={row}>
                            <span className="flex-1 min-w-0"><b className="block text-sm text-slate-800 truncate">{w.name}</b>
                                <span className="text-xs text-slate-500">כניסה ב-{hhmm(w.since)}</span></span>
                            <span className="text-sm font-bold tabular-nums text-emerald-700">{fmtDuration(Math.max(0, Math.floor((now - new Date(w.since).getTime()) / 60000)))}</span>
                        </li>))}</ul>
                )}
            </Card>
            <Card title="עוד לא החתימו" icon={<AlarmClock className="w-5 h-5" />} tone="text-amber-600" count={t.missing.length}>
                {t.missing.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">כל מי שיש לו תורים היום כבר החתים</p> : (
                    <ul className="divide-y divide-slate-100">{t.missing.map(m => (
                        <li key={m.user_id} className={row}>
                            <b className="flex-1 min-w-0 text-sm text-slate-800 truncate">{m.name}</b>
                            <span className="text-xs text-amber-700 font-semibold">תור ראשון ב-{hhmm(m.first_at)}</span>
                        </li>))}</ul>
                )}
            </Card>
            <Card title="סיימו היום" icon={<CircleCheck className="w-5 h-5" />} tone="text-sky-600" count={t.done.length}>
                {t.done.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">עוד אין משמרות שהסתיימו היום</p> : (
                    <ul className="divide-y divide-slate-100">{t.done.map((d, i) => (
                        <li key={`${d.user_id}-${i}`} className={row}>
                            <span className="flex-1 min-w-0"><b className="block text-sm text-slate-800 truncate">{d.name}</b>
                                <span className="text-xs text-slate-500 tabular-nums">{hhmm(d.start)}–{hhmm(d.end)}</span></span>
                            <span className="text-sm font-bold tabular-nums text-slate-700">{d.hours.toFixed(1)} שע׳</span>
                        </li>))}</ul>
                )}
            </Card>
        </div>
        </div>
    );
}
