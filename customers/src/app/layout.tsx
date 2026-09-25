import type { ReactNode } from "react";
import { Home, Search, ClipboardList, Building2 } from "lucide-react";
import PushRegistrar from "@/components/PushRegistrar";
import BackButtonHandler from "@/components/BackButtonHandler";
import ThemeProvider from "@/components/ThemeProvider";

export const metadata = {
    title: "BizFind — מצא עסקים וקבע תור",
    description: "גלה ספרים, סטודיואים לקעקועים, ציפורניים, ספא ועוד — וקבע תור אונליין",
    icons: {
        icon: "/icon.png",
        apple: "/icon.png",
    },
};

const GLOBAL_CSS = `
                    :root {
                        /* Brand accent tokens only — set by ThemeProvider.tsx at runtime.
                           Background/text stay hardcoded below; see that component's
                           comment for why. */
                        --primary: #7c3aed;
                        --secondary: #4c1d95;
                        --accent: #f59e0b;
                        --font-heading: "Heebo", sans-serif;
                        --font-body: "Assistant", sans-serif;
                    }
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body { font-family: var(--font-body), system-ui, -apple-system, sans-serif; background: #0f172a; color: #f1f5f9; padding-bottom: 64px; }
                    h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading), inherit; }
                    a { color: inherit; }
                    input, textarea, select, button { font-family: inherit; }
                    @keyframes spin { to { transform: rotate(360deg); } }
                    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
                    .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: rgba(15,23,42,.97); backdrop-filter: blur(12px); border-top: 1px solid rgba(255,255,255,.08); display: flex; z-index: 100; }
                    .bottom-nav a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; text-decoration: none; color: #64748b; font-size: 0.65rem; font-weight: 600; transition: color .2s; }
                    .bottom-nav a:hover { color: var(--primary); }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="he" dir="rtl">
            <head>
                {/* Pinch-zoom disabled to match BizControl's fix — an app-like mobile
                    UI (now also wrapped in a native Capacitor shell) shouldn't zoom its
                    own chrome, and it removes a real crash trigger (a resize mid-pinch
                    threw an unhandled client-side exception on BizControl's dashboard;
                    same risk applies here). */}
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
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
            </body>
        </html>
    );
}
