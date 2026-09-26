"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";
import { setStudioToken, goToBizControl } from "@/lib/handoff";
import { Check, PartyPopper, Rocket, Zap, type LucideIcon } from "lucide-react";
import PasswordInput from "@/components/PasswordInput";
import { GLASS_CARD, OPTION_STYLE } from "@/lib/look";

// ── Plan display config ───────────────────────────────────────────────────────

const PLAN_META: Record<string, { label: string; price: string; scope: string; icon: LucideIcon }> = {
    trial:          { label: "ניסיון חינמי 14 יום", price: "חינם",    scope: "BizFind + BizControl",  icon: Rocket },
    starter:        { label: "BizControl Starter",   price: "₪199/חודש",scope: "BizFind + BizControl", icon: Zap },
    pro:            { label: "BizControl Pro",        price: "₪349/חודש",scope: "BizFind + BizControl", icon: Zap },
    studio:         { label: "BizControl Studio",     price: "₪499/חודש",scope: "BizFind + BizControl", icon: Zap },
};

// The business types come from the one list (GET /api/public/business-types) — BizFind lists every
// type, including shops without appointments.
type BusinessType = { key: string; label: string };

// ── Step indicator ────────────────────────────────────────────────────────────

function Steps({ current, total }: { current: number; total: number }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", justifyContent: "center", marginBottom: "2rem" }}>
            {Array.from({ length: total }, (_, i) => (
                <div key={i} style={{
                    width: i < current ? 28 : 10,
                    height: 6,
                    borderRadius: 6,
                    background: i < current ? "#fff" : "rgba(255,255,255,.15)",
                    transition: "all .3s",
                }} />
            ))}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

function RegisterInner() {
    const params = useSearchParams();
    const planFromUrl = params.get("plan") || "trial";

    const [step, setStep] = useState(1);
    const [planKey, setPlanKey] = useState(planFromUrl);
    const [form, setForm] = useState({
        business_name: "",
        category: "",
        category_other: "",
        city: "",
        owner_name: "",
        email: "",
        password: "",
        password_confirm: "",
        phone: "",
    });
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [types, setTypes] = useState<BusinessType[]>([]);
    useEffect(() => {
        fetch(`${API}/api/public/business-types`).then(r => r.json()).then(setTypes).catch(() => setTypes([]));
    }, []);

    const plan = PLAN_META[planKey] || PLAN_META["trial"];
    const PlanIcon = plan.icon;
    const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

    const next = () => { setErr(null); setStep(s => s + 1); };
    const back = () => { setErr(null); setStep(s => s - 1); };

    const canStep1 = planKey !== "";
    const canStep2 = form.business_name.trim().length >= 2 && form.category
        && (form.category !== "other" || form.category_other.trim().length >= 2)
        && form.city.trim();
    const passwordsMatch = form.password === form.password_confirm;
    const phoneDigits = form.phone.replace(/\D/g, "");
    const canStep3 = form.owner_name.trim().length >= 2 && form.email.trim()
        && form.password.length >= 6 && passwordsMatch
        && phoneDigits.length >= 9;

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
                    category_other: form.category === "other" ? form.category_other.trim() : undefined,
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
            setStudioToken(data.access_token);
            setSuccess(true);
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: "100%", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12,
        padding: "0.75rem 1rem", fontSize: "1rem", outline: "none",
        color: "#fff", background: "rgba(255,255,255,.07)",
        boxSizing: "border-box" as const, colorScheme: "dark" as const,
    };
    const labelStyle = { display: "block", fontSize: "0.85rem", fontWeight: 700, color: "var(--bf-muted)", marginBottom: "0.45rem" };

    if (success) {
        return (
            <div style={{ textAlign: "center", padding: "2rem 0.5rem" }}>
                <PartyPopper size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: "0.75rem" }} />
                <h2 style={{ fontWeight: 900, color: "var(--bf-text)", marginBottom: "0.4rem", fontSize: "1.4rem" }}>ברוכים הבאים!</h2>
                <p style={{ color: "var(--bf-muted)", fontSize: "0.9rem", marginBottom: "1.75rem" }}>
                    העסק שלכם נרשם בהצלחה.
                </p>

                <div style={{ ...GLASS_CARD, borderRadius: 16, padding: "1.25rem", marginBottom: "1.25rem", textAlign: "right" }}>
                    <div style={{ fontWeight: 800, color: "var(--bf-text)", marginBottom: "0.35rem", display: "flex", alignItems: "center", gap: "0.35rem" }}><Zap size={16} aria-hidden /> הצעד הבא — הגדרת BizControl</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--bf-muted)", lineHeight: 1.6 }}>
                        כדי לפתוח את היומן, CRM, תשלומים ואוטומציות — כנסו ל-BizControl והשלימו את הגדרות העסק.
                    </div>
                </div>
                <button type="button" onClick={() => goToBizControl("/onboarding")} style={{
                    display: "block", width: "100%", background: "#fff",
                    color: "#000", border: "none", textDecoration: "none", padding: "0.9rem",
                    borderRadius: 14, fontWeight: 800, fontSize: "1rem", cursor: "pointer",
                }}>
                    פתח BizControl ← הגדר את העסק שלי
                </button>
            </div>
        );
    }

    return (
        <>
            <Steps current={step} total={3} />

            {/* Step 1 — Plan selection */}
            {step === 1 && (
                <div>
                    <h2 style={{ fontWeight: 900, fontSize: "1.4rem", color: "var(--bf-text)", textAlign: "center", marginBottom: "0.5rem" }}>
                        בחרו תוכנית
                    </h2>
                    <p style={{ color: "var(--bf-muted)", textAlign: "center", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
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
                                    border: sel ? "1.5px solid #fff" : "1px solid var(--bf-line)",
                                    borderRadius: 14, padding: "1rem 1.25rem", color: "var(--bf-text)",
                                    background: sel ? "var(--bf-glass-strong)" : "var(--bf-glass)",
                                    cursor: "pointer", textAlign: "right", display: "flex",
                                    alignItems: "center", gap: "0.75rem", transition: "all .15s",
                                }}>
                                    <p.icon size={22} aria-hidden />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 800, color: "var(--bf-text)" }}>{p.label}</div>
                                        <div style={{ fontSize: "0.8rem", color: "var(--bf-muted)" }}>{p.scope} — ללא כרטיס אשראי</div>
                                    </div>
                                    <div style={{ fontWeight: 900, color: "var(--bf-text)", fontSize: "1.1rem" }}>{p.price}</div>
                                    {sel && <Check size={18} aria-hidden />}
                                </button>
                            );
                        })}

                        <div style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--bf-faint)", margin: "0.25rem 0" }}>— או בחרו תוכנית בתשלום —</div>

                        {/* Paid plans */}
                        {(["starter", "pro", "studio"] as const).map(key => {
                            const p = PLAN_META[key];
                            const sel = planKey === key;
                            return (
                                <button key={key} onClick={() => setPlanKey(key)} style={{
                                    border: sel ? "1.5px solid #fff" : "1px solid var(--bf-line)",
                                    borderRadius: 14, padding: "0.9rem 1.25rem", color: "var(--bf-text)",
                                    background: sel ? "var(--bf-glass-strong)" : "var(--bf-glass)",
                                    cursor: "pointer", textAlign: "right", display: "flex",
                                    alignItems: "center", gap: "0.75rem", transition: "all .15s",
                                }}>
                                    <p.icon size={20} aria-hidden />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 800, color: "var(--bf-text)", fontSize: "0.95rem" }}>{p.label}</div>
                                        <div style={{ fontSize: "0.78rem", color: "var(--bf-muted)" }}>{p.scope}</div>
                                    </div>
                                    <div style={{ fontWeight: 900, color: "var(--bf-text)", fontSize: "0.95rem" }}>{p.price}</div>
                                    {sel && <Check size={18} aria-hidden />}
                                </button>
                            );
                        })}
                    </div>

                    <button onClick={next} disabled={!canStep1} style={{
                        width: "100%", background: "#fff",
                        color: "#000", border: "none", borderRadius: 14, padding: "0.9rem",
                        fontWeight: 800, fontSize: "1rem", cursor: "pointer", opacity: canStep1 ? 1 : 0.45,
                    }}>
                        המשיכו ←
                    </button>

                    {/* Selected plan badge */}
                    {planKey && (
                        <p style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--bf-text)", marginTop: "0.75rem", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}>
                            <PlanIcon size={14} aria-hidden /> {plan.label} · {plan.price}
                        </p>
                    )}
                </div>
            )}

            {/* Step 2 — Business details */}
            {step === 2 && (
                <div>
                    <h2 style={{ fontWeight: 900, fontSize: "1.4rem", color: "var(--bf-text)", marginBottom: "0.4rem" }}>פרטי העסק</h2>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
                        פרטים אלה יופיעו בפרופיל הציבורי שלכם ב-BizFind
                    </p>

                    <div style={{ display: "grid", gap: "1rem" }}>
                        <div>
                            <label style={labelStyle}>שם העסק *</label>
                            <input style={inputStyle} placeholder="שם העסק כפי שהלקוחות מכירים אותו" value={form.business_name} onChange={e => set("business_name", e.target.value)} maxLength={120} />
                        </div>
                        <div>
                            <label style={labelStyle}>קטגוריה *</label>
                            <select style={inputStyle} value={form.category} onChange={e => set("category", e.target.value)}>
                                <option value="" style={OPTION_STYLE}>בחרו קטגוריה</option>
                                {types.map(t => <option key={t.key} value={t.key} style={OPTION_STYLE}>{t.label}</option>)}
                            </select>
                            {form.category === "other" && (
                                <input
                                    style={{ ...inputStyle, marginTop: "0.5rem" }}
                                    placeholder="פרטו את קטגוריית העסק"
                                    value={form.category_other}
                                    onChange={e => set("category_other", e.target.value)}
                                    maxLength={60}
                                    autoFocus
                                />
                            )}
                        </div>
                        <div>
                            <label style={labelStyle}>עיר *</label>
                            <input style={inputStyle} placeholder="תל אביב, ירושלים, חיפה..." value={form.city} onChange={e => set("city", e.target.value)} maxLength={60} />
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.75rem" }}>
                        <button onClick={back} style={{ flex: 1, background: "var(--bf-glass)", color: "var(--bf-text)", border: "1px solid var(--bf-line)", borderRadius: 14, padding: "0.85rem", fontWeight: 700, cursor: "pointer" }}>
                            חזרה
                        </button>
                        <button onClick={next} disabled={!canStep2} style={{
                            flex: 2, background: "#fff",
                            color: "#000", border: "none", borderRadius: 14, padding: "0.85rem",
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
                    <h2 style={{ fontWeight: 900, fontSize: "1.4rem", color: "var(--bf-text)", marginBottom: "0.4rem" }}>יצירת חשבון</h2>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
                        פרטים אלה ישמשו להתחברות ל-BizFind ול-BizControl
                    </p>

                    {/* Plan summary */}
                    <div style={{ background: "var(--bf-glass-strong)", border: "1px solid var(--bf-line)", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.85rem", color: "var(--bf-text)", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.3rem" }}><PlanIcon size={15} aria-hidden /> {plan.label}</span>
                        <span style={{ fontSize: "0.85rem", color: "var(--bf-text)", fontWeight: 800 }}>{plan.price}</span>
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
                            <PasswordInput style={inputStyle} placeholder="••••••••" dir="ltr" autoComplete="new-password" value={form.password} onChange={e => set("password", e.target.value)} />
                        </div>
                        <div>
                            <label style={labelStyle}>אימות סיסמה *</label>
                            <PasswordInput style={inputStyle} placeholder="הקלידו שוב את הסיסמה" dir="ltr" autoComplete="new-password" value={form.password_confirm} onChange={e => set("password_confirm", e.target.value)} />
                            {form.password_confirm.length > 0 && !passwordsMatch && (
                                <p style={{ color: "#f87171", fontSize: "0.78rem", marginTop: "0.35rem" }}>הסיסמאות אינן תואמות</p>
                            )}
                        </div>
                        <div>
                            <label style={labelStyle}>טלפון *</label>
                            <input style={inputStyle} type="tel" placeholder="050-0000000" dir="ltr" value={form.phone} onChange={e => set("phone", e.target.value)} />
                            <p style={{ color: "var(--bf-faint)", fontSize: "0.78rem", marginTop: "0.35rem" }}>נשלח אליכם וואטסאפ לאימות ולתזכורות</p>
                        </div>
                    </div>

                    {err && (
                        <div style={{ background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.35)", color: "#fca5a5", borderRadius: 12, padding: "0.75rem 1rem", marginTop: "1rem", fontSize: "0.88rem" }}>
                            {err}
                        </div>
                    )}

                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.75rem" }}>
                        <button onClick={back} style={{ flex: 1, background: "var(--bf-glass)", color: "var(--bf-text)", border: "1px solid var(--bf-line)", borderRadius: 14, padding: "0.85rem", fontWeight: 700, cursor: "pointer" }}>
                            חזרה
                        </button>
                        <button onClick={submit} disabled={!canStep3 || loading} style={{
                            flex: 2, background: "#fff",
                            color: "#000", border: "none", borderRadius: 14, padding: "0.85rem",
                            fontWeight: 800, fontSize: "1rem", cursor: "pointer", opacity: (canStep3 && !loading) ? 1 : 0.45,
                        }}>
                            {loading ? "יוצר חשבון..." : "הצטרפו עכשיו ←"}
                        </button>
                    </div>

                    <p style={{ textAlign: "center", fontSize: "0.78rem", color: "var(--bf-faint)", marginTop: "1rem" }}>
                        בלחיצה על הצטרפו אתם מסכימים ל<a href="/terms" style={{ color: "var(--bf-text)" }}>תנאי השימוש</a> שלנו
                    </p>
                </div>
            )}
        </>
    );
}

export default function RegisterPage() {
    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, #262626 0%, #000 65%)", color: "var(--bf-text)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 1rem" }}>
            <div style={{ width: "100%", maxWidth: 480 }}>

                {/* Logo */}
                <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                    <Link href="/" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
                        <img src="/logo.png" alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
                        <span style={{ fontWeight: 900, fontSize: "1.2rem", color: "var(--bf-text)" }}>BizFind</span>
                    </Link>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.85rem", marginTop: "0.4rem" }}>הצטרפו לפלטפורמה</p>
                </div>

                <div style={{ background: "rgba(12,12,12,.9)", backdropFilter: "blur(14px)", borderRadius: 24, padding: "2rem", border: "1px solid var(--bf-line)" }}>
                    <Suspense fallback={<div>טוען...</div>}>
                        <RegisterInner />
                    </Suspense>
                </div>

                <p style={{ textAlign: "center", fontSize: "0.85rem", color: "var(--bf-muted)", marginTop: "1.25rem" }}>
                    יש לכם כבר חשבון?{" "}
                    <Link href="/studio/login" style={{ color: "var(--bf-text)", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3 }}>כניסה</Link>
                </p>
            </div>
        </div>
    );
}
