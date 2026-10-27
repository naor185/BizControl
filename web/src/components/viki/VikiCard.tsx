"use client";

// "ויקי ממליצה" on לוח בקרה (the owner, 2026-10-16): her summary of the week / the month, her suggestions for now, worked out from the business's own numbers
// (api/viki_routes, services/viki) — each with its button, and "עשיתי" / "לא רלוונטי" to put it away. Here too the
// switch that lets her pop in when something happens (components/viki/VikiPopper). Not shown to someone who may not
// see the money.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { followSection } from "@/lib/sectionLinks";
import { CalendarDays, CircleCheck, Lightbulb, Target, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import Viki from "./Viki";
import { popupsOn, setPopupsOn } from "./vikiPrefs";

import { tx } from "@/lib/i18n";
type Suggestion = { key: string; tone: "warn" | "tip" | "good"; text: string; action: { label: string; href: string } | null };
// the week's (Sunday) or the month's (the 1st) — services/viki_summary
type Summary = { kind: "weekly" | "monthly"; title: string; good: string[]; improve: string[]; focus: string };
// from Thursday: next week and the one after, as the calendar stands now — services/viki_summary.ahead
type Ahead = { title: string; lines: string[] };
// the week we're in: what was done, what's still ahead, this week's step towards the goal, a bit of next week —
// services/viki_summary.this_week (the owner, 2026-10-27)
type WeekLine = { kind: "done" | "ahead" | "goal" | "next"; text: string };
type Week = { title: string; lines: WeekLine[] };
const WEEK_ICON = {
    done: { icon: CircleCheck, fg: "text-emerald-600" },
    ahead: { icon: CalendarDays, fg: "text-sky-600" },
    goal: { icon: Target, fg: "text-sky-800" },
    next: { icon: CalendarDays, fg: "text-slate-400" },
};

const TONE = {
    warn: { icon: TriangleAlert, ring: "border-amber-200 bg-amber-50/60", fg: "text-amber-600" },
    tip: { icon: Lightbulb, ring: "border-sky-200 bg-sky-50/60", fg: "text-sky-600" },
    good: { icon: CircleCheck, ring: "border-emerald-200 bg-emerald-50/60", fg: "text-emerald-600" },
};

export default function VikiCard() {
    const [items, setItems] = useState<Suggestion[] | null>(null);
    const [more, setMore] = useState(0);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [ahead, setAhead] = useState<Ahead | null>(null);
    const [week, setWeek] = useState<Week | null>(null);
    const [hidden, setHidden] = useState(false);
    const [pops, setPops] = useState(popupsOn);
    const [busy, setBusy] = useState<string | null>(null);
    const pathname = usePathname();

    const load = () => apiFetch<{ suggestions: Suggestion[]; more: number; summary: Summary | null; ahead?: Ahead | null; week?: Week | null }>("/api/viki")
        .then(r => { setItems(r.suggestions); setMore(r.more); setSummary(r.summary); setAhead(r.ahead ?? null); setWeek(r.week ?? null); })
        .catch(() => setHidden(true));

    useEffect(() => { load(); }, []);
    // a lead answered, deleted or made a client in the leads list (it says "leads-changed") — her "a lead is waiting"
    // follows at once, not after a reload (the owner, 2026-10-27: deleted the lead, the alert stayed)
    useEffect(() => {
        const again = () => { load(); };
        window.addEventListener("leads-changed", again);
        return () => window.removeEventListener("leads-changed", again);
    }, []);

    const answer = async (s: Suggestion, kind: "done" | "not_relevant") => {
        setBusy(s.key);
        try {
            await apiFetch("/api/viki/answer", { method: "POST", body: JSON.stringify({ key: s.key, kind }) });
            await load();
        } catch { /* stays */ } finally { setBusy(null); }
    };

    if (hidden || items === null) return null;
    return (
        <section id="viki" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden scroll-mt-4">
            <div className="flex items-end gap-3 px-5 pt-4 bg-gradient-to-l from-sky-50 to-white border-b border-slate-100">
                <Viki size={84} pose="wave" className="shrink-0 -mb-1" />
                <div className="flex-1 min-w-0 pb-3">
                    <h3 className="font-bold text-slate-800">{tx("ויקי ממליצה")}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{tx("מה כדאי לעשות עכשיו — מתוך המספרים של העסק שלך")}</p>
                </div>
                <label className="pb-3 flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none" title={tx("ויקי קופצת מהצד כשקורה משהו — ליד חדש, מקדמה ששולמה")}>
                    <span className="hidden sm:inline">{tx("ויקי קופצת כשקורה משהו")}</span>
                    <span className="sm:hidden">{tx("קופצת")}</span>
                    <Switch size="sm" checked={pops} onColor="bg-sky-500"
                        onChange={(v: boolean) => { setPops(v); setPopupsOn(v); }} />
                </label>
            </div>
            {/* the week we're in comes first — what was done and what will be done (the owner, 2026-10-27) */}
            {week && week.lines.length > 0 && (
                <div className="px-5 pt-4">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                        <div className="text-sm font-black text-slate-800">{week.title}</div>
                        <ul className="mt-2 space-y-1.5">
                            {week.lines.map(line => {
                                const k = WEEK_ICON[line.kind] ?? WEEK_ICON.ahead;
                                return (
                                    <li key={line.text} className={`flex items-start gap-2 text-sm ${line.kind === "goal" ? "font-bold text-sky-800" : "text-slate-700"}`}>
                                        <k.icon className={`w-4 h-4 shrink-0 mt-0.5 ${k.fg}`} aria-hidden />{line.text}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            )}
            {summary && (
                <div className="px-5 pt-4">
                    <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-sm font-black text-slate-800">{summary.title}</div>
                        {summary.good.length > 0 && (
                            <ul className="mt-2 space-y-1">
                                {summary.good.map(line => (
                                    <li key={line} className="flex items-start gap-2 text-sm text-slate-700">
                                        <CircleCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" aria-hidden />{line}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {summary.improve.length > 0 && (
                            <ul className="mt-2 space-y-1">
                                {summary.improve.map(line => (
                                    <li key={line} className="flex items-start gap-2 text-sm text-slate-700">
                                        <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />{line}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="mt-3 flex items-start gap-2 text-sm font-bold text-sky-800">
                            <Target className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />{summary.focus}
                        </p>
                    </div>
                </div>
            )}
            {ahead && ahead.lines.length > 0 && (
                <div className="px-5 pt-4">
                    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
                        <div className="text-sm font-black text-slate-800">{ahead.title}</div>
                        <ul className="mt-2 space-y-1">
                            {ahead.lines.map(line => (
                                <li key={line} className="flex items-start gap-2 text-sm text-slate-700">
                                    <CalendarDays className="w-4 h-4 shrink-0 mt-0.5 text-sky-600" aria-hidden />{line}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
            {items.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-600">{tx("הכול נראה טוב — אין לי כרגע המלצות. אני ממשיכה לעקוב.")}</p>
            ) : (
                <ul className="p-4 space-y-3">
                    {items.map(s => {
                        const t = TONE[s.tone];
                        return (
                            <li key={s.key} className={`rounded-xl border p-3 ${t.ring}`}>
                                <div className="flex items-start gap-2.5">
                                    <t.icon className={`w-5 h-5 shrink-0 mt-0.5 ${t.fg}`} aria-hidden />
                                    <p className="flex-1 text-sm text-slate-700 leading-relaxed">{s.text}</p>
                                </div>
                                <div className="mt-2.5 flex flex-wrap items-center gap-2 ms-7">
                                    {s.action && (
                                        <Link href={s.action.href} onClick={e => followSection(e, s.action!.href, pathname)} className="min-h-9 inline-flex items-center px-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition">
                                            {s.action.label}
                                        </Link>
                                    )}
                                    <button type="button" disabled={busy === s.key} onClick={() => answer(s, "done")}
                                        className="min-h-9 px-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-white transition disabled:opacity-50">{tx("עשיתי")}</button>
                                    <button type="button" disabled={busy === s.key} onClick={() => answer(s, "not_relevant")}
                                        className="min-h-9 px-3 rounded-lg text-xs font-semibold text-slate-400 hover:bg-white transition disabled:opacity-50">{tx("לא רלוונטי")}</button>
                                </div>
                            </li>
                        );
                    })}
                    {more > 0 && <li className="text-xs text-slate-400 text-center">{tx("ועוד ")}{more === 1 ? tx("המלצה אחת") : tx("{0} המלצות", { 0: more })}{tx(" — יעלו כשתסיים עם אלה")}</li>}
                </ul>
            )}
        </section>
    );
}
