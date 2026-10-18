// The superadmin's colors and fonts as the CSS tokens of globals.css. Used by the server — app/layout.tsx puts them in
// every page, so a page never opens in the built-in colors and then changes (2026-10-18) — and by the browser
// (components/ThemeProvider, when a newer answer comes). Nothing is kept on the device.
import type { PlatformTheme } from "@/lib/usePlatformTheme";

export function platformThemeVars(t: PlatformTheme): Record<string, string> {
    return {
        "--primary": t.primary,
        "--secondary": t.secondary,
        "--accent": t.accent,
        "--background": t.background,
        "--surface": t.surface,
        "--foreground": t.text,
        "--foreground-muted": t.text_muted,
        "--font-heading": `"${t.heading_font}", sans-serif`,
        "--font-body": `"${t.body_font}", sans-serif`,
    };
}

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "https://web-production-68695.up.railway.app")
    .replace(/^http:\/\//, "https://").replace(/\/$/, "");

/** The theme, asked by the server for the page (kept a minute); null when it didn't answer. */
export async function serverPlatformTheme(): Promise<PlatformTheme | null> {
    try {
        const res = await fetch(`${API}/api/public/platform-theme`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) });
        return res.ok ? ((await res.json()) as PlatformTheme) : null;
    } catch {
        return null;
    }
}
