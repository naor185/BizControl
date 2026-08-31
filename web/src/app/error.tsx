"use client";

import { useEffect } from "react";

// Next.js App Router error boundary — catches any otherwise-unhandled
// client-side exception in the app and shows a recoverable Hebrew screen
// instead of the raw "Application error: a client-side exception has
// occurred" white screen. Especially important inside the native app shell
// (Capacitor) where there's no visible browser chrome/back button to help a
// stuck user escape a crash on their own.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error("[BizControl] Unhandled error:", error);
    }, [error]);

    return (
        <div dir="rtl" style={{
            minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "2rem", textAlign: "center", background: "#0f172a", color: "#e2e8f0", fontFamily: "system-ui,-apple-system,sans-serif",
        }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>😕</div>
            <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.5rem" }}>משהו השתבש</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.95rem", marginBottom: "1.75rem", maxWidth: 340 }}>
                אירעה שגיאה בלתי צפויה. נסו לרענן — אם זה חוזר, נשמח שתדווחו לנו.
            </p>
            <button
                onClick={() => reset()}
                style={{
                    background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 12,
                    padding: "0.8rem 2rem", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
                    marginBottom: "1.5rem",
                }}
            >
                נסה שוב
            </button>

            {/* Temporary while we're actively tracking down mobile crashes — shows
                the real error text so it can be screenshotted, instead of relying on
                a phone's browser console (not practically reachable). Remove once
                the current round of crash reports is resolved. */}
            <div style={{
                maxWidth: 340, background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                padding: "0.85rem 1rem", textAlign: "left", direction: "ltr",
            }}>
                <div style={{ fontSize: "0.7rem", color: "#64748b", marginBottom: "0.3rem" }}>פרטים טכניים (לשליחה לתמיכה):</div>
                <div style={{ fontSize: "0.78rem", color: "#fca5a5", fontFamily: "monospace", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                    {error?.message || "(no message)"}
                </div>
                {error?.digest && (
                    <div style={{ fontSize: "0.7rem", color: "#64748b", marginTop: "0.4rem" }}>digest: {error.digest}</div>
                )}
            </div>
        </div>
    );
}
