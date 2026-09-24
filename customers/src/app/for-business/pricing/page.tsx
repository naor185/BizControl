"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

// Hand-written marketing bullets, keyed by plan id — kept separate from
// price, which now comes from the real plans table (GET /api/marketplace/
// plans) below. This page used to hardcode its own price copy independent
// of the Plan Management Center (a third disconnected source, alongside
// the ones already unified in the backend) — an admin's price change here
// would never have shown up on the page a prospect actually sees.
const BIZCONTROL_FEATURES: Record<string, string[]> = {
    starter: ["כל פיצ׳רי BizFind Pro", "יומן + ניהול תורים", "CRM לקוחות", "תשלומים", "עד 2 אנשי צוות"],
    pro: ["כל פיצ׳רי Starter", "עד 5 אנשי צוות", "AI הודעות", "אנליטיקה מלאה", "תזכורות אוטומטיות"],
    studio: ["כל פיצ׳רי Pro", "אנשי צוות ללא הגבלה", "דף הזמנה עצמית", "ייצוא Excel", "תמיכה מועדפת"],
};
const BIZCONTROL_BADGE: Record<string, string | null> = { starter: null, pro: "הכי פופולרי", studio: null };

type ApiPlan = { key: string; label: string; price_ils: number; days: number; is_trial: boolean; scope_bizcontrol: boolean };

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
    const [tiers, setTiers] = useState<{ key: string; label: string; price: number; badge: string | null; features: string[] }[]>([]);
    const [trialDays, setTrialDays] = useState(30);

    useEffect(() => {
        fetch(`${API}/api/marketplace/plans`)
            .then(r => r.json())
            .then((data: ApiPlan[]) => {
                const trial = data.find(p => p.is_trial);
                if (trial) setTrialDays(trial.days);
                setTiers(
                    data
                        .filter(p => !p.is_trial && p.scope_bizcontrol)
                        .map(p => ({
                            key: p.key,
                            label: p.label,
                            price: p.price_ils,
                            badge: BIZCONTROL_BADGE[p.key] ?? null,
                            features: BIZCONTROL_FEATURES[p.key] ?? [],
                        }))
                );
            })
            .catch(() => {});
    }, []);

    return (
        <div dir="rtl" style={{ color: "#1e293b", background: "#fafafa", minHeight: "100vh" }}>

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
                        כל התוכניות כוללות {trialDays} יום ניסיון חינמי. ללא כרטיס אשראי.
                    </p>

                    {/* Trial banner */}
                    <Link href="/for-business/register?plan=trial" style={{
                        display: "inline-flex", alignItems: "center", gap: "0.6rem",
                        background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                        color: "#fff", padding: "0.9rem 2rem", borderRadius: 14,
                        fontWeight: 800, fontSize: "1rem", textDecoration: "none",
                        boxShadow: "0 4px 20px rgba(124,58,237,.35)",
                    }}>
                        🚀 התחילו ניסיון חינמי {trialDays} יום ←
                    </Link>
                    <p style={{ color: "#94a3b8", fontSize: "0.8rem", marginTop: "0.6rem" }}>✅ ללא כרטיס אשראי &nbsp;·&nbsp; ✅ מבטלים מתי שרוצים</p>
                </div>

                {/* ── Plans ── */}
                <div style={{ marginBottom: "4rem" }}>
                    <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 16, padding: "1.25rem 1.5rem", marginBottom: "1.25rem", maxWidth: 640, marginInline: "auto" }}>
                        <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "#16a34a", marginBottom: "0.3rem" }}>⚡ BizFind + BizControl</div>
                        <div style={{ fontSize: "0.88rem", color: "#64748b" }}>
                            כל תוכנית כוללת הופעה בחיפוש BizFind + מערכת ניהול מלאה: יומן, CRM, קופה, חשבוניות ואוטומציות.
                        </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem", maxWidth: 1000, marginInline: "auto" }}>
                        {tiers.map(t => (
                            <PlanCard key={t.key} tier={t} scope="bizcontrol" featured={t.badge !== null} />
                        ))}
                    </div>
                </div>

                {/* FAQ */}
                <div style={{ maxWidth: 640, margin: "0 auto", background: "#fff", borderRadius: 20, border: "1px solid #e2e8f0", padding: "2rem" }}>
                    <h2 style={{ fontWeight: 900, fontSize: "1.2rem", marginBottom: "1.5rem", color: "#1e1b4b" }}>שאלות נפוצות</h2>
                    {[
                        ["האם ניסיון חינמי כולל גם BizControl?", `כן! הניסיון של ${trialDays} יום כולל גישה מלאה לכל הפיצ׳רים, כולל מערכת הניהול של BizControl.`],
                        ["מה קורה בסוף הניסיון?", "תקבלו התראה 7 ו-3 ימים לפני הסיום. יש לבחור תוכנית ולשדרג לפני שהניסיון מסתיים — אחרת הגישה למערכת נחסמת עד לשדרוג."],
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
