"use client";

import { useEffect } from "react";

// Dev-only: scans the live DOM for anything poking past the viewport edge
// and logs the offending element(s) to the console (with a clickable
// element reference + its class list), instead of relying on someone
// noticing a horizontal-overflow bug by eye on a real device. Never
// mounted in production (see layout.tsx) — this walks every node in the
// page, which is far too costly to ship, and is debounced (not just
// rAF-coalesced) below so a burst of DOM mutations across many frames —
// a polling refetch, a toast, typing — triggers one scan after things
// settle, not one per frame.
const DEBOUNCE_MS = 400;

export default function OverflowDebugger() {
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        const check = () => {
            timer = null;
            const docWidth = document.documentElement.clientWidth;

            // An element inside a container that legitimately owns its own
            // horizontal scroll (overflow-x: auto/scroll — e.g. a wide
            // table's wrapper) never inflates the page's own scrollWidth,
            // so it isn't a real bug — skip it instead of flagging it.
            const isContainedByScrollable = (el: Element): boolean => {
                let p = el.parentElement;
                while (p && p !== document.body) {
                    const cs = getComputedStyle(p);
                    const scrollable = cs.overflowX === "auto" || cs.overflowX === "scroll";
                    const pRect = p.getBoundingClientRect();
                    if (scrollable && pRect.right <= docWidth + 1 && pRect.left >= -1) return true;
                    p = p.parentElement;
                }
                return false;
            };

            const offenders: { el: Element; left: number; right: number }[] = [];
            document.querySelectorAll("body *").forEach((el) => {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0) return;
                if (rect.right <= docWidth + 1 && rect.left >= -1) return;
                if (isContainedByScrollable(el)) return;
                offenders.push({ el, left: rect.left, right: rect.right });
            });

            if (offenders.length === 0) return;

            // Report only the outermost offenders — skip any element whose
            // ancestor is already flagged, so the log points at the actual
            // cause instead of every descendant it drags along with it.
            const flagged = new Set(offenders.map((o) => o.el));
            const roots = offenders.filter((o) => {
                let p = o.el.parentElement;
                while (p) {
                    if (flagged.has(p)) return false;
                    p = p.parentElement;
                }
                return true;
            });

            console.warn(
                `[overflow-debugger] ${roots.length} element(s) wider than the ${docWidth}px viewport on ${window.location.pathname}:`,
                roots.map((o) => ({
                    element: o.el,
                    className: (o.el as HTMLElement).className || "(none)",
                    left: Math.round(o.left),
                    right: Math.round(o.right),
                    overflowBy: Math.round(Math.max(o.right - docWidth, -o.left)),
                }))
            );
        };

        const schedule = () => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(check, DEBOUNCE_MS);
        };

        schedule();
        window.addEventListener("resize", schedule);
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });

        return () => {
            if (timer !== null) clearTimeout(timer);
            window.removeEventListener("resize", schedule);
            observer.disconnect();
        };
    }, []);

    return null;
}
