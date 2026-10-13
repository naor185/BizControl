"use client";
import { useEffect, useState } from "react";
import { publicFetch } from "@/lib/api";

// BizFind's own look (app/services/bizfind_theme.py) — an empty field keeps BizFind's default black and white
export interface BizFindTheme {
    background: string | null;
    cards: string | null;
    text: string | null;
    text_muted: string | null;
    buttons: string | null;
    heading_font: string | null;
    body_font: string | null;
    // the home page's HERO words — always filled by the server (its defaults when the superadmin left them empty)
    hero_badge?: string;
    hero_title_dim?: string;
    hero_title?: string;
    hero_subtitle?: string;
}

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
    bizfind?: BizFindTheme;
}

// Matches the seeded defaults in start.py / app/api/public_routes.py — the
// SAME values web/ falls back to, since this is one shared platform theme.
// (BizFind applies only its own part, "bizfind" — see ThemeProvider.tsx.)
export const FALLBACK_THEME: PlatformTheme = {
    primary: "#7c3aed", secondary: "#4c1d95", accent: "#f59e0b",
    background: "#f8fafc", surface: "#ffffff",
    text: "#0f172a", text_muted: "#64748b",
    heading_font: "Heebo", body_font: "Assistant",
};

let cached: PlatformTheme | null = null;
let inflight: Promise<PlatformTheme> | null = null;

function fetchPlatformTheme(): Promise<PlatformTheme> {
    if (cached) return Promise.resolve(cached);
    if (!inflight) {
        inflight = publicFetch<PlatformTheme>("/api/public/platform-theme")
            .then(t => { cached = t; return t; })
            .catch(() => FALLBACK_THEME)
            .finally(() => { inflight = null; });
    }
    return inflight;
}

// Global superadmin-set design tokens (GET /api/public/platform-theme) — same
// palette as BizControl, fetched once per page load and cached in-module.
export function usePlatformTheme(): PlatformTheme {
    const [theme, setTheme] = useState<PlatformTheme>(cached || FALLBACK_THEME);
    useEffect(() => {
        let alive = true;
        fetchPlatformTheme().then(t => { if (alive) setTheme(t); });
        return () => { alive = false; };
    }, []);
    return theme;
}
