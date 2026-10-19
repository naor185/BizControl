"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

import { tx, intl } from "@/lib/i18n";
// Who is on shift right now and for how long (GET /api/nfc/presence — a shift clocked in and not out). The owner,
// 2026-10-18: "I want to see the workers' clock — how long they've been on shift". One list for the header's
// "פעילים" (components/ClockWidget), ניהול צוות (components/team/ClockCode) and the owner's scan of the barcode
// (app/clock/[code]); the times move on by themselves, the list is asked for again every half minute.

export type PresenceEntry = { user_id: string; user_name: string; clocked_in_at: string; duration_minutes: number;
    break_minutes?: number; on_break_since?: string | null };

/** Minutes worked on an open shift — less its breaks; during a break the count stands still. */
export function workedMinutes(since: string, now: number, breakMinutes = 0, onBreakSince?: string | null): number {
    const until = onBreakSince ? new Date(onBreakSince).getTime() : now;
    return Math.max(0, Math.floor((until - new Date(since).getTime()) / 60000) - breakMinutes);
}

export function fmtDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h === 0 ? tx("{0} דק׳", { 0: m }) : tx("{0} שע׳ {1} דק׳", { 0: h, 1: m });
}

/** The list, asked for again every 30 seconds — null until the first answer. */
export function usePresence(): PresenceEntry[] | null {
    const [list, setList] = useState<PresenceEntry[] | null>(null);
    useEffect(() => {
        let alive = true;
        const load = () => apiFetch<PresenceEntry[]>("/api/nfc/presence").then(l => { if (alive) setList(l); }).catch(() => {});
        load();
        const t = setInterval(load, 30000);
        return () => { alive = false; clearInterval(t); };
    }, []);
    return list;
}

export function PresenceList({ entries, empty = tx("אף אחד לא במשמרת עכשיו") }: { entries: PresenceEntry[]; empty?: string }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(t);
    }, []);
    if (entries.length === 0) return <p className="px-4 py-3 text-sm text-slate-500">{empty}</p>;
    const sorted = [...entries].sort((a, b) => a.clocked_in_at.localeCompare(b.clocked_in_at));    // longest on shift first
    return (
        <ul className="divide-y divide-slate-100">
            {sorted.map(p => {
                const since = new Date(p.clocked_in_at);
                const minutes = workedMinutes(p.clocked_in_at, now, p.break_minutes, p.on_break_since);
                return (
                    <li key={p.user_id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700 shrink-0" aria-hidden>
                            {p.user_name.charAt(0)}
                        </span>
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-slate-800 truncate">{p.user_name}</span>
                            <span className="block text-xs text-slate-500">
                                {tx("כניסה ב-")}{since.toLocaleTimeString(intl(), { hour: "2-digit", minute: "2-digit" })}
                                {p.on_break_since && <span className="ms-1.5 font-semibold text-amber-700">{tx("· בהפסקה מ-")}{new Date(p.on_break_since).toLocaleTimeString(intl(), { hour: "2-digit", minute: "2-digit" })}</span>}
                            </span>
                        </span>
                        <span className="text-sm font-bold tabular-nums text-emerald-700 shrink-0">{fmtDuration(minutes)}</span>
                    </li>
                );
            })}
        </ul>
    );
}
