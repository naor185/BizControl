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
                }}
            >
                נסה שוב
            </button>
        </div>
    );
}
