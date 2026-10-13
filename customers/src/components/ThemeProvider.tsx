"use client";

import { useEffect } from "react";
import { usePlatformTheme, type BizFindTheme } from "@/lib/usePlatformTheme";

// BizFind's own look, set by the superadmin apart from BizControl's (app/services/bizfind_theme.py) → the --bf-*
// tokens of app/layout.tsx. A field left empty keeps the default black and white. What is applied is kept for the
// next visit (the head script in layout.tsx applies it before the first paint).

const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = (hex: string) => {
    const [r, g, b] = rgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const mix = (a: string, b: string, share: number) => {
    const [x, y] = [rgb(a), rgb(b)];
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * share).toString(16).padStart(2, "0")).join("");
};

export function bizfindVars(t: BizFindTheme | undefined): Record<string, string> {
    const v: Record<string, string> = {                 // BizFind's own fonts — not BizControl's
        "--font-heading": `"${t?.heading_font || "Heebo"}", sans-serif`,
        "--font-body": `"${t?.body_font || "Assistant"}", sans-serif`,
    };
    if (t?.background) {
        v["--bf-bg"] = t.background;
        v["--bf-bg-rgb"] = rgb(t.background).join(" ");
        v["--bf-scheme"] = luminance(t.background) > 0.4 ? "light" : "dark";
    }
    if (t?.text) {
        v["--bf-text"] = t.text;
        v["--bf-text-rgb"] = rgb(t.text).join(" ");
    }
    if (t?.cards) {
        v["--bf-glass"] = t.cards;
        v["--bf-surface"] = t.cards;
        v["--bf-glass-strong"] = mix(t.cards, t.text || "#ffffff", 0.08);
    }
    if (t?.text_muted) v["--bf-muted"] = t.text_muted;
    if (t?.buttons) {
        v["--bf-accent"] = t.buttons;
        v["--bf-accent-rgb"] = rgb(t.buttons).join(" ");
        v["--bf-on-accent"] = luminance(t.buttons) > 0.4 ? "#000000" : "#ffffff";
    }
    return v;
}

const OWN = ["--bf-bg", "--bf-bg-rgb", "--bf-scheme", "--bf-text", "--bf-text-rgb", "--bf-glass", "--bf-surface",
    "--bf-glass-strong", "--bf-muted", "--bf-accent", "--bf-accent-rgb", "--bf-on-accent"];

export default function ThemeProvider() {
    const theme = usePlatformTheme();

    useEffect(() => {
        const root = document.documentElement.style;
        const vars = bizfindVars(theme.bizfind);
        OWN.forEach(k => { if (!(k in vars)) root.removeProperty(k); });     // back to the default
        Object.entries(vars).forEach(([k, val]) => root.setProperty(k, val));
        try { localStorage.setItem("bf_theme_vars", JSON.stringify(vars)); } catch { /* private mode */ }
    }, [theme]);

    return null;
}
