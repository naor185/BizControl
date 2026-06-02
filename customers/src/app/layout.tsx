import type { ReactNode } from "react";

export const metadata = {
    title: "BizFind — מצא עסקים וקבע תור",
    description: "גלה ספרים, סטודיואים לקעקועים, ציפורניים, ספא ועוד — וקבע תור אונליין",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="he" dir="rtl">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <style>{`
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f1f5f9; padding-bottom: 64px; }
                    a { color: inherit; }
                    input, textarea, select, button { font-family: inherit; }
                    @keyframes spin { to { transform: rotate(360deg); } }
                    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
                    .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: rgba(15,23,42,.97); backdrop-filter: blur(12px); border-top: 1px solid rgba(255,255,255,.08); display: flex; z-index: 100; }
                    .bottom-nav a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; text-decoration: none; color: #64748b; font-size: 0.65rem; font-weight: 600; transition: color .2s; }
                    .bottom-nav a:hover { color: #a78bfa; }
                `}</style>
            </head>
            <body>
                {children}
                <nav className="bottom-nav">
                    <a href="/">🏠<span>ראשי</span></a>
                    <a href="/explore">🔍<span>חיפוש</span></a>
                    <a href="/me">📋<span>התורים שלי</span></a>
                    <a href="/for-business">🏢<span>לעסקים</span></a>
                </nav>
            </body>
        </html>
    );
}
