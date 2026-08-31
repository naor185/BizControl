export const metadata = { title: "מדיניות פרטיות — BizFind & BizControl" };

const sectionStyle: React.CSSProperties = { marginBottom: "1.75rem" };
const h2Style: React.CSSProperties = { fontSize: "1.15rem", fontWeight: 800, color: "#1e1b4b", marginBottom: "0.6rem" };
const pStyle: React.CSSProperties = { color: "#475569", fontSize: "0.95rem", lineHeight: 1.75, marginBottom: "0.5rem" };
const ulStyle: React.CSSProperties = { color: "#475569", fontSize: "0.95rem", lineHeight: 1.75, paddingRight: "1.25rem", marginBottom: "0.5rem" };

export default function PrivacyPage() {
    return (
        <div style={{ minHeight: "100vh", background: "#faf5ff", direction: "rtl" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem" }}>
                <h1 style={{ fontSize: "1.8rem", fontWeight: 900, color: "#1e1b4b", marginBottom: "0.3rem" }}>מדיניות פרטיות</h1>
                <p style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "2.5rem" }}>עודכן לאחרונה: אוגוסט 2026</p>

                <div style={sectionStyle}>
                    <p style={pStyle}>
                        מדיניות זו מסבירה אילו נתונים <strong>BizControl</strong> ו-<strong>BizFind</strong> אוספות,
                        לשם מה, ואילו זכויות עומדות לרשותכם. היא חלה בין אם אתם בעלי עסק המשתמשים במערכת הניהול,
                        איש/אשת צוות בעסק, או לקוח/ה הקובע/ת תור דרך BizFind.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>1. איזה מידע אנחנו אוספים</h2>
                    <p style={pStyle}><strong>מבעלי עסקים ואנשי צוות:</strong></p>
                    <ul style={ulStyle}>
                        <li>פרטי חשבון: שם, אימייל, טלפון, סיסמה מוצפנת.</li>
                        <li>פרטי עסק: שם העסק, כתובת, קטגוריה, תמונות.</li>
                        <li>נתונים תפעוליים שאתם מזינים: לקוחות, תורים, הוצאות, חשבוניות, תמונות קבלות.</li>
                        <li>פרטי חיוב (מעובדים ישירות אצל Stripe — אנו לא שומרים מספרי כרטיסי אשראי).</li>
                    </ul>
                    <p style={pStyle}><strong>מלקוחות קצה (דרך BizFind או דרך עסק שמזין אתכם למערכת):</strong></p>
                    <ul style={ulStyle}>
                        <li>שם, טלפון, אימייל — לצורך קביעת תורים ותקשורת מהעסק.</li>
                        <li>היסטוריית תורים, העדפות ותכתובת עם העסק.</li>
                        <li>במידה והעסק מפעיל זאת: תמונות/מסמכים הקשורים לטיפול (למשל תמונות לפני/אחרי) — רק אם הופעל
                            במפורש ובאישורכם.</li>
                    </ul>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>2. למה אנחנו משתמשים במידע</h2>
                    <ul style={ulStyle}>
                        <li>להפעלת השירות: קביעת תורים, שליחת תזכורות ואישורים (WhatsApp/מייל), ניהול תשלומים.</li>
                        <li>לתמיכה טכנית ולשיפור השירות.</li>
                        <li>לצרכי חיוב ותאימות לחוק (למשל שמירת רשומות חשבונאיות).</li>
                        <li>לאבטחת המערכת ומניעת שימוש לרעה.</li>
                    </ul>
                    <p style={pStyle}>אנחנו <strong>לא</strong> מוכרים מידע אישי לצדדים שלישיים למטרות שיווק.</p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>3. עם מי המידע משותף</h2>
                    <p style={pStyle}>אנחנו משתפים מידע רק עם ספקים שמפעילים בפועל את השירות עבורנו, בהיקף המינימלי הנדרש:</p>
                    <ul style={ulStyle}>
                        <li><strong>Stripe</strong> — עיבוד תשלומים ומנויים.</li>
                        <li><strong>ספקי WhatsApp</strong> (Green API / Meta Cloud API) — שליחת הודעות ותזכורות.</li>
                        <li><strong>ספקי דוא"ל</strong> (Resend/Mailgun) — שליחת מיילים תפעוליים.</li>
                        <li><strong>ספקי בינה מלאכותית</strong> (Google Gemini / OpenAI) — סריקת חשבוניות ועוזר ה-AI, כאשר
                            תכונות אלו מופעלות.</li>
                        <li><strong>Cloudinary</strong> — אחסון תמונות (קבלות, תמונות עסק).</li>
                    </ul>
                    <p style={pStyle}>כל ספק כפוף להסכמי סודיות ועיבוד נתונים מתאימים. אנו לא משתפים מידע מעבר לנדרש להפעלת השירות.</p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>4. בידוד בין עסקים</h2>
                    <p style={pStyle}>
                        BizControl היא מערכת רב-דיירים (multi-tenant): כל עסק רואה אך ורק את הנתונים ששייכים לו. אנחנו
                        אוכפים בידוד זה בכל שכבות המערכת. גישת סופר-אדמין למידע חוצה-עסקים מוגבלת לצורכי תמיכה טכנית
                        ותפעול המערכת בלבד.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>5. שמירת מידע ומחיקה</h2>
                    <p style={pStyle}>
                        אנו שומרים מידע כל עוד החשבון פעיל, ובהתאם לחובות חוק (למשל שמירת רשומות חשבונאיות לתקופה
                        הנדרשת בחוק). בעל/ת עסק יכול/ה לבקש מחיקת נתוני לקוח ספציפי, או סגירה ומחיקה של כלל חשבון העסק,
                        בפנייה אלינו בכתובת המצוינת למטה.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>6. הזכויות שלכם</h2>
                    <p style={pStyle}>בהתאם לחוק הגנת הפרטיות, אתם רשאים:</p>
                    <ul style={ulStyle}>
                        <li>לבקש לעיין במידע שנשמר עליכם.</li>
                        <li>לבקש תיקון מידע שגוי.</li>
                        <li>לבקש מחיקת מידע, בכפוף לחובות שמירה על פי דין.</li>
                        <li>להתנגד לשימוש במידע למטרות מסוימות (למשל הודעות שיווקיות).</li>
                    </ul>
                    <p style={pStyle}>
                        לקוחות קצה: פנייה לגבי מידע שנשמר עליכם על ידי עסק ספציפי — מומלץ לפנות ישירות לאותו עסק, שהוא
                        בעל השליטה על נתוני הלקוחות שלו. לפניות כלליות למערכת — ראו יצירת קשר למטה.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>7. אבטחת מידע</h2>
                    <p style={pStyle}>
                        המידע מוצפן בהעברה (HTTPS), סיסמאות נשמרות מוצפנות ולא ניתנות לשחזור, וגישה למידע מוגבלת לפי
                        הרשאות תפקיד. עם זאת, אין מערכת חסינה לחלוטין — אנו פועלים באופן שוטף לשמירה על רמת אבטחה גבוהה.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>8. קטינים</h2>
                    <p style={pStyle}>
                        השירות אינו מיועד לשימוש עצמאי על ידי קטינים מתחת לגיל 18. הזנת פרטי לקוח קטין למערכת על ידי עסק
                        (למשל קביעת תור) נעשית באחריות ובפיקוח ההורה/אפוטרופוס ובהתאם למדיניות העסק עצמו.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>9. שינויים במדיניות</h2>
                    <p style={pStyle}>
                        ייתכן שנעדכן מדיניות זו מעת לעת. עדכונים מהותיים יובאו לידיעתכם באמצעות הודעה באפליקציה או במייל.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>10. יצירת קשר</h2>
                    <p style={pStyle}>
                        לכל שאלה או בקשה בנוגע לפרטיותכם, ניתן לפנות אלינו בכתובת:{" "}
                        <a href="mailto:support@biz-control.com" style={{ color: "#7c3aed" }}>support@biz-control.com</a>
                    </p>
                </div>

                <p style={{ ...pStyle, marginTop: "2rem" }}>
                    ראו גם את <a href="/terms" style={{ color: "#7c3aed" }}>תנאי השימוש</a> שלנו.
                </p>
            </div>
        </div>
    );
}
