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
                        /* The platform fonts — set by ThemeProvider.tsx at runtime. */
                        --font-heading: "Heebo", sans-serif;
                        --font-body: "Assistant", sans-serif;
                        /* The black-and-white look (BizControl's login: white text, see-through glass
                           cards on a picture). Pages moved to it read these — one place to tune it. */
                        --bf-bg: #000000;
                        --bf-glass: rgba(255,255,255,.06);
                        --bf-glass-strong: rgba(255,255,255,.11);
                        --bf-line: rgba(255,255,255,.14);
                        --bf-text: #ffffff;
                        --bf-muted: rgba(255,255,255,.68);
                        --bf-faint: rgba(255,255,255,.42);
                    }
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body { font-family: var(--font-body), system-ui, -apple-system, sans-serif; background: var(--bf-bg); color: var(--bf-text); padding-bottom: 64px; }
                    h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading), inherit; }
                    a { color: inherit; }
                    input, textarea, select, button { font-family: inherit; }
                    @keyframes spin { to { transform: rotate(360deg); } }
                    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
                    .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: rgba(0,0,0,.92); backdrop-filter: blur(14px); border-top: 1px solid var(--bf-line); display: flex; z-index: 100; }
                    .bottom-nav a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; text-decoration: none; color: var(--bf-faint); font-size: 0.65rem; font-weight: 600; transition: color .2s; }
                    .bottom-nav a:hover { color: var(--bf-text); }
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
