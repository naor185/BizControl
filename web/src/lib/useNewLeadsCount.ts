"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "@/lib/api";

// Number of leads nobody has opened yet (leads.seen_at IS NULL). Polled every 30s (same cadence and reason as
// NotificationBell — a cheap count endpoint instead of SSE), refreshed when the tab
// becomes visible again, and skipped while it's hidden. LeadsContent fires "leads-changed"
// whenever the list is edited so the badges update immediately instead of after 30s.
export function useNewLeadsCount(): number {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let alive = true;
        const load = () => {
            if (!getToken() || document.visibilityState === "hidden") return;
            apiFetch<{ count: number }>("/api/leads/new-count")
                .then(d => { if (alive) setCount(d.count); })
                .catch(() => { /* badge is best-effort */ });
        };
        load();
        const timer = setInterval(load, 30_000);
        document.addEventListener("visibilitychange", load);
        window.addEventListener("leads-changed", load);
        return () => {
            alive = false;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", load);
            window.removeEventListener("leads-changed", load);
        };
    }, []);

    return count;
}
