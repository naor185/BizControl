"use client";
import { useEffect } from "react";
import { usePlatformTheme } from "@/lib/usePlatformTheme";

// Applies the superadmin's global design tokens to :root as CSS custom
// properties — see globals.css for the token list and their consumers
// (--primary-600/700/50/100/200 are derived from --primary via color-mix(),
// so this only ever needs to set the base tokens, never compute shades).
export default function ThemeProvider() {
    const theme = usePlatformTheme();

    useEffect(() => {
        const root = document.documentElement.style;
        root.setProperty("--primary", theme.primary);
        root.setProperty("--secondary", theme.secondary);
        root.setProperty("--accent", theme.accent);
        root.setProperty("--background", theme.background);
        root.setProperty("--surface", theme.surface);
        root.setProperty("--foreground", theme.text);
        root.setProperty("--foreground-muted", theme.text_muted);
        root.setProperty("--font-heading", `"${theme.heading_font}", sans-serif`);
        root.setProperty("--font-body", `"${theme.body_font}", sans-serif`);
    }, [theme]);

    return null;
}
