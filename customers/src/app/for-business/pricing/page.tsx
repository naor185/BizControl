"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, Rocket, Zap } from "lucide-react";
import { GLASS_CARD, PRIMARY_BTN } from "@/lib/look";

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
            ...GLASS_CARD,
            border: featured ? "1.5px solid #fff" : "1px solid var(--bf-line)",
            padding: "2rem 1.5rem",
            position: "relative",
            boxShadow: featured ? "0 10px 40px rgba(255,255,255,.08)" : "none",
            display: "flex",
            flexDirection: "column" as const,
        }}>
            {tier.badge && (
                <div style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", background: "#fff", color: "#000", fontWeight: 800, fontSize: "0.75rem", padding: "0.25rem 0.8rem", borderRadius: 20 }}>
                    {tier.badge}
                </div>
            )}
            <div style={{ fontWeight: 800, fontSize: "1.2rem", color: "var(--bf-text)", marginBottom: "0.35rem" }}>{tier.label}</div>
            <div style={{ marginBottom: "1.25rem" }}>
                <span style={{ fontSize: "2.2rem", fontWeight: 900, color: "var(--bf-text)", fontVariantNumeric: "tabular-nums" }}>₪{tier.price}</span>
                <span style={{ fontSize: "0.85rem", color: "var(--bf-faint)", marginRight: "0.3rem" }}>/ חודש</span>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem", flex: 1 }}>
                {tier.features.map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.88rem", color: "var(--bf-muted)", marginBottom: "0.55rem" }}>
                        <Check size={15} color="#fff" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden /> {f}
                    </li>
                ))}
            </ul>
            <Link
                href={`/for-business/register?plan=${tier.key}`}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.2rem",
                    background: featured ? "#fff" : "var(--bf-glass)",
                    color: featured ? "#000" : "var(--bf-text)",
                    border: featured ? "none" : "1px solid var(--bf-line)",
                    padding: "0.75rem",
                    borderRadius: 12,
                    fontWeight: 800,
                    fontSize: "0.9rem",
                    textDecoration: "none",
                    transition: "opacity .15s",
                }}
            >
                התחילו עכשיו <ChevronLeft size={16} aria-hidden />
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
        <div dir="rtl" style={{ color: "var(--bf-text)", background: "var(--bf-bg)", minHeight: "100vh" }}>

            {/* Header */}
            <header style={{ background: "rgba(0,0,0,.85)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--bf-line)", padding: "0 1.5rem", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
                <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <img src="/logo.png" alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                    <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--bf-text)" }}>BizFind</span>
                </Link>
                <Link href="/studio/login" style={{ color: "var(--bf-muted)", fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}>כניסה לעסקים</Link>
            </header>

            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "4rem 1.5rem" }}>

                {/* Hero */}
                <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
                    <h1 style={{ fontSize: "clamp(2rem,4vw,2.8rem)", fontWeight: 900, color: "var(--bf-text)", marginBottom: "0.75rem" }}>
                        בחרו את התוכנית המתאימה לכם
                    </h1>
                    <p style={{ fontSize: "1.05rem", color: "var(--bf-muted)", maxWidth: 560, margin: "0 auto 1.5rem" }}>
                        כל התוכניות כוללות {trialDays} יום ניסיון חינמי. ללא כרטיס אשראי.
                    </p>

                    {/* Trial banner */}
                    <Link href="/for-business/register?plan=trial" style={{
                        ...PRIMARY_BTN, display: "inline-flex", padding: "0.9rem 2rem", fontSize: "1rem",
                    }}>
                        <Rocket size={18} aria-hidden /> התחילו ניסיון חינמי {trialDays} יום <ChevronLeft size={18} aria-hidden />
                    </Link>
                    <p style={{ color: "var(--bf-faint)", fontSize: "0.8rem", marginTop: "0.6rem", display: "flex", gap: "0.9rem", justifyContent: "center", flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><Check size={13} aria-hidden /> ללא כרטיס אשראי</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><Check size={13} aria-hidden /> מבטלים מתי שרוצים</span>
                    </p>
                </div>

                {/* ── Plans ── */}
                <div style={{ marginBottom: "4rem" }}>
                    <div style={{ ...GLASS_CARD, borderRadius: 16, padding: "1.25rem 1.5rem", marginBottom: "1.75rem", maxWidth: 640, marginInline: "auto" }}>
                        <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--bf-text)", marginBottom: "0.3rem", display: "flex", alignItems: "center", gap: "0.35rem" }}><Zap size={18} aria-hidden /> BizFind + BizControl</div>
                        <div style={{ fontSize: "0.88rem", color: "var(--bf-muted)" }}>
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
                <div style={{ ...GLASS_CARD, maxWidth: 640, margin: "0 auto", padding: "2rem" }}>
                    <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "1.5rem", color: "var(--bf-text)" }}>שאלות נפוצות</h2>
                    {[
                        ["האם ניסיון חינמי כולל גם BizControl?", `כן! הניסיון של ${trialDays} יום כולל גישה מלאה לכל הפיצ׳רים, כולל מערכת הניהול של BizControl.`],
                        ["מה קורה בסוף הניסיון?", "תקבלו התראה 7 ו-3 ימים לפני הסיום. יש לבחור תוכנית ולשדרג לפני שהניסיון מסתיים — אחרת הגישה למערכת נחסמת עד לשדרוג."],
                        ["האם הנתונים משותפים בין BizFind ל-BizControl?", "כן. שתי הפלטפורמות עובדות על אותה מערכת — נרשמים פעם אחת, הנתונים זמינים בכל מקום."],
                        ["אפשר לשדרג בכל שלב?", "בהחלט. שדרוג פועל באופן מיידי ואתם משלמים רק על ההפרש."],
                    ].map(([q, a]) => (
                        <div key={q} style={{ borderBottom: "1px solid var(--bf-line)", paddingBottom: "1rem", marginBottom: "1rem" }}>
                            <div style={{ fontWeight: 700, color: "var(--bf-text)", marginBottom: "0.3rem", fontSize: "0.92rem" }}>{q}</div>
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.88rem", lineHeight: 1.6 }}>{a}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
