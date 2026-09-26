import { Mail } from "lucide-react";

export const metadata = { title: "תמיכה — BizFind & BizControl" };

const sectionStyle: React.CSSProperties = { marginBottom: "1.75rem" };
const h2Style: React.CSSProperties = { fontSize: "1.15rem", fontWeight: 800, color: "var(--bf-text)", marginBottom: "0.6rem" };
const pStyle: React.CSSProperties = { color: "var(--bf-muted)", fontSize: "0.95rem", lineHeight: 1.75, marginBottom: "0.5rem" };
const cardStyle: React.CSSProperties = {
    background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 16, padding: "1.5rem", marginBottom: "1.25rem",
};

export default function SupportPage() {
    return (
        <div style={{ minHeight: "100vh", background: "var(--bf-bg)", color: "var(--bf-text)", direction: "rtl" }}>
            <div style={{ maxWidth: 640, margin: "0 auto", padding: "3rem 1.5rem" }}>
                <h1 style={{ fontSize: "1.8rem", fontWeight: 900, color: "var(--bf-text)", marginBottom: "0.3rem" }}>תמיכה</h1>
                <p style={{ color: "var(--bf-faint)", fontSize: "0.9rem", marginBottom: "2.5rem" }}>
                    עזרה לבעלי עסקים ב-BizControl וללקוחות המשתמשים ב-BizFind
                </p>

                <div style={cardStyle}>
                    <h2 style={{ ...h2Style, display: "flex", alignItems: "center", gap: "0.4rem" }}><Mail size={18} aria-hidden /> יצירת קשר</h2>
                    <p style={pStyle}>
                        לכל שאלה, תקלה או בקשת עזרה — נשמח לעזור:{" "}
                        <a href="mailto:support@biz-control.com" style={{ color: "var(--bf-text)", fontWeight: 700, textUnderlineOffset: 3 }}>
                            support@biz-control.com
                        </a>
                    </p>
                    <p style={{ ...pStyle, marginBottom: 0 }}>אנחנו משתדלים להשיב תוך יום עסקים אחד.</p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>אני בעל/ת עסק ב-BizControl</h2>
                    <p style={pStyle}>
                        בתוך המערכת עצמה יש מרכז עזרה מלא עם מדריכים לפי נושא — זמין לאחר התחברות דרך תפריט הניווט
                        ("מרכז עזרה"). אם אתם נתקלים בבעיה טכנית ספציפית, המייל למעלה הוא הדרך המהירה ביותר להגיע אלינו.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>אני לקוח/ה שקבעתי תור דרך BizFind</h2>
                    <p style={pStyle}>
                        לשינוי או ביטול תור — הדרך המהירה ביותר היא לפנות ישירות לעסק שאצלו קבעתם (פרטי הקשר שלו מופיעים
                        בעמוד העסק ב-BizFind). לבעיה טכנית באפליקציה עצמה — נשמח שתכתבו לנו למייל למעלה.
                    </p>
                </div>

                <p style={{ ...pStyle, marginTop: "2rem", fontSize: "0.85rem" }}>
                    ראו גם את <a href="/terms" style={{ color: "var(--bf-text)", textUnderlineOffset: 3 }}>תנאי השימוש</a> ואת{" "}
                    <a href="/privacy" style={{ color: "var(--bf-text)", textUnderlineOffset: 3 }}>מדיניות הפרטיות</a> שלנו.
                </p>
            </div>
        </div>
    );
}
