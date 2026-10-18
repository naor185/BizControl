"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface PlatformTheme {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    text_muted: string;
    heading_font: string;
    body_font: string;
}

// Matches the seeded defaults in start.py / app/api/public_routes.py — used
// before the fetch resolves and if it ever fails, so the app never renders
// with no theme at all.
export const FALLBACK_THEME: PlatformTheme = {
    primary: "#7c3aed", secondary: "#4c1d95", accent: "#f59e0b",
    background: "#f8fafc", surface: "#ffffff",
    text: "#0f172a", text_muted: "#64748b",
    heading_font: "Heebo", body_font: "Assistant",
};

/** The colors the server put in the page (components/PlatformThemeProvider, from app/layout.tsx). */
export const PlatformThemeContext = createContext<PlatformTheme | null>(null);

let cached: PlatformTheme | null = null;
let inflight: Promise<PlatformTheme> | null = null;

/** The server's theme — FALLBACK_THEME itself (the same object) when it didn't answer. */
export function fetchPlatformTheme(): Promise<PlatformTheme> {
    if (cached) return Promise.resolve(cached);
    if (!inflight) {
        inflight = apiFetch<PlatformTheme>("/api/public/platform-theme", { auth: false })
            .then(t => { cached = t; return t; })
            .catch(() => FALLBACK_THEME)
            .finally(() => { inflight = null; });
    }
    return inflight;
}

// Global superadmin-set design tokens (GET /api/public/platform-theme) —
// same palette everywhere in BizControl, fetched once per page load and
// cached in-module so every component calling this hook shares one request.
export function usePlatformTheme(): PlatformTheme {
    const fromServer = useContext(PlatformThemeContext);
    // the page's own colors from the first moment (the server put them in it — app/layout.tsx); in the browser, a newer
    // answer already fetched during this visit wins. Never the built-in ones while the answer is on its way — that was
    // the color change on opening a page (2026-10-18).
    const [theme, setTheme] = useState<PlatformTheme>(
        () => (typeof window !== "undefined" && cached) || fromServer || FALLBACK_THEME);
    useEffect(() => {
        let alive = true;
        fetchPlatformTheme().then(t => { if (alive && t !== FALLBACK_THEME) setTheme(t); });
        return () => { alive = false; };
    }, []);
    return theme;
}
