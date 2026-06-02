"use client";
import Link from "next/link";

const FEATURES = [
    { icon: "📍", title: "חשיפה ללקוחות", desc: "הופיעו בחיפוש של אלפי לקוחות שמחפשים עסקים כמו שלכם באזורכם" },
    { icon: "📅", title: "הזמנות אונליין", desc: "לקוחות יכולים לקבוע תור ישירות מהפרופיל שלכם — 24/7" },
    { icon: "⭐", title: "ביקורות ודירוג", desc: "בנו אמינות עם ביקורות אמיתיות שמוצגות בפרופיל הציבורי" },
    { icon: "📊", title: "סטטיסטיקות", desc: "ראו כמה אנשים צפו בעמוד שלכם, חייגו ובקשו תורים" },
    { icon: "🖼️", title: "גלריית תמונות", desc: "העלו תמונות של עבודות, הסביבה וחווית הלקוח" },
    { icon: "🔗", title: "חיבור ל-BizControl", desc: "יש לכם מערכת ניהול? חברו אותה וקבלו את כל הכלים במקום אחד" },
];

const STEPS = [
    { n: "1", title: "צרו פרופיל", desc: "הכניסו את שם העסק, קטגוריה ותמונות" },
    { n: "2", title: "אמתו את הפרטים", desc: "נאמת שאתם הבעלים האמיתיים של העסק" },
    { n: "3", title: "קבלו לקוחות", desc: "הופיעו בחיפוש וקבלו הזמנות תורים" },
];

export default function ForBusinessPage() {
    return (
        <div dir="rtl" style={{ fontFamily: "system-ui,sans-serif", color: "#1e293b", background: "#fff" }}>

            {/* Header */}
            <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 1.5rem", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
                <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "0.85rem" }}>B</div>
                    <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "#1e293b" }}>BizFind</span>
                </Link>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    <Link href="/studio/login" style={{ color: "#7c3aed", fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}>כניסה לעסקים</Link>
                    <Link href="/studio/login" style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", padding: "0.5rem 1.1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.88rem", textDecoration: "none" }}>
                        הצטרפו בחינם
                    </Link>
                </div>
            </header>

            {/* Hero */}
            <section style={{ background: "linear-gradient(135deg,#f5f3ff 0%,#ede9fe 40%,#e0e7ff 100%)", padding: "5rem 1.5rem 4rem", textAlign: "center" }}>
                <div style={{ maxWidth: 680, margin: "0 auto" }}>
                    <div style={{ display: "inline-block", background: "rgba(124,58,237,.12)", color: "#7c3aed", fontWeight: 700, fontSize: "0.82rem", padding: "0.35rem 0.9rem", borderRadius: 20, marginBottom: "1.25rem", border: "1px solid rgba(124,58,237,.2)" }}>
                        🚀 הפלטפורמה לעסקים של ישראל
                    </div>
                    <h1 style={{ fontSize: "clamp(2rem,5vw,3.2rem)", fontWeight: 900, lineHeight: 1.25, marginBottom: "1.25rem", color: "#1e1b4b" }}>
                        הגדילו את העסק שלכם.<br />
                        <span style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>לקוחות חדשים כל יום.</span>
                    </h1>
                    <p style={{ fontSize: "1.15rem", color: "#64748b", lineHeight: 1.7, marginBottom: "2rem" }}>
                        הציגו את העסק שלכם לאלפי לקוחות שמחפשים, קבלו הזמנות תורים אונליין,
                        ונהלו את הפרופיל שלכם בקלות — ללא עלות.
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                        <Link href="/studio/login" style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", padding: "0.85rem 2rem", borderRadius: 14, fontWeight: 800, fontSize: "1rem", textDecoration: "none", boxShadow: "0 4px 20px rgba(124,58,237,.35)" }}>
                            הצטרפו בחינם ←
                        </Link>
                        <a href="#how" style={{ background: "#fff", color: "#7c3aed", padding: "0.85rem 2rem", borderRadius: 14, fontWeight: 700, fontSize: "1rem", textDecoration: "none", border: "2px solid #ede9fe" }}>
                            איך זה עובד?
                        </a>
                    </div>
                    <p style={{ color: "#94a3b8", fontSize: "0.82rem", marginTop: "1rem" }}>✅ חינמי לחלוטין · ✅ ללא כרטיס אשראי · ✅ מתחילים תוך דקות</p>
                </div>
            </section>

            {/* Stats bar */}
            <div style={{ background: "#7c3aed", padding: "1.5rem", display: "flex", justifyContent: "center", gap: "3rem", flexWrap: "wrap" }}>
                {[
                    { n: "500+", l: "עסקים בפלטפורמה" },
                    { n: "10K+", l: "חיפושים בחודש" },
                    { n: "∞", l: "צמיחה אפשרית" },
                ].map(s => (
                    <div key={s.l} style={{ textAlign: "center", color: "#fff" }}>
                        <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>{s.n}</div>
                        <div style={{ fontSize: "0.82rem", opacity: 0.85 }}>{s.l}</div>
                    </div>
                ))}
            </div>

            {/* Features */}
            <section style={{ padding: "5rem 1.5rem", background: "#fff" }}>
                <div style={{ maxWidth: 960, margin: "0 auto" }}>
                    <h2 style={{ textAlign: "center", fontSize: "clamp(1.6rem,3vw,2.2rem)", fontWeight: 900, marginBottom: "0.75rem", color: "#1e1b4b" }}>
                        כל מה שהעסק שלכם צריך
                    </h2>
                    <p style={{ textAlign: "center", color: "#64748b", marginBottom: "3rem", fontSize: "1rem" }}>
                        פרופיל מלא, הזמנות, ביקורות וסטטיסטיקות — במקום אחד
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "1.5rem" }}>
                        {FEATURES.map(f => (
                            <div key={f.title} style={{ background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 20, padding: "1.5rem" }}>
                                <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>{f.icon}</div>
                                <div style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "0.4rem", color: "#1e293b" }}>{f.title}</div>
                                <div style={{ color: "#64748b", fontSize: "0.88rem", lineHeight: 1.6 }}>{f.desc}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section id="how" style={{ padding: "5rem 1.5rem", background: "#f8faff" }}>
                <div style={{ maxWidth: 780, margin: "0 auto" }}>
                    <h2 style={{ textAlign: "center", fontSize: "clamp(1.6rem,3vw,2.2rem)", fontWeight: 900, marginBottom: "0.5rem", color: "#1e1b4b" }}>
                        מתחילים תוך 3 דקות
                    </h2>
                    <p style={{ textAlign: "center", color: "#64748b", marginBottom: "3rem" }}>פשוט ומהיר, ללא ביורוקרטיה</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", position: "relative" }}>
                        {STEPS.map((s, i) => (
                            <div key={s.n} style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
                                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "1.1rem", flexShrink: 0, boxShadow: "0 4px 12px rgba(124,58,237,.3)" }}>
                                    {s.n}
                                </div>
                                <div style={{ paddingTop: "0.6rem" }}>
                                    <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#1e293b" }}>{s.title}</div>
                                    <div style={{ color: "#64748b", fontSize: "0.88rem", marginTop: "0.2rem" }}>{s.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* BizControl upgrade banner */}
            <section style={{ padding: "4rem 1.5rem", background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}>
                <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🚀</div>
                    <h2 style={{ fontSize: "1.8rem", fontWeight: 900, color: "#fff", marginBottom: "0.75rem" }}>
                        כבר יש לכם BizControl?
                    </h2>
                    <p style={{ color: "#a5b4fc", fontSize: "1rem", lineHeight: 1.7, marginBottom: "2rem" }}>
                        חברו את המערכת וקבלו: ניהול יומן מלא, תשלומים, WhatsApp אוטומטי,
                        מועדון לקוחות, AI ועוד — הכל מסונכרן עם הפרופיל הציבורי שלכם.
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                        <a href="https://www.biz-control.com" target="_blank" rel="noopener" style={{ background: "#fff", color: "#7c3aed", padding: "0.85rem 2rem", borderRadius: 14, fontWeight: 800, fontSize: "0.95rem", textDecoration: "none" }}>
                            גלה את BizControl ←
                        </a>
                        <Link href="/studio/login" style={{ background: "transparent", color: "#a5b4fc", padding: "0.85rem 2rem", borderRadius: 14, fontWeight: 700, fontSize: "0.95rem", textDecoration: "none", border: "2px solid rgba(165,180,252,.3)" }}>
                            כניסה עם חשבון קיים
                        </Link>
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section style={{ padding: "5rem 1.5rem", background: "#fff", textAlign: "center" }}>
                <div style={{ maxWidth: 560, margin: "0 auto" }}>
                    <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "#1e1b4b", marginBottom: "1rem" }}>
                        מוכנים להתחיל?
                    </h2>
                    <p style={{ color: "#64748b", marginBottom: "2rem" }}>הצטרפו לעסקים שכבר נמצאים על המפה</p>
                    <Link href="/studio/login" style={{ display: "inline-block", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", padding: "0.95rem 2.5rem", borderRadius: 14, fontWeight: 800, fontSize: "1.05rem", textDecoration: "none", boxShadow: "0 6px 24px rgba(124,58,237,.35)" }}>
                        הצטרפו בחינם ←
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer style={{ background: "#f8faff", borderTop: "1px solid #e2e8f0", padding: "2rem 1.5rem", textAlign: "center", color: "#94a3b8", fontSize: "0.82rem" }}>
                <div style={{ marginBottom: "0.5rem", fontWeight: 700, color: "#7c3aed" }}>BizFind by BizControl</div>
                <div>© {new Date().getFullYear()} · <a href="https://www.biz-control.com" style={{ color: "#7c3aed", textDecoration: "none" }}>biz-control.com</a></div>
            </footer>
        </div>
    );
}
