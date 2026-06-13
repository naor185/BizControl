"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { API, setToken } from "@/lib/api";

// ── Plan display config ───────────────────────────────────────────────────────

const PLAN_META: Record<string, { label: string; price: string; scope: string; color: string; icon: string }> = {
    trial:          { label: "ניסיון חינמי 14 יום", price: "חינם",    scope: "BizFind + BizControl",  color: "#7c3aed", icon: "🚀" },
    bizfind_basic:  { label: "BizFind Basic",        price: "₪99/חודש", scope: "BizFind בלבד",          color: "#0ea5e9", icon: "📍" },
    bizfind_pro:    { label: "BizFind Pro",           price: "₪179/חודש",scope: "BizFind בלבד",          color: "#0ea5e9", icon: "📍" },
    starter:        { label: "BizControl Starter",   price: "₪199/חודש",scope: "BizFind + BizControl", color: "#16a34a", icon: "⚡" },
    pro:            { label: "BizControl Pro",        price: "₪349/חודש",scope: "BizFind + BizControl", color: "#16a34a", icon: "⚡" },
    studio:         { label: "BizControl Studio",     price: "₪499/חודש",scope: "BizFind + BizControl", color: "#16a34a", icon: "⚡" },
};

const CATEGORIES = [
    "קעקועים", "ספרות", "קוסמטיקה ויופי", "פדיקור ומניקור", "עיצוב שיער",
    "מכון כושר", "עיסוי ורפלקסולוגיה", "פילאטיס ויוגה", "קליניקה / בריאות",
    "שיניים", "פסיכולוגיה / קואצ׳ינג", "אחר",
];

// ── Step indicator ────────────────────────────────────────────────────────────

function Steps({ current, total }: { current: number; total: number }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", justifyContent: "center", marginBottom: "2rem" }}>
            {Array.from({ length: total }, (_, i) => (
                <div key={i} style={{
                    width: i < current ? 28 : 10,
                    height: 6,
                    borderRadius: 6,
                    background: i < current ? "#7c3aed" : i === current - 1 ? "#7c3aed" : "#e2e8f0",
                    transition: "all .3s",
                }} />
            ))}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

function RegisterInner() {
    const router = useRouter();
    const params = useSearchParams();
    const planFromUrl = params.get("plan") || "trial";

    const [step, setStep] = useState(1);
    const [planKey, setPlanKey] = useState(planFromUrl);
    const [form, setForm] = useState({
        business_name: "",
        category: "",
        city: "",
        owner_name: "",
        email: "",
        password: "",
        phone: "",
    });
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const plan = PLAN_META[planKey] || PLAN_META["trial"];
    const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

    const next = () => { setErr(null); setStep(s => s + 1); };
    const back = () => { setErr(null); setStep(s => s - 1); };

    const canStep1 = planKey !== "";
    const canStep2 = form.business_name.trim().length >= 2 && form.category && form.city.trim();
    const canStep3 = form.owner_name.trim().length >= 2 && form.email.trim() && form.password.length >= 6;

    const submit = async () => {
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch(`${API}/api/marketplace/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    business_name: form.business_name.trim(),
                    category: form.category,
                    city: form.city.trim(),
                    owner_name: form.owner_name.trim(),
                    email: form.email.trim(),
                    password: form.password,
                    phone: form.phone.trim() || undefined,
                    plan_key: planKey,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "שגיאה ברישום");
            setToken(data.access_token);
            localStorage.setItem("biz_studio_token", data.access_token);
            setSuccess(true);
            setTimeout(() => router.push("/studio/dashboard"), 2200);
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12,
        padding: "0.75rem 1rem", fontSize: "1rem", outline: "none",
        fontFamily: "system-ui,sans-serif", color: "#1e293b", background: "#fff",
        boxSizing: "border-box" as const,
    };
    const labelStyle = { display: "block", fontSize: "0.85rem", fontWeight: 700, color: "#374151", marginBottom: "0.45rem" };

    if (success) {
        return (
            <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
                <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🎉</div>
                <h2 style={{ fontWeight: 900, color: "#1e1b4b", marginBottom: "0.5rem" }}>ברוכים הבאים!</h2>
                <p style={{ color: "#64748b" }}>העסק שלכם נרשם בהצלחה. מעביר אתכם ללוח הבקרה...</p>
            </div>
        );
    }

    return (
        <>
            <Steps current={step} total={3} />

            {/* Step 1 — Plan selection */}
            {step === 1 && (
                <div>
                    <h2 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#1e1b4b", textAlign: "center", marginBottom: "0.5rem" }}>
                        בחרו תוכנית
                    </h2>
                    <p style={{ color: "#64748b", textAlign: "center", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
                        כל התוכניות כוללות 14 יום ניסיון חינמי
                    </p>

                    {/* Scope toggle */}
                    <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1.5rem" }}>
                        {/* Trial */}
                        {(["trial"] as const).map(key => {
                            const p = PLAN_META[key];
                            const sel = planKey === key;
                            return (
                                <button key={key} onClick={() => setPlanKey(key)} style={{
                                    border: sel ? "2.5px solid #7c3aed" : "1.5px solid #e2e8f0",
                                    borderRadius: 14, padding: "1rem 1.25rem",
                                    background: sel ? "#f5f3ff" : "#fff",
                                    cursor: "pointer", textAlign: "right", display: "flex",
                                    alignItems: "center", gap: "0.75rem", transition: "all .15s",
                                }}>
                                    <span style={{ fontSize: "1.4rem" }}>{p.icon}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 800, color: "#1e1b4b" }}>{p.label}</div>
                                        <div style={{ fontSize: "0.8rem", color: "#64748b" }}>{p.scope} — ללא כרטיס אשראי</div>
                                    </div>
                                    <div style={{ fontWeight: 900, color: "#7c3aed", fontSize: "1.1rem" }}>{p.price}</div>
                                    {sel && <span style={{ color: "#7c3aed" }}>✓</span>}
                                </button>
                            );
                        })}

                        <div style={{ textAlign: "center", fontSize: "0.8rem", color: "#94a3b8", margin: "0.25rem 0" }}>— או בחרו תוכנית בתשלום —</div>

                        {/* Paid plans */}
                        {(["bizfind_basic", "bizfind_pro", "starter", "pro", "studio"] as const).map(key => {
                            const p = PLAN_META[key];
                            const sel = planKey === key;
                            const isBizControl = p.scope.includes("BizControl");
                            return (
                                <button key={key} onClick={() => setPlanKey(key)} style={{
                                    border: sel ? `2.5px solid ${p.color}` : "1.5px solid #e2e8f0",
                                    borderRadius: 14, padding: "0.9rem 1.25rem",
                                    background: sel ? (isBizControl ? "#f0fdf4" : "#f0f9ff") : "#fff",
                                    cursor: "pointer", textAlign: "right", display: "flex",
                                    alignItems: "center", gap: "0.75rem", transition: "all .15s",
                                }}>
                                    <span style={{ fontSize: "1.2rem" }}>{p.icon}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 800, color: "#1e1b4b", fontSize: "0.95rem" }}>{p.label}</div>
                                        <div style={{ fontSize: "0.78rem", color: "#64748b" }}>{p.scope}</div>
                                    </div>
                                    <div style={{ fontWeight: 900, color: p.color, fontSize: "0.95rem" }}>{p.price}</div>
                                    {sel && <span style={{ color: p.color }}>✓</span>}
                                </button>
                            );
                        })}
                    </div>

                    <button onClick={next} disabled={!canStep1} style={{
                        width: "100%", background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                        color: "#fff", border: "none", borderRadius: 14, padding: "0.9rem",
                        fontWeight: 800, fontSize: "1rem", cursor: "pointer", opacity: canStep1 ? 1 : 0.45,
                    }}>
                        המשיכו ←
                    </button>

                    {/* Selected plan badge */}
                    {planKey && (
                        <p style={{ textAlign: "center", fontSize: "0.8rem", color: "#7c3aed", marginTop: "0.75rem", fontWeight: 600 }}>
                            {plan.icon} {plan.label} · {plan.price}
                        </p>
                    )}
                </div>
            )}

            {/* Step 2 — Business details */}
            {step === 2 && (
                <div>
                    <h2 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#1e1b4b", marginBottom: "0.4rem" }}>פרטי העסק</h2>
                    <p style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
                        פרטים אלה יופיעו בפרופיל הציבורי שלכם ב-BizFind
                    </p>

                    <div style={{ display: "grid", gap: "1rem" }}>
                        <div>
                            <label style={labelStyle}>שם העסק *</label>
                            <input style={inputStyle} placeholder="לדוגמה: סטודיו נעמי" value={form.business_name} onChange={e => set("business_name", e.target.value)} maxLength={120} />
                        </div>
                        <div>
                            <label style={labelStyle}>קטגוריה *</label>
                            <select style={inputStyle} value={form.category} onChange={e => set("category", e.target.value)}>
                                <option value="">בחרו קטגוריה</option>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>עיר *</label>
                            <input style={inputStyle} placeholder="תל אביב, ירושלים, חיפה..." value={form.city} onChange={e => set("city", e.target.value)} maxLength={60} />
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.75rem" }}>
                        <button onClick={back} style={{ flex: 1, background: "#f8fafc", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "0.85rem", fontWeight: 700, cursor: "pointer" }}>
                            חזרה
                        </button>
                        <button onClick={next} disabled={!canStep2} style={{
                            flex: 2, background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                            color: "#fff", border: "none", borderRadius: 14, padding: "0.85rem",
                            fontWeight: 800, fontSize: "1rem", cursor: "pointer", opacity: canStep2 ? 1 : 0.45,
                        }}>
                            המשיכו ←
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3 — Account */}
            {step === 3 && (
                <div>
                    <h2 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#1e1b4b", marginBottom: "0.4rem" }}>יצירת חשבון</h2>
                    <p style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
                        פרטים אלה ישמשו להתחברות ל-BizFind ול-BizControl
                    </p>

                    {/* Plan summary */}
                    <div style={{ background: "#f5f3ff", border: "1px solid #ede9fe", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.85rem", color: "#7c3aed", fontWeight: 700 }}>{plan.icon} {plan.label}</span>
                        <span style={{ fontSize: "0.85rem", color: "#7c3aed", fontWeight: 800 }}>{plan.price}</span>
                    </div>

                    <div style={{ display: "grid", gap: "1rem" }}>
                        <div>
                            <label style={labelStyle}>שם מלא *</label>
                            <input style={inputStyle} placeholder="ישראל ישראלי" value={form.owner_name} onChange={e => set("owner_name", e.target.value)} />
                        </div>
                        <div>
                            <label style={labelStyle}>אימייל *</label>
                            <input style={inputStyle} type="email" placeholder="email@example.com" dir="ltr" value={form.email} onChange={e => set("email", e.target.value)} />
                        </div>
                        <div>
                            <label style={labelStyle}>סיסמה * (לפחות 6 תווים)</label>
                            <input style={inputStyle} type="password" placeholder="••••••••" dir="ltr" value={form.password} onChange={e => set("password", e.target.value)} />
                        </div>
                        <div>
                            <label style={labelStyle}>טלפון (אופציונלי)</label>
                            <input style={inputStyle} type="tel" placeholder="050-0000000" dir="ltr" value={form.phone} onChange={e => set("phone", e.target.value)} />
                        </div>
                    </div>

                    {err && (
                        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 12, padding: "0.75rem 1rem", marginTop: "1rem", fontSize: "0.88rem" }}>
                            {err}
                        </div>
                    )}

                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.75rem" }}>
                        <button onClick={back} style={{ flex: 1, background: "#f8fafc", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "0.85rem", fontWeight: 700, cursor: "pointer" }}>
                            חזרה
                        </button>
                        <button onClick={submit} disabled={!canStep3 || loading} style={{
                            flex: 2, background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                            color: "#fff", border: "none", borderRadius: 14, padding: "0.85rem",
                            fontWeight: 800, fontSize: "1rem", cursor: "pointer", opacity: (canStep3 && !loading) ? 1 : 0.45,
                        }}>
                            {loading ? "יוצר חשבון..." : "הצטרפו עכשיו ←"}
                        </button>
                    </div>

                    <p style={{ textAlign: "center", fontSize: "0.78rem", color: "#94a3b8", marginTop: "1rem" }}>
                        בלחיצה על הצטרפו אתם מסכימים ל<a href="/terms" style={{ color: "#7c3aed" }}>תנאי השימוש</a> שלנו
                    </p>
                </div>
            )}
        </>
    );
}

export default function RegisterPage() {
    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "linear-gradient(135deg,#f5f3ff,#ede9fe,#e0e7ff)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 1rem", fontFamily: "system-ui,sans-serif" }}>
            <div style={{ width: "100%", maxWidth: 480 }}>

                {/* Logo */}
                <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                    <Link href="/" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900 }}>B</div>
                        <span style={{ fontWeight: 900, fontSize: "1.2rem", color: "#1e1b4b" }}>BizFind</span>
                    </Link>
                    <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "0.4rem" }}>הצטרפו לפלטפורמה</p>
                </div>

                <div style={{ background: "#fff", borderRadius: 24, padding: "2rem", boxShadow: "0 8px 40px rgba(124,58,237,.12)", border: "1px solid #ede9fe" }}>
                    <Suspense fallback={<div>טוען...</div>}>
                        <RegisterInner />
                    </Suspense>
                </div>

                <p style={{ textAlign: "center", fontSize: "0.85rem", color: "#64748b", marginTop: "1.25rem" }}>
                    יש לכם כבר חשבון?{" "}
                    <Link href="/studio/login" style={{ color: "#7c3aed", fontWeight: 700, textDecoration: "none" }}>כניסה</Link>
                </p>
            </div>
        </div>
    );
}
