"use client";
import { useEffect } from "react";
import { FALLBACK_THEME, fetchPlatformTheme } from "@/lib/usePlatformTheme";
import { platformThemeVars } from "@/lib/platformThemeVars";

// Keeps the superadmin's global design tokens on :root up to date — see globals.css for the token list and their
// consumers (--primary-600/700/50/100/200 are derived from --primary via color-mix(), so only the base tokens are set).
// The page already opens in them (app/layout.tsx — from the server); this applies only a newer answer from the server,
// never the built-in colors while it's on its way (that was the color change on opening, 2026-10-18). Nothing is kept
// on the device — no old colors.
export default function ThemeProvider() {
    useEffect(() => {
        try { localStorage.removeItem("bc_theme_vars"); } catch { /* private mode */ }   // colors kept by an older version
        let alive = true;
        fetchPlatformTheme().then(theme => {
            if (!alive || theme === FALLBACK_THEME) return;          // no answer — keep what's on the screen
            const root = document.documentElement.style;
            Object.entries(platformThemeVars(theme)).forEach(([k, v]) => root.setProperty(k, v));
        });
        return () => { alive = false; };
    }, []);

    return null;
}
