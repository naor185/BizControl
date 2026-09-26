"use client";

import { useEffect } from "react";
import { Frown } from "lucide-react";

// Same error boundary as BizControl's — see web/src/app/error.tsx for why.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error("[BizFind] Unhandled error:", error);
    }, [error]);

    return (
        <div dir="rtl" style={{
            minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "2rem", textAlign: "center", background: "#000", color: "#fff", fontFamily: "system-ui,-apple-system,sans-serif",
        }}>
            <Frown size={46} strokeWidth={1.5} aria-hidden style={{ marginBottom: "1rem" }} />
            <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.5rem" }}>משהו השתבש</h1>
            <p style={{ color: "rgba(255,255,255,.68)", fontSize: "0.95rem", marginBottom: "1.75rem", maxWidth: 340 }}>
                אירעה שגיאה בלתי צפויה. נסו לרענן — אם זה חוזר, נשמח שתדווחו לנו.
            </p>
            <button
                onClick={() => reset()}
                style={{
                    background: "#fff", color: "#000", border: "none", borderRadius: 12,
                    padding: "0.8rem 2rem", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
                }}
            >
                נסה שוב
            </button>
        </div>
    );
}
