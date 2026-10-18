"use client";
import { useEffect } from "react";
import { FALLBACK_THEME, fetchPlatformTheme } from "@/lib/usePlatformTheme";

// Applies the superadmin's global design tokens to :root as CSS custom
// properties — see globals.css for the token list and their consumers
// (--primary-600/700/50/100/200 are derived from --primary via color-mix(),
// so this only ever needs to set the base tokens, never compute shades).
// The app already opens in the last visit's colors (app/layout.tsx); only the server's answer is applied — never the
// built-in colors while it's on its way (that was the color switch on opening, 2026-10-18) — and kept for next time.
export default function ThemeProvider() {
    useEffect(() => {
        let alive = true;
        fetchPlatformTheme().then(theme => {
            if (!alive || theme === FALLBACK_THEME) return;          // no answer — keep what's on the screen
            const vars: Record<string, string> = {
                "--primary": theme.primary,
                "--secondary": theme.secondary,
                "--accent": theme.accent,
                "--background": theme.background,
                "--surface": theme.surface,
                "--foreground": theme.text,
                "--foreground-muted": theme.text_muted,
                "--font-heading": `"${theme.heading_font}", sans-serif`,
                "--font-body": `"${theme.body_font}", sans-serif`,
            };
            const root = document.documentElement.style;
            Object.entries(vars).forEach(([k, v]) => root.setProperty(k, v));
            try { localStorage.setItem("bc_theme_vars", JSON.stringify(vars)); } catch { /* private mode */ }
        });
        return () => { alive = false; };
    }, []);

    return null;
}
