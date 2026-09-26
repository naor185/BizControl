"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { API } from "@/lib/api";
import { getStudioToken, setStudioToken, goToBizControl } from "@/lib/handoff";
import { AlertTriangle, Info, Rocket } from "lucide-react";
import PasswordInput from "@/components/PasswordInput";

export default function StudioLoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [checkingSession, setCheckingSession] = useState(true);

    // Already logged in? Skip the form entirely and go straight to BizControl.
    useEffect(() => {
        if (getStudioToken()) {
            goToBizControl("/dashboard");
        } else {
            setCheckingSession(false);
        }
    }, []);

    const login = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) return;
        setLoading(true); setErr(null);
        try {
            const res = await fetch(`${API}/api/marketplace/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim(), password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "מייל או סיסמה שגויים");
            // 2FA / multi-business accounts need a fuller flow than this
            // simple form has — hand off to BizControl's own login, which
            // has both, instead of duplicating that UI here.
            if (data.requires_2fa || data.requires_studio_selection) {
                window.location.href = `https://www.biz-control.com/login?email=${encodeURIComponent(email.trim())}`;
                return;
            }
            setStudioToken(data.access_token);
            await goToBizControl("/dashboard");
        } catch (e: any) { setErr(e.message); setLoading(false); }
    };

    if (checkingSession) return null;

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, #262626 0%, #000 65%)", color: "var(--bf-text)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 1rem" }}>
            <div style={{ width: "100%", maxWidth: 420 }}>

                {/* Logo */}
                <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                    <Link href="/" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
                        <img src="/logo.png" alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
                        <span style={{ fontWeight: 900, fontSize: "1.2rem", color: "var(--bf-text)" }}>BizFind</span>
                    </Link>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginTop: "0.4rem", fontWeight: 600 }}>ניהול עמוד העסק</p>
                </div>

                {/* Card */}
                <div style={{ background: "rgba(12,12,12,.9)", backdropFilter: "blur(14px)", borderRadius: 24, padding: "2rem", border: "1px solid var(--bf-line)" }}>
                    <h1 style={{ fontSize: "1.4rem", fontWeight: 900, color: "var(--bf-text)", marginBottom: "0.4rem" }}>ברוכים הבאים</h1>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
                        כניסה עם פרטי BizControl שלכם
                    </p>

                    <form onSubmit={login} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        <div>
                            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "var(--bf-muted)", marginBottom: "0.4rem" }}>כתובת מייל</label>
                            <input
                                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                                placeholder="you@example.com" dir="ltr"
                                style={{ width: "100%", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.95rem", outline: "none", background: "rgba(255,255,255,.07)", color: "#fff", colorScheme: "dark", boxSizing: "border-box", transition: "border-color .2s" }}
                                onFocus={e => (e.target.style.borderColor = "#fff")}
                                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,.16)")}
                            />
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "var(--bf-muted)", marginBottom: "0.4rem" }}>סיסמה</label>
                            <PasswordInput
                                value={password} onChange={e => setPassword(e.target.value)} required
                                placeholder="••••••••"
                                style={{ width: "100%", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.95rem", outline: "none", background: "rgba(255,255,255,.07)", color: "#fff", colorScheme: "dark", boxSizing: "border-box", transition: "border-color .2s" }}
                                onFocus={e => (e.target.style.borderColor = "#fff")}
                                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,.16)")}
                            />
                            <a href="https://www.biz-control.com/forgot-password" target="_blank" rel="noopener"
                                style={{ display: "inline-block", marginTop: "0.5rem", color: "var(--bf-muted)", fontSize: "0.82rem", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
                                שכחתם סיסמה?
                            </a>
                        </div>

                        {err && (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.35)", borderRadius: 10, padding: "0.65rem 0.9rem", color: "#fca5a5", fontSize: "0.85rem" }}>
                                <AlertTriangle size={16} style={{ flexShrink: 0 }} aria-hidden /> {err}
                            </div>
                        )}

                        <button type="submit" disabled={loading}
                            style={{ background: "#fff", color: "#000", border: "none", borderRadius: 12, padding: "0.85rem", fontWeight: 800, fontSize: "1rem", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1, transition: "opacity .2s", marginTop: "0.25rem" }}>
                            {loading ? "מתחבר..." : "כניסה לניהול העסק ←"}
                        </button>
                    </form>

                    <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--bf-line)", textAlign: "center" }}>
                        <p style={{ color: "var(--bf-muted)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>אין לכם חשבון BizControl?</p>
                        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center", flexWrap: "wrap" }}>
                            <Link href="/for-business/register?plan=trial"
                                style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "#fff", color: "#000", padding: "0.55rem 1.1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", textDecoration: "none" }}>
                                <Rocket size={14} aria-hidden /> הצטרפו בחינם
                            </Link>
                            <Link href="/for-business"
                                style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "var(--bf-glass)", color: "var(--bf-text)", padding: "0.55rem 1.1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", textDecoration: "none", border: "1px solid var(--bf-line)" }}>
                                <Info size={14} aria-hidden /> למד עוד
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
