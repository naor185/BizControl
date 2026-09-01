"use client";

import { useEffect } from "react";

// Dev-only: scans the live DOM for anything poking past the viewport edge
// and logs the offending element(s) to the console (with a clickable
// element reference + its class list), instead of relying on someone
// noticing a horizontal-overflow bug by eye on a real device. Never
// mounted in production (see layout.tsx) — this walks every node in the
// page on every DOM mutation, which is far too costly to ship.
export default function OverflowDebugger() {
    useEffect(() => {
        let scheduled = false;

        const check = () => {
            scheduled = false;
            const docWidth = document.documentElement.clientWidth;
            const offenders: { el: Element; left: number; right: number }[] = [];

            document.querySelectorAll("body *").forEach((el) => {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0) return;
                if (rect.right > docWidth + 1 || rect.left < -1) {
                    offenders.push({ el, left: rect.left, right: rect.right });
                }
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
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(check);
        };

        schedule();
        window.addEventListener("resize", schedule);
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });

        return () => {
            window.removeEventListener("resize", schedule);
            observer.disconnect();
        };
    }, []);

    return null;
}
