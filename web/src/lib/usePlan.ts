"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "@/lib/api";

// What the business's plan includes (GET /api/modules/me) and, for what it doesn't, the plan on sale that has it
// (GET /api/modules/me/upgrades — named by the superadmin, never written here). Fetched once per signed-in business
// and shared by every screen that asks.
type PlanState = { modules: Record<string, boolean>; upgrades: Record<string, string>; failed: boolean };

let cached: { token: string | null; state: Promise<PlanState> } | null = null;

function load(): Promise<PlanState> {
    const token = getToken();
    if (!cached || cached.token !== token) {
        const state = Promise.all([
            apiFetch<Record<string, boolean>>("/api/modules/me"),
            apiFetch<Record<string, string>>("/api/modules/me/upgrades").catch(() => ({})),
        ])
            .then(([modules, upgrades]) => ({ modules, upgrades, failed: false }))
            .catch(() => {
                cached = null;                  // try again next time
                return { modules: {}, upgrades: {}, failed: true };
            });
        cached = { token, state };
    }
    return cached.state;
}

export function usePlan() {
    const [state, setState] = useState<PlanState | null>(null);
    useEffect(() => {
        let alive = true;
        load().then(s => { if (alive) setState(s); });
        return () => { alive = false; };
    }, []);
    return {
        ready: state !== null,
        // not known (the request failed) — nothing is locked on the screen; the server still decides
        has: (module: string) => !state || state.failed || !!state.modules[module],
        upgrade: (module: string) => state?.upgrades[module] ?? null,
    };
}
