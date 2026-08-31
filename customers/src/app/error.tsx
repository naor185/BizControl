"use client";

import { useEffect } from "react";

// Same error boundary as BizControl's — see web/src/app/error.tsx for why.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error("[BizFind] Unhandled error:", error);
    }, [error]);

    return (
        <div dir="rtl" style={{
            minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "2rem", textAlign: "center", background: "#0f172a", color: "#f1f5f9", fontFamily: "system-ui,-apple-system,sans-serif",
        }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>😕</div>
            <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.5rem" }}>משהו השתבש</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.95rem", marginBottom: "1.75rem", maxWidth: 340 }}>
                אירעה שגיאה בלתי צפויה. נסו לרענן — אם זה חוזר, נשמח שתדווחו לנו.
            </p>
            <button
                onClick={() => reset()}
                style={{
                    background: "#7c3aed", color: "#fff", border: "none", borderRadius: 12,
                    padding: "0.8rem 2rem", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
                }}
            >
                נסה שוב
            </button>
        </div>
    );
}
