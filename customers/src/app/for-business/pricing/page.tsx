"use client";
import Link from "next/link";

const PLANS = [
    {
        key: "trial",
        label: "ניסיון חינמי",
        price: null,
        priceNote: "14 יום חינם",
        badge: null,
        color: "#7c3aed",
        features: ["כל הפיצ׳רים של Pro", "ללא כרטיס אשראי", "מבטלים מתי שרוצים"],
        cta: "התחילו חינם",
        scope: "both",
    },
];

const BIZFIND_TIERS = [
    {
        key: "bizfind_basic",
        label: "Basic",
        price: 99,
        badge: null,
        features: [
            "כרטיס עסק בפלטפורמה",
            "הופעה בחיפוש",
            "קבלת לידים ותורים",
            "גלריית תמונות",
            "עד 50 תורים/חודש",
        ],
    },
    {
        key: "bizfind_pro",
        label: "Pro",
        price: 179,
        badge: "הכי פופולרי",
        features: [
            "כל הפיצ׳רים של Basic",
            "תורים ללא הגבלה",
            "ביקורות ודירוג",
            "סטטיסטיקות מתקדמות",
            "תמיכה מועדפת",
        ],
    },
];

const BIZCONTROL_TIERS = [
    {
        key: "starter",
        label: "Starter",
        price: 199,
        badge: null,
        features: [
            "כל פיצ׳רי BizFind Pro",
            "יומן + ניהול תורים",
            "CRM לקוחות",
            "תשלומים",
            "עד 2 אמנים",
        ],
    },
    {
        key: "pro",
        label: "Pro",
        price: 349,
        badge: "הכי פופולרי",
        features: [
            "כל פיצ׳רי Starter",
            "עד 5 אמנים",
            "AI הודעות",
            "אנליטיקה מלאה",
            "תזכורות אוטומטיות",
        ],
    },
    {
        key: "studio",
        label: "Studio",
        price: 499,
        badge: null,
        features: [
            "כל פיצ׳רי Pro",
            "אמנים ללא הגבלה",
            "דף הזמנה עצמית",
            "ייצוא Excel",
            "תמיכה מועדפת",
        ],
    },
];

function PlanCard({
    tier,
    scope,
    featured,
}: {
    tier: { key: string; label: string; price: number; badge: string | null; features: string[] };
    scope: "bizfind" | "bizcontrol";
    featured?: boolean;
}) {
    return (
        <div style={{
            border: featured ? "2.5px solid #7c3aed" : "1.5px solid #e2e8f0",
            borderRadius: 20,
            padding: "2rem 1.5rem",
            background: "#fff",
            position: "relative",
            boxShadow: featured ? "0 8px 40px rgba(124,58,237,.18)" : "0 2px 12px rgba(0,0,0,.05)",
            display: "flex",
            flexDirection: "column" as const,
        }}>
            {tier.badge && (
                <div style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", background: "#7c3aed", color: "#fff", fontWeight: 800, fontSize: "0.75rem", padding: "0.25rem 0.8rem", borderRadius: 20 }}>
                    {tier.badge}
                </div>
            )}
            <div style={{ fontWeight: 900, fontSize: "1.2rem", color: "#1e1b4b", marginBottom: "0.35rem" }}>{tier.label}</div>
            <div style={{ marginBottom: "1.25rem" }}>
                <span style={{ fontSize: "2.2rem", fontWeight: 900, color: "#1e1b4b" }}>₪{tier.price}</span>
                <span style={{ fontSize: "0.85rem", color: "#94a3b8", marginRight: "0.3rem" }}>/ חודש</span>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem", flex: 1 }}>
                {tier.features.map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.88rem", color: "#374151", marginBottom: "0.55rem" }}>
                        <span style={{ color: "#7c3aed", fontWeight: 700, marginTop: "0.05rem" }}>✓</span> {f}
                    </li>
                ))}
            </ul>
            <Link
                href={`/for-business/register?plan=${tier.key}`}
                style={{
                    display: "block",
                    textAlign: "center",
                    background: featured ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "#f8fafc",
                    color: featured ? "#fff" : "#7c3aed",
                    border: featured ? "none" : "1.5px solid #ede9fe",
                    padding: "0.75rem",
                    borderRadius: 12,
                    fontWeight: 800,
                    fontSize: "0.9rem",
                    textDecoration: "none",
                    transition: "opacity .15s",
                }}
            >
                התחילו עכשיו ←
            </Link>
        </div>
    );
}

export default function PricingPage() {
    return (
        <div dir="rtl" style={{ fontFamily: "system-ui,sans-serif", color: "#1e293b", background: "#fafafa", minHeight: "100vh" }}>

            {/* Header */}
            <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 1.5rem", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
                <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "0.85rem" }}>B</div>
                    <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "#1e1b4b" }}>BizFind</span>
                </Link>
                <Link href="/studio/login" style={{ color: "#7c3aed", fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}>כניסה לעסקים</Link>
            </header>

            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "4rem 1.5rem" }}>

                {/* Hero */}
                <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
                    <h1 style={{ fontSize: "clamp(2rem,4vw,2.8rem)", fontWeight: 900, color: "#1e1b4b", marginBottom: "0.75rem" }}>
                        בחרו את התוכנית המתאימה לכם
                    </h1>
                    <p style={{ fontSize: "1.05rem", color: "#64748b", maxWidth: 560, margin: "0 auto 1.5rem" }}>
                        כל התוכניות כוללות 14 יום ניסיון חינמי. ללא כרטיס אשראי.
                    </p>

                    {/* Trial banner */}
                    <Link href="/for-business/register?plan=trial" style={{
                        display: "inline-flex", alignItems: "center", gap: "0.6rem",
                        background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                        color: "#fff", padding: "0.9rem 2rem", borderRadius: 14,
                        fontWeight: 800, fontSize: "1rem", textDecoration: "none",
                        boxShadow: "0 4px 20px rgba(124,58,237,.35)",
                    }}>
                        🚀 התחילו ניסיון חינמי 14 יום ←
                    </Link>
                    <p style={{ color: "#94a3b8", fontSize: "0.8rem", marginTop: "0.6rem" }}>✅ ללא כרטיס אשראי &nbsp;·&nbsp; ✅ מבטלים מתי שרוצים</p>
                </div>

                {/* ── Scope tabs ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.5rem", marginBottom: "4rem" }}>

                    {/* BizFind only */}
                    <div>
                        <div style={{ background: "#f5f3ff", border: "1.5px solid #ede9fe", borderRadius: 16, padding: "1.25rem 1.5rem", marginBottom: "1.25rem" }}>
                            <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "#7c3aed", marginBottom: "0.3rem" }}>📍 BizFind בלבד</div>
                            <div style={{ fontSize: "0.88rem", color: "#64748b" }}>
                                כרטיס עסק, הופעה בחיפוש, קבלת תורים ולידים — ללא מערכת ניהול.
                            </div>
                        </div>
                        <div style={{ display: "grid", gap: "1rem" }}>
                            {BIZFIND_TIERS.map(t => (
                                <PlanCard key={t.key} tier={t} scope="bizfind" featured={t.badge !== null} />
                            ))}
                        </div>
                    </div>

                    {/* BizFind + BizControl */}
                    <div>
                        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 16, padding: "1.25rem 1.5rem", marginBottom: "1.25rem" }}>
                            <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "#16a34a", marginBottom: "0.3rem" }}>⚡ BizFind + BizControl</div>
                            <div style={{ fontSize: "0.88rem", color: "#64748b" }}>
                                כל יכולות BizFind + מערכת ניהול מלאה: יומן, CRM, קופה, חשבוניות ואוטומציות.
                            </div>
                        </div>
                        <div style={{ display: "grid", gap: "1rem" }}>
                            {BIZCONTROL_TIERS.map(t => (
                                <PlanCard key={t.key} tier={t} scope="bizcontrol" featured={t.badge !== null} />
                            ))}
                        </div>
                    </div>
                </div>

                {/* FAQ */}
                <div style={{ maxWidth: 640, margin: "0 auto", background: "#fff", borderRadius: 20, border: "1px solid #e2e8f0", padding: "2rem" }}>
                    <h2 style={{ fontWeight: 900, fontSize: "1.2rem", marginBottom: "1.5rem", color: "#1e1b4b" }}>שאלות נפוצות</h2>
                    {[
                        ["האם ניסיון חינמי כולל גם BizControl?", "כן! הניסיון של 14 יום כולל גישה מלאה לכל הפיצ׳רים, כולל מערכת הניהול של BizControl."],
                        ["מה קורה בסוף הניסיון?", "תקבלו התראה 3 ימים לפני הסיום. תוכלו לבחור תוכנית מתאימה — אחרת העסק יישאר בפלטפורמה במצב בסיסי."],
                        ["האם הנתונים משותפים בין BizFind ל-BizControl?", "כן. שתי הפלטפורמות עובדות על אותה מערכת — נרשמים פעם אחת, הנתונים זמינים בכל מקום."],
                        ["אפשר לשדרג בכל שלב?", "בהחלט. שדרוג פועל באופן מיידי ואתם משלמים רק על ההפרש."],
                    ].map(([q, a]) => (
                        <div key={q} style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: "1rem", marginBottom: "1rem" }}>
                            <div style={{ fontWeight: 700, color: "#1e1b4b", marginBottom: "0.3rem", fontSize: "0.92rem" }}>{q}</div>
                            <div style={{ color: "#64748b", fontSize: "0.88rem", lineHeight: 1.6 }}>{a}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
