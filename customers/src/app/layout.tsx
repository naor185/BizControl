import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { SITE } from "@/lib/seo";
import { Home, Search, ClipboardList, Building2 } from "lucide-react";
import PushRegistrar from "@/components/PushRegistrar";
import BackButtonHandler from "@/components/BackButtonHandler";
import ThemeProvider from "@/components/ThemeProvider";
import { API } from "@/lib/api";
import { bizfindVars } from "@/lib/bizfindVars";
import type { PlatformTheme } from "@/lib/usePlatformTheme";
import PlatformThemeProvider from "@/components/PlatformThemeProvider";

// The site's own details for Google and link previews; each business's page has its own (b/[slug]/layout.tsx).
export const metadata: Metadata = {
    metadataBase: new URL(SITE),
    title: "BizFind — מצא עסקים וקבע תור",
    description: "גלה ספרים, סטודיואים לקעקועים, ציפורניים, ספא ועוד — וקבע תור אונליין",
    openGraph: { siteName: "BizFind", locale: "he_IL", type: "website", title: "BizFind — מצא עסקים וקבע תור",
        description: "גלה ספרים, סטודיואים לקעקועים, ציפורניים, ספא ועוד — וקבע תור אונליין", url: SITE },
    icons: {
        icon: "/icon.png",
        apple: "/icon.png",
    },
};

const GLOBAL_CSS = `
                    :root {
                        /* The platform fonts — set by ThemeProvider.tsx at runtime. */
                        --font-heading: "Heebo", sans-serif;
                        --font-body: "Assistant", sans-serif;
                        /* BizFind's look — black and white by default (BizControl's login: white text, see-through
                           glass cards on a picture). The superadmin can set its own colors apart from BizControl's
                           (app/services/bizfind_theme.py → ThemeProvider.tsx); every page reads these tokens.
                           Shades are the text color at a strength, so a light background with dark text works too. */
                        --bf-bg: #000000;
                        --bf-bg-rgb: 0 0 0;
                        --bf-surface: #0c0c0c;                    /* a sheet or a window — solid */
                        --bf-text: #ffffff;
                        --bf-text-rgb: 255 255 255;
                        --bf-glass: rgb(var(--bf-text-rgb) / .06);
                        --bf-glass-strong: rgb(var(--bf-text-rgb) / .11);
                        --bf-line: rgb(var(--bf-text-rgb) / .14);
                        --bf-muted: rgb(var(--bf-text-rgb) / .68);
                        --bf-faint: rgb(var(--bf-text-rgb) / .42);
                        --bf-accent: #ffffff;                     /* the main button */
                        --bf-accent-rgb: 255 255 255;
                        --bf-on-accent: #000000;                  /* its text */
                        --bf-scheme: dark;
                    }
                    html { color-scheme: var(--bf-scheme); }
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body { font-family: var(--font-body), system-ui, -apple-system, sans-serif; background: var(--bf-bg); color: var(--bf-text);
                           padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) calc(64px + env(safe-area-inset-bottom, 0px)) env(safe-area-inset-left, 0px); }
                    /* the strip under the clock stays the page's black — what scrolls passes under it, never over the clock */
                    body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; height: env(safe-area-inset-top, 0px); background: var(--bf-bg); z-index: 1000; }
                    h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading), inherit; }
                    a { color: inherit; }
                    input, textarea, select, button { font-family: inherit; }
                    @keyframes spin { to { transform: rotate(360deg); } }
                    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
                    .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: calc(60px + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px); background: rgb(var(--bf-bg-rgb) / .92); backdrop-filter: blur(14px); border-top: 1px solid var(--bf-line); display: flex; z-index: 100; }
                    .bottom-nav a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; text-decoration: none; color: var(--bf-faint); font-size: 0.65rem; font-weight: 600; transition: color .2s; }
                    .bottom-nav a:hover { color: var(--bf-text); }
`;

// The superadmin's look, from the server, in the page itself — so every page (each one a full load: the bottom bar
// links) opens in it, even on a first visit (2026-10-18: "it shows black behind between pages"), and the home page's
// words too. Kept a minute; the browser brings it up to date after (components/ThemeProvider). Nothing is saved on
// the device — no old colors (2026-10-18). No answer — the built-in look until the browser gets one.
async function serverTheme(): Promise<PlatformTheme | null> {
    try {
        const res = await fetch(`${API}/api/public/platform-theme`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) });
        return res.ok ? ((await res.json()) as PlatformTheme) : null;
    } catch {
        return null;
    }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
    const theme = await serverTheme();
    const colors = theme ? bizfindVars(theme.bizfind) : null;
    return (
        <html lang="he" dir="rtl" style={(colors ?? undefined) as CSSProperties | undefined} suppressHydrationWarning>
            <head>
                {/* Pinch-zoom disabled to match BizControl's fix — an app-like mobile
                    UI (now also wrapped in a native Capacitor shell) shouldn't zoom its
                    own chrome, and it removes a real crash trigger (a resize mid-pinch
                    threw an unhandled client-side exception on BizControl's dashboard;
                    same risk applies here). */}
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
                {/* Same fixed 5-font set BizControl's ThemeProvider loads — one shared
                    platform font system across both apps. */}
                <link
                    rel="stylesheet"
                    href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&family=Assistant:wght@400;700&family=Rubik:wght@400;700&family=M+PLUS+Rounded+1c:wght@400;700&family=Varela+Round&display=swap"
                />
                {/* Raw CSS, not a text child: a text child's quotes ("Heebo", component's) are escaped on the
                    server and not in the browser, so every page failed hydration and was rebuilt. */}
                <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
            </head>
            <body>
                <PlatformThemeProvider theme={theme}>
                <ThemeProvider />
                <PushRegistrar />
                <BackButtonHandler />
                {children}
                <nav className="bottom-nav">
                    <a href="/"><Home size={20} /><span>ראשי</span></a>
                    <a href="/explore"><Search size={20} /><span>חיפוש</span></a>
                    <a href="/me"><ClipboardList size={20} /><span>התורים שלי</span></a>
                    <a href="/for-business"><Building2 size={20} /><span>לעסקים</span></a>
                </nav>
                </PlatformThemeProvider>
            </body>
        </html>
    );
}
