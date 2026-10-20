import React from "react";

import { tx } from "@/lib/i18n";
export default function AccessibilityStatement() {
    return (
        <div className="max-w-4xl mx-auto p-8 sm:p-12 text-start leading-relaxed text-slate-800">
            <h1 className="text-4xl font-black mb-8 text-slate-900 tracking-tight">{tx("הצהרת נגישות")}</h1>

            <section className="mb-10">
                <h2 className="text-2xl font-bold mb-4 border-b-2 border-slate-100 pb-2">{tx("מבוא")}</h2>
                <p>
                    {tx("אנו רואים חשיבות עליונה במתן שירות שוויוני, מכובד, נגיש ומקצועי לכל גולשי האתר, ומשקיעים משאבים רבים על מנת להפוך את האתר לנגיש עבור אנשים עם מוגבלות. מטרת ההנגשה היא לשפר את איכות החיים של אנשים אלו ולאפשר להם גלישה נוחה ועצמאית ברחבי הרשת.")}
                </p>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-bold mb-4 border-b-2 border-slate-100 pb-2">{tx("תאימות וסטנדרטים")}</h2>
                <p>
                    {tx("האתר מונגש בהתאם להוראות הנגישות המופיעות ב-")}
                    <a href="https://www.israellaws.co.il/LegalResources/%D7%AA%D7%A7%D7%A0%D7%95%D7%AA-%D7%A9%D7%95%D7%95%D7%99%D7%95%D7%9F-%D7%96%D7%97%D7%95%D7%99%D7%95%D7%AA-%D7%9C%D7%90%D7%A0%D7%A9%D7%99%D7%9D-%D7%A2%D7%9D-%D7%9E%D7%95%D7%92%D7%91%D7%9C%D7%95%D7%AA.aspx" target="_blank" className="text-blue-600 hover:underline mx-1">{tx("תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות)")}</a>
                    {tx("התשע\"ג-2013, ברמה AA, וכן לפי המלצות מסמך WCAG2.0 של ארגון ה-W3C.")}
                </p>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-bold mb-4 border-b-2 border-slate-100 pb-2">{tx("פעולות שבוצעו להנגשת האתר")}</h2>
                <ul className="list-disc list-inside space-y-2 ps-4">
                    <li>{tx("התאמה לדפדפנים מודרניים (Chrome, Firefox, Edge, Safari).")}</li>
                    <li>{tx("התאמה לגלישה ממכשירים ניידים (Responsive Design).")}</li>
                    <li>{tx("תמיכה בניווט באמצעות המקלדת בלבד.")}</li>
                    <li>{tx("שימוש בתוויות טקסט חלופי (Alt text) לתמונות.")}</li>
                    <li>{tx("שמירה על ניגודיות צבעים תקינה לקריאה נוחה.")}</li>
                    <li>{tx("מבנה היררכי נכון של כותרות ותכנים.")}</li>
                    <li>{tx("הימנעות משימוש באלמנטים מהבהבים או תכנים שעלולים לגרום לסינוור.")}</li>
                </ul>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-bold mb-4 border-b-2 border-slate-100 pb-2">{tx("סייגים לנגישות")}</h2>
                <p>
                    {tx("למרות מאמצינו להנגיש את כלל דפי האתר, ייתכן ותיתקלו בחלקים באתר שטרם הונגשו במלואם, או שטרם נמצא הפתרון הטכנולוגי המתאים להנגשתם. אנו ממשיכים במאמצים לשפר את נגישות האתר כחלק ממחויבותנו לאפשר שימוש בו עבור כלל האוכלוסייה.")}
                </p>
            </section>

            <section className="mb-10 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <h2 className="text-2xl font-bold mb-4 border-b-2 border-slate-200 pb-2 text-slate-900">{tx("יצירת קשר בנושא נגישות")}</h2>
                <p className="mb-4">{tx("מסמך זה עודכן לאחרונה בתאריך 13/03/2026. אם נתקלתם בבעיה או בתקלה בנושא הנגישות, נשמח אם תעדכנו אותנו כדי שנוכל לתקן ולשפר. ניתן לפנות לרכז הנגישות שלנו:")}</p>
                <div className="space-y-1 font-bold text-slate-700">
                    <p>{tx("שם רכז הנגישות: [הכנס שם]")}</p>
                    <p>{tx("טלפון: [הכנס טלפון]")}</p>
                    <p>{tx("דוא\"ל: [הכנס אימייל]")}</p>
                </div>
            </section>
        </div>
    );
}
