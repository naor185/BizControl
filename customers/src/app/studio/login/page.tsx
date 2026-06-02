"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API, setToken } from "@/lib/api";

export default function StudioLoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const login = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) return;
        setLoading(true); setErr(null);
        try {
            const fd = new FormData();
            fd.append("username", email.trim());
            fd.append("password", password);
            const res = await fetch(`${API}/api/auth/token`, { method: "POST", body: fd });
            if (!res.ok) throw new Error("מייל או סיסמה שגויים");
            const data = await res.json();
            setToken(data.access_token);
            localStorage.setItem("biz_studio_token", data.access_token);
            router.push("/studio/dashboard");
        } catch (e: any) { setErr(e.message); }
        finally { setLoading(false); }
    };

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "linear-gradient(135deg,#f5f3ff,#ede9fe,#e0e7ff)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 1rem", fontFamily: "system-ui,sans-serif" }}>
            <div style={{ width: "100%", maxWidth: 420 }}>

                {/* Logo */}
                <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                    <Link href="/" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900 }}>B</div>
                        <span style={{ fontWeight: 900, fontSize: "1.2rem", color: "#1e1b4b" }}>BizFind</span>
                    </Link>
                    <p style={{ color: "#7c3aed", fontSize: "0.88rem", marginTop: "0.4rem", fontWeight: 600 }}>ניהול עמוד העסק</p>
                </div>

                {/* Card */}
                <div style={{ background: "#fff", borderRadius: 24, padding: "2rem", boxShadow: "0 8px 40px rgba(124,58,237,.12)", border: "1px solid #ede9fe" }}>
                    <h1 style={{ fontSize: "1.4rem", fontWeight: 900, color: "#1e1b4b", marginBottom: "0.4rem" }}>ברוכים הבאים 👋</h1>
                    <p style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
                        כניסה עם פרטי BizControl שלכם
                    </p>

                    <form onSubmit={login} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        <div>
                            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: "0.4rem" }}>כתובת מייל</label>
                            <input
                                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                                placeholder="you@example.com" dir="ltr"
                                style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.95rem", outline: "none", background: "#fafafa", boxSizing: "border-box", transition: "border-color .2s" }}
                                onFocus={e => (e.target.style.borderColor = "#7c3aed")}
                                onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                            />
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: "0.4rem" }}>סיסמה</label>
                            <input
                                type="password" value={password} onChange={e => setPassword(e.target.value)} required
                                placeholder="••••••••"
                                style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.95rem", outline: "none", background: "#fafafa", boxSizing: "border-box", transition: "border-color .2s" }}
                                onFocus={e => (e.target.style.borderColor = "#7c3aed")}
                                onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                            />
                        </div>

                        {err && (
                            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.65rem 0.9rem", color: "#dc2626", fontSize: "0.85rem" }}>
                                ⚠️ {err}
                            </div>
                        )}

                        <button type="submit" disabled={loading}
                            style={{ background: loading ? "#c4b5fd" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 12, padding: "0.85rem", fontWeight: 800, fontSize: "1rem", cursor: loading ? "default" : "pointer", boxShadow: loading ? "none" : "0 4px 16px rgba(124,58,237,.3)", transition: "all .2s", marginTop: "0.25rem" }}>
                            {loading ? "מתחבר..." : "כניסה לניהול העסק ←"}
                        </button>
                    </form>

                    <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid #f1f5f9", textAlign: "center" }}>
                        <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "0.75rem" }}>אין לכם חשבון BizControl?</p>
                        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center", flexWrap: "wrap" }}>
                            <a href="https://www.biz-control.com" target="_blank" rel="noopener"
                                style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", padding: "0.55rem 1.1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", textDecoration: "none" }}>
                                🚀 נסו BizControl בחינם
                            </a>
                            <Link href="/for-business"
                                style={{ background: "#f5f3ff", color: "#7c3aed", padding: "0.55rem 1.1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", textDecoration: "none", border: "1px solid #ede9fe" }}>
                                📋 למד עוד
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
