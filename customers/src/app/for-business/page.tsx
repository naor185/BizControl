"use client";
import Link from "next/link";
import { BarChart3, CalendarDays, Check, ChevronLeft, Images, Link2, MapPin, Rocket, Star, type LucideIcon } from "lucide-react";
import { GLASS_CARD, PRIMARY_BTN } from "@/lib/look";

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
    { icon: MapPin,       title: "חשיפה ללקוחות", desc: "הופיעו בחיפוש של אלפי לקוחות שמחפשים עסקים כמו שלכם באזורכם" },
    { icon: CalendarDays, title: "הזמנות אונליין", desc: "לקוחות יכולים לקבוע תור ישירות מהפרופיל שלכם — 24/7" },
    { icon: Star,         title: "ביקורות ודירוג", desc: "בנו אמינות עם ביקורות אמיתיות שמוצגות בפרופיל הציבורי" },
    { icon: BarChart3,    title: "סטטיסטיקות", desc: "ראו כמה אנשים צפו בעמוד שלכם, חייגו ובקשו תורים" },
    { icon: Images,       title: "גלריית תמונות", desc: "העלו תמונות של עבודות, הסביבה וחווית הלקוח" },
    { icon: Link2,        title: "חיבור ל-BizControl", desc: "יש לכם מערכת ניהול? חברו אותה וקבלו את כל הכלים במקום אחד" },
];

const STEPS = [
    { n: "1", title: "צרו פרופיל", desc: "הכניסו את שם העסק, קטגוריה ותמונות" },
    { n: "2", title: "אמתו את הפרטים", desc: "נאמת שאתם הבעלים האמיתיים של העסק" },
    { n: "3", title: "קבלו לקוחות", desc: "הופיעו בחיפוש וקבלו הזמנות תורים" },
];

export default function ForBusinessPage() {
    return (
        <div dir="rtl" style={{ color: "var(--bf-text)", background: "var(--bf-bg)" }}>

            {/* Header */}
            <header style={{ background: "rgba(0,0,0,.85)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--bf-line)", padding: "0 1.5rem", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
                <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <img src="/logo.png" alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                    <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--bf-text)" }}>BizFind</span>
                </Link>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    <Link href="/studio/login" style={{ color: "var(--bf-muted)", fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}>כניסה לעסקים</Link>
                    <Link href="/for-business/register?plan=trial" style={{ background: "#fff", color: "#000", padding: "0.5rem 1.1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.88rem", textDecoration: "none" }}>
                        הצטרפו בחינם
                    </Link>
                </div>
            </header>

            {/* Hero */}
            <section style={{ background: "radial-gradient(ellipse at 50% 0%, #262626 0%, #000 70%)", padding: "5rem 1.5rem 4rem", textAlign: "center" }}>
                <div style={{ maxWidth: 680, margin: "0 auto" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", background: "var(--bf-glass)", color: "var(--bf-text)", fontWeight: 700, fontSize: "0.82rem", padding: "0.35rem 0.9rem", borderRadius: 20, marginBottom: "1.25rem", border: "1px solid var(--bf-line)" }}>
                        <Rocket size={14} aria-hidden /> הפלטפורמה לעסקים של ישראל
                    </div>
                    <h1 style={{ fontSize: "clamp(2rem,5vw,3.2rem)", fontWeight: 900, lineHeight: 1.25, marginBottom: "1.25rem" }}>
                        <span style={{ color: "rgba(255,255,255,.72)" }}>הגדילו את העסק שלכם.</span><br />
                        לקוחות חדשים כל יום.
                    </h1>
                    <p style={{ fontSize: "1.1rem", color: "var(--bf-muted)", lineHeight: 1.7, marginBottom: "2rem" }}>
                        הציגו את העסק שלכם לאלפי לקוחות שמחפשים, קבלו הזמנות תורים אונליין,
                        ונהלו את הפרופיל שלכם בקלות — ללא עלות.
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                        <Link href="/for-business/register?plan=trial" style={{ ...PRIMARY_BTN, padding: "0.85rem 2rem", fontSize: "1rem" }}>
                            הצטרפו בחינם <ChevronLeft size={18} aria-hidden />
                        </Link>
                        <a href="#how" style={{ display: "flex", alignItems: "center", background: "var(--bf-glass)", color: "var(--bf-text)", padding: "0.85rem 2rem", borderRadius: 14, fontWeight: 700, fontSize: "1rem", textDecoration: "none", border: "1px solid var(--bf-line)" }}>
                            איך זה עובד?
                        </a>
                    </div>
                    <p style={{ color: "var(--bf-faint)", fontSize: "0.82rem", marginTop: "1rem", display: "flex", gap: "0.9rem", justifyContent: "center", flexWrap: "wrap" }}>
                        {["חינמי לחלוטין", "ללא כרטיס אשראי", "מתחילים תוך דקות"].map(t => (
                            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><Check size={13} aria-hidden /> {t}</span>
                        ))}
                    </p>
                </div>
            </section>

            {/* Stats bar */}
            <div style={{ borderTop: "1px solid var(--bf-line)", borderBottom: "1px solid var(--bf-line)", padding: "1.5rem", display: "flex", justifyContent: "center", gap: "3rem", flexWrap: "wrap" }}>
                {[
                    { n: "500+", l: "עסקים בפלטפורמה" },
                    { n: "10K+", l: "חיפושים בחודש" },
                    { n: "∞", l: "צמיחה אפשרית" },
                ].map(s => (
                    <div key={s.l} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>{s.n}</div>
                        <div style={{ fontSize: "0.82rem", color: "var(--bf-muted)" }}>{s.l}</div>
                    </div>
                ))}
            </div>

            {/* Features */}
            <section style={{ padding: "5rem 1.5rem" }}>
                <div style={{ maxWidth: 960, margin: "0 auto" }}>
                    <h2 style={{ textAlign: "center", fontSize: "clamp(1.6rem,3vw,2.2rem)", fontWeight: 900, marginBottom: "0.75rem" }}>
                        כל מה שהעסק שלכם צריך
                    </h2>
                    <p style={{ textAlign: "center", color: "var(--bf-muted)", marginBottom: "3rem", fontSize: "1rem" }}>
                        פרופיל מלא, הזמנות, ביקורות וסטטיסטיקות — במקום אחד
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "1.25rem" }}>
                        {FEATURES.map(f => {
                            const Icon = f.icon;
                            return (
                                <div key={f.title} style={{ ...GLASS_CARD, padding: "1.5rem" }}>
                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "#fff", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.9rem" }}><Icon size={22} aria-hidden /></div>
                                    <div style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "0.4rem" }}>{f.title}</div>
                                    <div style={{ color: "var(--bf-muted)", fontSize: "0.88rem", lineHeight: 1.6 }}>{f.desc}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section id="how" style={{ padding: "5rem 1.5rem", borderTop: "1px solid var(--bf-line)" }}>
                <div style={{ maxWidth: 780, margin: "0 auto" }}>
                    <h2 style={{ textAlign: "center", fontSize: "clamp(1.6rem,3vw,2.2rem)", fontWeight: 900, marginBottom: "0.5rem" }}>
                        מתחילים תוך 3 דקות
                    </h2>
                    <p style={{ textAlign: "center", color: "var(--bf-muted)", marginBottom: "3rem" }}>פשוט ומהיר, ללא ביורוקרטיה</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                        {STEPS.map(s => (
                            <div key={s.n} style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
                                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#000", fontWeight: 900, fontSize: "1.1rem", flexShrink: 0 }}>
                                    {s.n}
                                </div>
                                <div style={{ paddingTop: "0.6rem" }}>
                                    <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{s.title}</div>
                                    <div style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginTop: "0.2rem" }}>{s.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* BizControl upgrade banner */}
            <section style={{ padding: "4rem 1.5rem" }}>
                <div style={{ ...GLASS_CARD, borderRadius: 28, maxWidth: 760, margin: "0 auto", textAlign: "center", padding: "3rem 1.5rem" }}>
                    <Rocket size={40} strokeWidth={1.5} aria-hidden style={{ marginBottom: "1rem" }} />
                    <h2 style={{ fontSize: "1.8rem", fontWeight: 900, marginBottom: "0.75rem" }}>
                        כבר יש לכם BizControl?
                    </h2>
                    <p style={{ color: "var(--bf-muted)", fontSize: "1rem", lineHeight: 1.7, marginBottom: "2rem" }}>
                        חברו את המערכת וקבלו: ניהול יומן מלא, תשלומים, WhatsApp אוטומטי,
                        מועדון לקוחות, AI ועוד — הכל מסונכרן עם הפרופיל הציבורי שלכם.
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                        <a href="https://www.biz-control.com" target="_blank" rel="noopener" style={{ ...PRIMARY_BTN, padding: "0.85rem 2rem", fontSize: "0.95rem" }}>
                            גלה את BizControl <ChevronLeft size={17} aria-hidden />
                        </a>
                        <Link href="/studio/login" style={{ display: "flex", alignItems: "center", background: "transparent", color: "var(--bf-text)", padding: "0.85rem 2rem", borderRadius: 14, fontWeight: 700, fontSize: "0.95rem", textDecoration: "none", border: "1px solid rgba(255,255,255,.3)" }}>
                            כניסה עם חשבון קיים
                        </Link>
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section style={{ padding: "4rem 1.5rem 5rem", textAlign: "center" }}>
                <div style={{ maxWidth: 560, margin: "0 auto" }}>
                    <h2 style={{ fontSize: "2rem", fontWeight: 900, marginBottom: "1rem" }}>
                        מוכנים להתחיל?
                    </h2>
                    <p style={{ color: "var(--bf-muted)", marginBottom: "2rem" }}>הצטרפו לעסקים שכבר נמצאים על המפה</p>
                    <Link href="/for-business/register?plan=trial" style={{ ...PRIMARY_BTN, display: "inline-flex", padding: "0.95rem 2.5rem", fontSize: "1.05rem" }}>
                        הצטרפו בחינם <ChevronLeft size={18} aria-hidden />
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer style={{ borderTop: "1px solid var(--bf-line)", padding: "2rem 1.5rem", textAlign: "center", color: "var(--bf-faint)", fontSize: "0.82rem" }}>
                <div style={{ marginBottom: "0.5rem", fontWeight: 700, color: "var(--bf-text)" }}>BizFind by BizControl</div>
                <div>© {new Date().getFullYear()} · <a href="https://www.biz-control.com" style={{ color: "var(--bf-muted)", textDecoration: "none" }}>biz-control.com</a></div>
            </footer>
        </div>
    );
}
