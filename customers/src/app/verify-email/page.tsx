"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { API } from "@/lib/api";
import { goToBizControl } from "@/lib/handoff";

type Status = "loading" | "success" | "error";

function VerifyInner() {
    const params = useSearchParams();
    const token = params.get("token") || "";
    const [status, setStatus] = useState<Status>("loading");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!token) {
            setStatus("error");
            setMessage("קישור האימות חסר או פגום.");
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API}/api/marketplace/auth/verify-email`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                });
                const data = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (res.ok) {
                    setStatus("success");
                } else {
                    setStatus("error");
                    setMessage(data.detail || "אימות המייל נכשל.");
                }
            } catch {
                if (!cancelled) {
                    setStatus("error");
                    setMessage("שגיאת רשת — נסו שוב מאוחר יותר.");
                }
            }
        })();
        return () => { cancelled = true; };
    }, [token]);

    const card: React.CSSProperties = {
        background: "#fff", borderRadius: 20, padding: "2.5rem 2rem", maxWidth: 440, width: "100%",
        boxShadow: "0 10px 40px rgba(0,0,0,0.08)", textAlign: "center", boxSizing: "border-box",
    };
    const btn: React.CSSProperties = {
        display: "inline-block", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff",
        border: "none", borderRadius: 14, padding: "0.85rem 2rem", fontWeight: 800, fontSize: "1rem",
        cursor: "pointer", marginTop: "1.5rem",
    };

    return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", background: "linear-gradient(135deg,#faf5ff,#eef2ff)", direction: "rtl" }}>
            <div style={card}>
                {status === "loading" && (
                    <>
                        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>⏳</div>
                        <h1 style={{ fontWeight: 900, fontSize: "1.3rem", color: "#1e1b4b" }}>מאמת את המייל שלך…</h1>
                    </>
                )}
                {status === "success" && (
                    <>
                        <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>✅</div>
                        <h1 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#1e1b4b", marginBottom: "0.4rem" }}>המייל אומת בהצלחה!</h1>
                        <p style={{ color: "#64748b", fontSize: "0.92rem" }}>תודה — כתובת המייל שלך אומתה ואתה מוכן להתחיל.</p>
                        <button style={btn} onClick={() => goToBizControl()}>המשך ל-BizControl ←</button>
                    </>
                )}
                {status === "error" && (
                    <>
                        <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>⚠️</div>
                        <h1 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#1e1b4b", marginBottom: "0.4rem" }}>האימות נכשל</h1>
                        <p style={{ color: "#64748b", fontSize: "0.92rem" }}>{message}</p>
                        <p style={{ color: "#94a3b8", fontSize: "0.82rem", marginTop: "0.75rem" }}>
                            אפשר לבקש קישור אימות חדש מתוך BizControl (באנר "אמת את המייל").
                        </p>
                        <button style={btn} onClick={() => goToBizControl()}>מעבר ל-BizControl</button>
                    </>
                )}
            </div>
        </div>
    );
}

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={null}>
            <VerifyInner />
        </Suspense>
    );
}
