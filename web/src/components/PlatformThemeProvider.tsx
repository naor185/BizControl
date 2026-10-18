"use client";

import { PlatformThemeContext, type PlatformTheme } from "@/lib/usePlatformTheme";

// Hands every screen the colors the server put in the page (app/layout.tsx), so usePlatformTheme() has them from the
// first moment — not the built-in ones until the browser asks (2026-10-18).
export default function PlatformThemeProvider({ theme, children }: { theme: PlatformTheme | null; children: React.ReactNode }) {
    return <PlatformThemeContext.Provider value={theme}>{children}</PlatformThemeContext.Provider>;
}
