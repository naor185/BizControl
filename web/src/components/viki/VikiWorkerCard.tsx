"use client";

import { useEffect, useState } from "react";
import { ChevronDown, CircleCheck, Lightbulb, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Viki from "./Viki";

import { tx } from "@/lib/i18n";
// ויקי for the worker (the owner, 2026-10-27: "ויקי gives the worker an analysis of their progress — the goal, the
// tasks, the appointments"): their month on top of their calendar — what they sold against the goal the owner set,
// the pace and what's needed a day, their tasks, this week's appointments (GET /api/workers/me, services/
// worker_progress). Folds away; this device remembers.

type Line = { tone: "good" | "warn" | "tip"; text: string };
const TONE = {
    good: { icon: CircleCheck, fg: "text-emerald-600" },
    warn: { icon: TriangleAlert, fg: "text-amber-600" },
    tip: { icon: Lightbulb, fg: "text-sky-600" },
};
const FOLD_KEY = "viki_worker_folded";

export default function VikiWorkerCard() {
    const [lines, setLines] = useState<Line[] | null>(null);
    const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } });

    useEffect(() => {
        apiFetch<{ lines: Line[] }>("/api/workers/me").then(r => setLines(r.lines)).catch(() => setLines(null));
    }, []);

    const flip = () => {
        setFolded(f => {
            try { localStorage.setItem(FOLD_KEY, f ? "0" : "1"); } catch { /* fine */ }
            return !f;
        });
    };

    if (!lines || lines.length === 0) return null;
    return (
        <section className="mb-3 bg-white rounded-2xl border border-sky-100 shadow-sm overflow-hidden">
            <button type="button" onClick={flip} aria-expanded={!folded}
                className="w-full flex items-center gap-3 px-4 py-2 bg-gradient-to-l from-sky-50 to-white text-start">
                <Viki size={40} pose="wave" className="shrink-0" />
                <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-800">{tx("ויקי — החודש שלך")}</span>
                    {folded && <span className="block text-xs text-slate-500 truncate">{lines[0].text}</span>}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${folded ? "" : "rotate-180"}`} aria-hidden />
            </button>
            {!folded && (
                <ul className="px-4 pb-3 pt-1 space-y-1.5">
                    {lines.map(l => {
                        const t = TONE[l.tone] ?? TONE.tip;
                        return (
                            <li key={l.text} className="flex items-start gap-2 text-sm text-slate-700">
                                <t.icon className={`w-4 h-4 shrink-0 mt-0.5 ${t.fg}`} aria-hidden />{l.text}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
