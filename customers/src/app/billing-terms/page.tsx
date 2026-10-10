export const metadata = { title: "תקנון ביטולים וחיובים — BizControl" };

// The owner's decisions, 2026-10-10: a free first month; every plan monthly with no commitment, or annual — a
// 12-month commitment, one charge that can be split into card installments, renewing by itself until cancelled;
// a cancellation takes effect at the end of the period paid for. Linked from every sign-up, login and plan choice.
// No prices here (the page is inside the apps too) — they are on the pricing page.

const sectionStyle: React.CSSProperties = { marginBottom: "1.75rem" };
const h2Style: React.CSSProperties = { fontSize: "1.15rem", fontWeight: 800, color: "var(--bf-text)", marginBottom: "0.6rem" };
const pStyle: React.CSSProperties = { color: "var(--bf-muted)", fontSize: "0.95rem", lineHeight: 1.75, marginBottom: "0.5rem" };
const ulStyle: React.CSSProperties = { color: "var(--bf-muted)", fontSize: "0.95rem", lineHeight: 1.75, paddingRight: "1.25rem", marginBottom: "0.5rem" };

export default function BillingTermsPage() {
    return (
        <div style={{ minHeight: "100vh", background: "var(--bf-bg)", color: "var(--bf-text)", direction: "rtl" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem" }}>
                <h1 style={{ fontSize: "1.8rem", fontWeight: 900, color: "var(--bf-text)", marginBottom: "0.3rem" }}>תקנון ביטולים וחיובים</h1>
                <p style={{ color: "var(--bf-faint)", fontSize: "0.85rem", marginBottom: "2.5rem" }}>עודכן לאחרונה: אוקטובר 2026</p>

                <div style={sectionStyle}>
                    <p style={pStyle}>
                        התקנון הזה מסביר איך עובדים המנוי, החיוב והביטול של מערכת <strong>BizControl</strong> לבעלי עסקים
                        (כולל הפרופיל ב-<strong>BizFind</strong>). הוא חלק מ<a href="/terms" style={{ color: "var(--bf-text)", textUnderlineOffset: 3 }}>תנאי השימוש</a>.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>1. חודש ראשון חינם</h2>
                    <ul style={ulStyle}>
                        <li>כל עסק חדש מקבל חודש ראשון חינם, עם כל המערכת פתוחה, בלי כרטיס אשראי.</li>
                        <li>בסוף החודש בוחרים מסלול. עסק שלא בחר מסלול — הכניסה למערכת ננעלת והדף הציבורי שלו מוסתר. הנתונים נשמרים, ואפשר לחזור בכל עת בבחירת מסלול.</li>
                    </ul>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>2. מסלולים ומחירים</h2>
                    <ul style={ulStyle}>
                        <li>המחירים המעודכנים של כל מסלול ומה הוא כולל מופיעים בדף המחירים באתר.</li>
                        <li>המחירים הם לחודש, לפני מע״מ.</li>
                    </ul>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>3. תשלום חודשי — ללא התחייבות</h2>
                    <ul style={ulStyle}>
                        <li>החיוב מתחדש כל חודש, עד שמבטלים.</li>
                        <li>אפשר לבטל בכל עת. הביטול נכנס לתוקף בסוף החודש ששולם — עד אז המערכת פתוחה כרגיל.</li>
                    </ul>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>4. תשלום שנתי — התחייבות לשנה</h2>
                    <ul style={ulStyle}>
                        <li>תשלום שנתי הוא במחיר השנתי המוזל, בהתחייבות ל-12 חודשים.</li>
                        <li>החיוב הוא על כל הסכום השנתי, ואפשר לפרוס אותו לתשלומים בכרטיס האשראי.</li>
                        <li>בסוף השנה המנוי מתחדש לבד לשנה נוספת, עד שמבטלים.</li>
                        <li>ביטול נכנס לתוקף בסוף השנה ששולמה.</li>
                    </ul>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>5. החזרים</h2>
                    <p style={pStyle}>
                        אין החזר על חלק מחודש או משנה ששולמו. הביטול מסיים את המנוי בסוף התקופה ששולמה.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>6. מעבר בין מסלולים</h2>
                    <p style={pStyle}>
                        אפשר לעבור מסלול בכל עת. מעבר למסלול גדול יותר נכנס לתוקף מיד; מעבר למסלול קטן יותר — מתחילת התקופה הבאה.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>7. מכסות במסלול</h2>
                    <ul style={ulStyle}>
                        <li>לכל מסלול מספר הודעות WhatsApp בחודש. כשהן נגמרות — תזכורות ואישורים יוצאים במייל ללקוחות שיש להם מייל, ותפוצות לא יוצאות עד תחילת החודש הבא.</li>
                        <li>התראות לטלפון (פוש) אינן מוגבלות.</li>
                        <li>תכונות שאינן כלולות במסלול מסומנות כנעולות במערכת.</li>
                    </ul>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>8. סליקת אשראי ללקוחות העסק</h2>
                    <p style={pStyle}>
                        חיבור לחברת סליקה (Grow) כדי לגבות מהלקוחות של העסק באשראי — בתשלום נפרד, ישירות לחברת הסליקה ולפי התנאים
                        שלה. הוא אינו כלול במחיר המסלול.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>9. שינוי מחירים</h2>
                    <p style={pStyle}>
                        על שינוי במחיר מסלול נודיע לפחות 30 יום מראש. מי ששילם תשלום שנתי ממשיך במחיר ששילם עד סוף השנה.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>10. מחיקת העסק</h2>
                    <p style={pStyle}>
                        אפשר למחוק את העסק מתוך המערכת. העסק נסגר מיד, וכל הנתונים נמחקים לצמיתות 30 יום אחרי הבקשה (עד אז אפשר
                        לבטל את המחיקה דרכנו). מחיקה אינה מזכה בהחזר על התקופה ששולמה.
                    </p>
                </div>

                <div style={sectionStyle}>
                    <h2 style={h2Style}>11. ביטול ושאלות</h2>
                    <p style={pStyle}>
                        לביטול מנוי או לכל שאלה על חיוב:{" "}
                        <a href="mailto:support@biz-control.com" style={{ color: "var(--bf-text)", textUnderlineOffset: 3 }}>support@biz-control.com</a>
                    </p>
                </div>
            </div>
        </div>
    );
}
