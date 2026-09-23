"use client";
import { useEffect } from "react";
import { usePlatformTheme } from "@/lib/usePlatformTheme";

// Applies the superadmin's global brand colors + fonts to :root. Deliberately
// does NOT touch --background/--foreground here: this whole app's existing
// components (hundreds of them) hardcode colors assuming the current dark
// background (e.g. white text on a dark card) — swapping the page background
// to the platform's light theme without recoloring every one of those
// components first would make large parts of the app unreadable. Only the
// safe, additive subset (brand accent colors + fonts, used sparingly on
// buttons/links/highlights) ships now; full background/text unification is
// a separate, larger follow-up once BizFind's own components are converted.
export default function ThemeProvider() {
    const theme = usePlatformTheme();

    useEffect(() => {
        const root = document.documentElement.style;
        root.setProperty("--primary", theme.primary);
        root.setProperty("--secondary", theme.secondary);
        root.setProperty("--accent", theme.accent);
        root.setProperty("--font-heading", `"${theme.heading_font}", sans-serif`);
        root.setProperty("--font-body", `"${theme.body_font}", sans-serif`);
    }, [theme]);

    return null;
}
