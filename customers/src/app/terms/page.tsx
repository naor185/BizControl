export const metadata = { title: "תנאי שימוש — BizFind & BizControl" };

const sectionStyle: React.CSSProperties = { marginBottom: "1.75rem" };
const h2Style: React.CSSProperties = { fontSize: "1.15rem", fontWeight: 800, color: "#1e1b4b", marginBottom: "0.6rem" };
const pStyle: React.CSSProperties = { color: "#475569", fontSize: "0.95rem", lineHeight: 1.75, marginBottom: "0.5rem" };
const ulStyle: React.CSSProperties = { color: "#475569", fontSize: "0.95rem", lineHeight: 1.75, paddingRight: "1.25rem", marginBottom: "0.5rem" };

export default function TermsPage() {
    return (
        <div style={{ minHeight: "100vh", background: "#faf5ff", direction: "rtl" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem" }}>
                <h1 style={{ fontSize: "1.8rem", fontWeight: 900, color: "#1e1b4b", marginBottom: "0.3rem" }}>תנאי שימוש</h1>
                <p style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "2.5rem" }}>עודכן לאחרונה: אוגוסט 2026</p>

                <div style={sectionStyle}>
                    <p style={pStyle}>
                        תנאים אלה חלים על השימוש בפלטפורמת <strong>BizControl</strong> (מערכת ניהול לעסקי סטודיו) ובפלטפורמת
                        <strong> BizFind</strong> (מרקטפלייס ציבורי למציאת וקביעת תורים אצל עסקים), יחד ולחוד "השירות" או
                        "הפלטפורמה". שימוש בשירות — כבעל/ת עסק, כאיש/אשת צוות, או כלקוח/ה — מהווה הסכמה לתנאים אלה.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>1. מי יכול להשתמש בשירות</h2>
                    <p style={pStyle}>
                        השירות מיועד למי שגילו/ה 18 ומעלה, או למי שפועל/ת בשם עסק רשום כדין. בעל/ת עסק הנרשמ/ת ל-BizControl
                        מצהיר/ה שהוא/היא מוסמכ/ת לפעול בשם העסק ולהעלות אליו נתוני לקוחות.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>2. חשבון ואחריות</h2>
                    <ul style={ulStyle}>
                        <li>אתם אחראים לשמירת סודיות פרטי ההתחברות שלכם ולכל פעילות המתבצעת דרך החשבון שלכם.</li>
                        <li>בעל/ת עסק אחראי/ת לדיוק, לחוקיות ולהרשאה לעיבוד כל נתון שהוא/היא מזין/ה למערכת אודות לקוחותיו/ה.</li>
                        <li>המערכת שומרת בידוד מלא בין נתוני עסקים שונים — כל עסק רואה אך ורק את הנתונים שלו.</li>
                    </ul>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>3. מנוי ותשלום</h2>
                    <p style={pStyle}>
                        חלק מהתכניות במערכת הן בתשלום, בחיוב חוזר (חודשי/שנתי) המתבצע דרך ספק סליקה חיצוני מאובטח (Stripe).
                        ניתן לבטל מנוי בכל עת דרך עמוד "מנוי ותשלום" באפליקציה; הביטול ייכנס לתוקף בסוף מחזור החיוב הנוכחי.
                        המחירים המוצגים באפליקציה הם המחייבים, וכפופים לעדכון מעת לעת עם הודעה מראש ללקוחות קיימים.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>4. שימוש מותר</h2>
                    <p style={pStyle}>אין להשתמש בשירות כדי:</p>
                    <ul style={ulStyle}>
                        <li>לשלוח הודעות ספאם, תוכן פוגעני, מטעה או בלתי חוקי ללקוחות דרך ערוצי ההודעות (WhatsApp/מייל).</li>
                        <li>לנסות לעקוף את בידוד הנתונים בין עסקים, או לגשת לנתונים שאינם שייכים לעסק שלכם.</li>
                        <li>להעמיס באופן מכוון על תשתיות המערכת (למשל בקשות אוטומטיות מוגזמות).</li>
                    </ul>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>5. תוכן ובינה מלאכותית</h2>
                    <p style={pStyle}>
                        חלק מהיכולות במערכת (כגון סריקת חשבוניות אוטומטית ועוזר ה-AI "ויקי") משתמשות בשירותי בינה מלאכותית
                        של צדדים שלישיים. תוצאות אוטומטיות עלולות להכיל טעויות — האחריות לבדוק ולאשר נתונים כספיים או
                        תוכן שנוצר אוטומטית חלה על המשתמש/ת.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>6. הגבלת אחריות</h2>
                    <p style={pStyle}>
                        השירות ניתן "כפי שהוא" (AS IS). איננו מתחייבים לזמינות רציפה ללא הפרעות, ואיננו אחראים לנזק עקיף
                        שייגרם כתוצאה משימוש בשירות, כולל אך לא רק אובדן הכנסה, נתונים, או לקוחות, למעט במקרים של רשלנות
                        חמורה או זדון מצדנו.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>7. סיום שימוש</h2>
                    <p style={pStyle}>
                        אנו רשאים להשעות או לסיים גישה לחשבון שמפר תנאים אלה. בעל/ת עסק רשאי/ת לבקש מחיקת חשבון וסגירת
                        המנוי בכל עת בפנייה אלינו.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>8. שינויים בתנאים</h2>
                    <p style={pStyle}>
                        ייתכן שנעדכן תנאים אלה מעת לעת. שימוש מתמשך בשירות לאחר עדכון מהווה הסכמה לתנאים המעודכנים.
                        שינויים מהותיים יובאו לידיעתכם באמצעות הודעה באפליקציה או במייל.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>9. יצירת קשר</h2>
                    <p style={pStyle}>
                        שאלות בנוגע לתנאים אלה ניתן להפנות אלינו בכתובת:{" "}
                        <a href="mailto:support@biz-control.com" style={{ color: "#7c3aed" }}>support@biz-control.com</a>
                    </p>
                </div>

                <p style={{ ...pStyle, marginTop: "2rem" }}>
                    ראו גם את <a href="/privacy" style={{ color: "#7c3aed" }}>מדיניות הפרטיות</a> שלנו.
                </p>
            </div>
        </div>
    );
}
