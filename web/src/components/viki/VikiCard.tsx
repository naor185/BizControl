"use client";

// "ויקי ממליצה" on לוח בקרה (the owner, 2026-10-16): her suggestions for now, worked out from the business's own numbers
// (api/viki_routes, services/viki) — each with its button, and "עשיתי" / "לא רלוונטי" to put it away. Here too the
// switch that lets her pop in when something happens (components/viki/VikiPopper). Not shown to someone who may not
// see the money.
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, Lightbulb, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import Viki from "./Viki";
import { popupsOn, setPopupsOn } from "./vikiPrefs";

type Suggestion = { key: string; tone: "warn" | "tip" | "good"; text: string; action: { label: string; href: string } | null };

const TONE = {
    warn: { icon: TriangleAlert, ring: "border-amber-200 bg-amber-50/60", fg: "text-amber-600" },
    tip: { icon: Lightbulb, ring: "border-sky-200 bg-sky-50/60", fg: "text-sky-600" },
    good: { icon: CircleCheck, ring: "border-emerald-200 bg-emerald-50/60", fg: "text-emerald-600" },
};

export default function VikiCard() {
    const [items, setItems] = useState<Suggestion[] | null>(null);
    const [more, setMore] = useState(0);
    const [hidden, setHidden] = useState(false);
    const [pops, setPops] = useState(popupsOn);
    const [busy, setBusy] = useState<string | null>(null);

    const load = () => apiFetch<{ suggestions: Suggestion[]; more: number }>("/api/viki")
        .then(r => { setItems(r.suggestions); setMore(r.more); })
        .catch(() => setHidden(true));

    useEffect(() => { load(); }, []);

    const answer = async (s: Suggestion, kind: "done" | "not_relevant") => {
        setBusy(s.key);
        try {
            await apiFetch("/api/viki/answer", { method: "POST", body: JSON.stringify({ key: s.key, kind }) });
            await load();
        } catch { /* stays */ } finally { setBusy(null); }
    };

    if (hidden || items === null) return null;
    return (
        <section id="viki" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden scroll-mt-4" dir="rtl">
            <div className="flex items-end gap-3 px-5 pt-4 bg-gradient-to-l from-sky-50 to-white border-b border-slate-100">
                <Viki size={84} pose="wave" className="shrink-0 -mb-1" />
                <div className="flex-1 min-w-0 pb-3">
                    <h3 className="font-bold text-slate-800">ויקי ממליצה</h3>
                    <p className="text-xs text-slate-500 mt-0.5">מה כדאי לעשות עכשיו — מתוך המספרים של העסק שלך</p>
                </div>
                <label className="pb-3 flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none" title="ויקי קופצת מהצד כשקורה משהו — ליד חדש, מקדמה ששולמה">
                    <span className="hidden sm:inline">ויקי קופצת כשקורה משהו</span>
                    <span className="sm:hidden">קופצת</span>
                    <Switch size="sm" checked={pops} onColor="bg-sky-500"
                        onChange={(v: boolean) => { setPops(v); setPopupsOn(v); }} />
                </label>
            </div>
            {items.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-600">הכול נראה טוב — אין לי כרגע המלצות. אני ממשיכה לעקוב.</p>
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
                                <div className="mt-2.5 flex flex-wrap items-center gap-2 mr-7">
                                    {s.action && (
                                        <Link href={s.action.href} className="min-h-9 inline-flex items-center px-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition">
                                            {s.action.label}
                                        </Link>
                                    )}
                                    <button type="button" disabled={busy === s.key} onClick={() => answer(s, "done")}
                                        className="min-h-9 px-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-white transition disabled:opacity-50">עשיתי</button>
                                    <button type="button" disabled={busy === s.key} onClick={() => answer(s, "not_relevant")}
                                        className="min-h-9 px-3 rounded-lg text-xs font-semibold text-slate-400 hover:bg-white transition disabled:opacity-50">לא רלוונטי</button>
                                </div>
                            </li>
                        );
                    })}
                    {more > 0 && <li className="text-xs text-slate-400 text-center">ועוד {more === 1 ? "המלצה אחת" : `${more} המלצות`} — יעלו כשתסיים עם אלה</li>}
                </ul>
            )}
        </section>
    );
}
