"use client";

import type { ReactNode } from "react";
import { PlatformThemeContext, type PlatformTheme } from "@/lib/usePlatformTheme";

// Hands every page the look the server put in it (app/layout.tsx), so usePlatformTheme() — the home page's words —
// has it from the first moment (2026-10-18).
export default function PlatformThemeProvider({ theme, children }: { theme: PlatformTheme | null; children: ReactNode }) {
    return <PlatformThemeContext.Provider value={theme}>{children}</PlatformThemeContext.Provider>;
}
