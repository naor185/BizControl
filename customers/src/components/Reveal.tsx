"use client";
// Arms every data-reveal="" on BizFind's pages (lib/motion.ts). When a page opens, a part already on the screen stays
// as it is and one below it waits to be scrolled to. A part that appears later (results that came back, another
// tab) waits too and comes in at once if it is on the screen — so it animates in instead of popping.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function Reveal() {
    const path = usePathname();

    useEffect(() => {
        if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const io = new IntersectionObserver(entries => {
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                (e.target as HTMLElement).dataset.reveal = "in";
                io.unobserve(e.target);
            }
        }, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });

        // on opening, also the parts a moment ago's page change already set waiting — that page's watcher is gone
        const arm = (opening: boolean) => {
            document.querySelectorAll<HTMLElement>(opening ? '[data-reveal=""], [data-reveal="wait"]' : '[data-reveal=""]').forEach(el => {
                if (opening && el.getBoundingClientRect().top < window.innerHeight * 0.9) { el.dataset.reveal = "in"; return; }
                el.dataset.reveal = "wait";
                io.observe(el);
            });
        };
        arm(true);
        const mo = new MutationObserver(() => arm(false));
        mo.observe(document.body, { childList: true, subtree: true });
        return () => { io.disconnect(); mo.disconnect(); };
    }, [path]);

    return null;
}
