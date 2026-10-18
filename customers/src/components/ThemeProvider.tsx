"use client";

import { useEffect } from "react";
import { FALLBACK_THEME, fetchPlatformTheme } from "@/lib/usePlatformTheme";
import { BIZFIND_TOKENS, bizfindVars } from "@/lib/bizfindVars";

// BizFind's look (lib/bizfindVars) brought up to date in the browser: the page already opens in it (app/layout.tsx —
// the server's colors), so only the server's answer is applied — never the built-in default while it's on its way
// (that was the black flash between pages, 2026-10-18). Nothing is kept on the device (no old colors).
export default function ThemeProvider() {
    useEffect(() => {
        try { localStorage.removeItem("bf_theme_vars"); } catch { /* private mode */ }   // colors kept by an older version
        let alive = true;
        fetchPlatformTheme().then(theme => {
            if (!alive || theme === FALLBACK_THEME) return;          // no answer — keep what's on the screen
            const root = document.documentElement.style;
            const vars = bizfindVars(theme.bizfind);
            BIZFIND_TOKENS.forEach(k => { if (!(k in vars)) root.removeProperty(k); });     // back to the default
            Object.entries(vars).forEach(([k, val]) => root.setProperty(k, val));
        });
        return () => { alive = false; };
    }, []);

    return null;
}
