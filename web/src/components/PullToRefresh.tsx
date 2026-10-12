"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { isNativeApp } from "@/lib/platform";

// Pull the screen down from its top and the app reloads (the owner, 2026-10-12) — in the app and the installed web app,
// where the phone has no browser bar to reload from. Not inside an open sheet or window (a form being filled), and not
// while the list under the finger is scrolled down — only from the very top.
const TRIGGER = 72;      // px of pull that reloads
const MAX = 110;

function startsAtTop(target: EventTarget | null): boolean {
    if (window.scrollY > 0) return false;
    for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true") return false;
        if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight && el.scrollTop > 0) return false;
    }
    return true;
}

export default function PullToRefresh() {
    const [enabled, setEnabled] = useState(false);
    const [pull, setPull] = useState(0);
    const [reloading, setReloading] = useState(false);
    const start = useRef<{ x: number; y: number } | null>(null);
    const pulled = useRef(0);

    useEffect(() => {
        setEnabled(isNativeApp() || window.matchMedia("(display-mode: standalone)").matches);
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const down = (e: TouchEvent) => {
            start.current = e.touches.length === 1 && startsAtTop(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
        };
        const move = (e: TouchEvent) => {
            if (!start.current) return;
            const dy = e.touches[0].clientY - start.current.y;
            const dx = Math.abs(e.touches[0].clientX - start.current.x);
            if (Math.abs(dy) < 10 && dx < 10) return;                 // too small to tell a pull from a sideways swipe
            if (dy <= 0 || dx > dy) { pulled.current = 0; setPull(0); if (dx > dy) start.current = null; return; }   // a sideways swipe isn't a pull
            pulled.current = Math.min(MAX, dy * 0.5);
            setPull(pulled.current);
        };
        const up = () => {
            if (!start.current) return;
            start.current = null;
            if (pulled.current >= TRIGGER) {
                setReloading(true);
                window.location.reload();
            } else {
                pulled.current = 0;
                setPull(0);
            }
        };
        window.addEventListener("touchstart", down, { passive: true });
        window.addEventListener("touchmove", move, { passive: true });
        window.addEventListener("touchend", up);
        window.addEventListener("touchcancel", up);
        return () => {
            window.removeEventListener("touchstart", down);
            window.removeEventListener("touchmove", move);
            window.removeEventListener("touchend", up);
            window.removeEventListener("touchcancel", up);
        };
    }, [enabled]);

    if (!enabled || (pull === 0 && !reloading)) return null;
    const ready = pull >= TRIGGER || reloading;
    return (
        <div className="fixed inset-x-0 z-[80] flex justify-center pointer-events-none"
            style={{ top: `calc(env(safe-area-inset-top, 0px) + ${Math.max(8, pull - 36)}px)` }} aria-hidden>
            <div className={`w-10 h-10 rounded-full bg-white shadow-lg border border-slate-100 flex items-center justify-center ${ready ? "text-sky-600" : "text-slate-400"}`}>
                <RefreshCw className={`w-5 h-5 ${reloading ? "animate-spin" : ""}`}
                    style={reloading ? undefined : { transform: `rotate(${(pull / TRIGGER) * 270}deg)` }} />
            </div>
        </div>
    );
}
