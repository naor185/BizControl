"use client";
import { useEffect } from "react";
import { usePlatformTheme } from "@/lib/usePlatformTheme";

// Applies the superadmin's platform fonts to :root. BizFind's colors are its own black-and-white look (the --bf-*
// tokens in app/layout.tsx), so the platform's brand colors — which BizControl uses — are not applied here.
export default function ThemeProvider() {
    const theme = usePlatformTheme();

    useEffect(() => {
        const root = document.documentElement.style;
        root.setProperty("--font-heading", `"${theme.heading_font}", sans-serif`);
        root.setProperty("--font-body", `"${theme.body_font}", sans-serif`);
    }, [theme]);

    return null;
}
