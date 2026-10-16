"use client";

// ויקי pops in from the side when something happens (the owner, 2026-10-16: "she senses movement in the system and pops
// in from the side, like a slider"): a new lead, a client who reported paying a deposit (GET /api/viki/moments, every
// minute), or her most pressing suggestion, once. She waves, says it, and offers the button. Never on top of an open
// window or the guide, not more than once every few minutes, never twice for the same thing, and only while the switch
// on לוח בקרה ("ויקי קופצת כשקורה משהו") is on. The owner's and the managers' who see the money (else: 403, she rests).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Viki, { type VikiPose } from "./Viki";
import { PREFS_EVENT, lastPop, markPopped, markSeen, popupsOn, seen, setSpeaking } from "./vikiPrefs";

type Moment = { key: string; text: string; action: { label: string; href: string } | null };
type Suggestion = Moment & { tone: "warn" | "tip" | "good" };

const EVERY = 60_000;                 // how often she looks
const GAP = 3 * 60_000;               // the least time between two visits

// an open window, or the guide (she's there already — one ויקי at a time)
const busyScreen = () => !!document.querySelector('[role="dialog"], .fixed.inset-0, [data-viki-guide]');

export default function VikiPopper() {
    const [on, setOn] = useState(popupsOn);
    const [shown, setShown] = useState<Moment | null>(null);
    const [pose, setPose] = useState<VikiPose>("wave");
    const [lift, setLift] = useState(false);          // the trial's bar is at the bottom — she stands above it
    const queue = useRef<Moment[]>([]);
    const since = useRef<string>("");               // the server's "now" from the last look
    const stopped = useRef(false);
    const greeted = useRef(false);

    useEffect(() => {
        const sync = () => setOn(popupsOn());
        window.addEventListener(PREFS_EVENT, sync);
        return () => window.removeEventListener(PREFS_EVENT, sync);
    }, []);

    const show = useCallback(() => {
        if (shown || document.hidden || busyScreen() || Date.now() - lastPop() < GAP) return;
        const done = seen();
        while (queue.current.length && done.has(queue.current[0].key)) queue.current.shift();
        const next = queue.current.shift();
        if (!next) return;
        markSeen(next.key);
        markPopped();
        setLift(!!document.querySelector('[data-tour="plan-bar"]'));
        setPose("wave");
        setShown(next);
    }, [shown]);

    const look = useCallback(async () => {
        if (stopped.current) return;
        if (!since.current) since.current = new Date(Date.now() - 10 * 60_000).toISOString();   // the first look: the last minutes
        try {
            const r = await apiFetch<{ now: string; moments: Moment[] }>(`/api/viki/moments?since=${encodeURIComponent(since.current)}`);
            since.current = r.now;
            setSpeaking(true);
            queue.current.push(...r.moments);
            if (!greeted.current) {                    // her most pressing suggestion — once, when she first looks
                greeted.current = true;
                const s = await apiFetch<{ suggestions: Suggestion[] }>("/api/viki");
                const urgent = s.suggestions.find(x => x.tone === "warn");
                if (urgent) queue.current.push({ key: `suggestion:${urgent.key}`, text: urgent.text, action: urgent.action });
            }
        } catch {
            stopped.current = true;                    // not hers to show (a worker, no permission) or offline — rest
            setSpeaking(false);
            return;
        }
        show();
    }, [show]);

    useEffect(() => {
        if (!on) { setSpeaking(false); return; }
        const first = setTimeout(look, 1_500);         // let the screen settle first
        const t = setInterval(look, EVERY);
        return () => { clearTimeout(first); clearInterval(t); };
    }, [on, look]);

    // she waves, then says it, then stands by
    useEffect(() => {
        if (!shown) return;
        const a = setTimeout(() => setPose("talk"), 2_400);
        const b = setTimeout(() => setPose("idle"), 6_000);
        return () => { clearTimeout(a); clearTimeout(b); };
    }, [shown]);

    if (!on || !shown) return null;
    return (
        <div className={`fixed z-[1080] left-2 md:left-6 flex items-end gap-1 viki-pop-in ${lift
            ? "bottom-[calc(112px+env(safe-area-inset-bottom,0px))] md:bottom-12"
            : "bottom-[calc(76px+env(safe-area-inset-bottom,0px))] md:bottom-6"}`}
            dir="rtl" role="status" aria-live="polite">
            <div className="relative mb-16 max-w-[min(270px,calc(100vw-140px))] bg-white rounded-2xl shadow-2xl border border-slate-200 p-3.5">
                <button type="button" onClick={() => setShown(null)} aria-label="סגירה"
                    className="absolute top-1.5 left-1.5 w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                    <X className="w-4 h-4" aria-hidden />
                </button>
                <div className="text-xs font-black text-sky-700 mb-1">ויקי</div>
                <p className="text-sm text-slate-700 leading-relaxed pl-5">{shown.text}</p>
                <div className="mt-2.5 flex items-center gap-2">
                    {shown.action && (
                        <Link href={shown.action.href} onClick={() => setShown(null)}
                            className="min-h-9 inline-flex items-center px-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition">
                            {shown.action.label}
                        </Link>
                    )}
                    <button type="button" onClick={() => setShown(null)} className="min-h-9 px-3 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100">
                        אחר כך
                    </button>
                </div>
                {/* the bubble's tail, toward her */}
                <span aria-hidden className="absolute -left-2 bottom-5 w-4 h-4 bg-white border-l border-b border-slate-200 rotate-45" />
            </div>
            <Viki size={128} pose={pose} className="shrink-0 drop-shadow-xl" />
        </div>
    );
}
