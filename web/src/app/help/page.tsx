"use client";

import { useState, useMemo } from "react";
import { PlayCircle } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { useTour } from "@/components/tour/TourProvider";
import VideoModal from "@/components/tour/VideoModal";
import VikiAvatar from "@/components/tour/VikiAvatar";
import { TOURS, posterOf, type TourStep } from "@/lib/tours";

import { tx } from "@/lib/i18n";
// The guide's videos, path by path in the order of their steps — short recordings of the real screens on a phone.
// All the paths are the owner's (the help center is the owner's and the managers'; workers have no guide since
// 2026-10-17).
function GuideVideos() {
    const [open, setOpen] = useState<TourStep | null>(null);
    return (
        <>
            {TOURS.map(t => {
                const steps = t.steps.filter(s => s.video);
                if (steps.length === 0) return null;
                return (
                    <section key={t.id} className="mb-8">
                        <h2 className="text-lg font-bold text-slate-800 mb-3">{tx("סרטוני הדרכה — ")}{t.title}</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            {steps.map((step, i) => (
                                <button key={step.id} type="button" onClick={() => setOpen(step)}
                                    className="group text-start bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition">
                                    <span className="relative block aspect-[9/14] bg-sky-800">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={posterOf(step.video!)} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                                        <span className="absolute inset-0 flex items-center justify-center">
                                            <PlayCircle className="w-12 h-12 text-white drop-shadow-lg group-hover:scale-110 transition-transform" aria-hidden />
                                        </span>
                                    </span>
                                    <span className="block px-3 py-2">
                                        <span className="block text-[11px] font-bold text-sky-700">{tx("שלב ")}{i + 1}</span>
                                        <span className="block text-sm font-bold text-slate-800">{step.title}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                );
            })}
            {open?.video && <VideoModal src={open.video} poster={posterOf(open.video)} title={open.title} onClose={() => setOpen(null)} />}
        </>
    );
}

// The guide, from here too (components/tour) — rendered inside AppShell, where the guide lives
function StartTourCard() {
    const tour = useTour();
    if (!tour.available) return null;
    return (
        <div className="mb-6 flex flex-wrap items-center gap-3 bg-sky-50 border border-sky-200 rounded-2xl p-4">
            <VikiAvatar size={48} className="shrink-0 rounded-full" />
            <div className="flex-1 min-w-48">
                <div className="font-bold text-slate-800">{tx("ויקי — הדרכה צעד אחר צעד")}</div>
                <div className="text-sm text-slate-600">{tx("ויקי, העוזרת האישית שלך, תוביל אותך צעד אחר צעד בתוך המערכת, ותבדוק שכל צעד הצליח.")}</div>
            </div>
            <button type="button" onClick={tour.open} className="bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition">
                {tx("התחלת ההדרכה")}
            </button>
        </div>
    );
}

type Article = {
    id: string;
    title: string;
    category: string;
    icon: string;
    content: Section[];
};

type Section = {
    heading?: string;
    text?: string;
    steps?: string[];
    table?: { col1: string; col2: string }[];
    tip?: string;
    warning?: string;
    code?: string;
    note?: string;
};

const ARTICLES: Article[] = [
    {
        id: "calendar",
        title: tx("יומן תורים"),
        category: tx("פעילות יומית"),
        icon: "📅",
        content: [
            {
                text: tx("יומן ויזואלי לניהול כל התורים — ניתן לראות לפי יום/שבוע/חודש ולנהל הכל ממקום אחד."),
            },
            {
                heading: tx("יצירת תור חדש"),
                steps: [
                    tx("לחץ על כל מקום פנוי ביומן — נפתח חלון יצירת תור."),
                    tx("בחר לקוח (חפש לפי שם/טלפון). לקוח חדש? לחץ 'לקוח חדש' ישירות בחלון."),
                    tx("בחר את נותן/ת השירות מהרשימה (חייב להיות רשום בצוות)."),
                    tx("הכנס שם טיפול, מחיר כולל, וסכום מקדמה (אם נדרש)."),
                    tx("שמור — המערכת שולחת הודעת וואטסאפ אוטומטית ללקוח."),
                ],
                tip: tx("אם סכום המקדמה > 0, נשלחת אוטומטית הודעת בקשת תשלום עם לינקי ביט/פייבוקס/בנק."),
            },
            {
                heading: tx("גרירת תור לשעה/תאריך אחר"),
                steps: [
                    tx("גרור את בלוק התור ביומן למיקום החדש (drag & drop)."),
                    tx("המערכת שולחת הודעת 'תור עודכן' ללקוח אוטומטית."),
                ],
            },
            {
                heading: tx("אישור קבלת מקדמה"),
                steps: [
                    tx("לחץ על התור ← לחץ 'אשר מקדמה ✅'."),
                    tx("המערכת שולחת ללקוח הודעה עם כל פרטי התור (כתובת, ניווט, תיק עבודות, מדיניות ביטולים)."),
                ],
                tip: tx("לאחר אישור המקדמה הכתובת, המפה ותיק העבודות נשלחים אוטומטית מהגדרות המדיניות."),
            },
            {
                heading: tx("סימון תור כהסתיים"),
                steps: [
                    tx("לחץ על התור ← לחץ 'סמן כהסתיים ✅'."),
                    tx("המערכת מוסיפה נקודות נאמנות ללקוח ושולחת הודעת Aftercare אחרי עיכוב שהוגדר."),
                ],
            },
            {
                heading: tx("תצוגות יומן"),
                table: [
                    { col1: tx("יומי"), col2: tx("לחץ 'יום' בפינה הימנית העליונה") },
                    { col1: tx("שבועי"), col2: tx("לחץ 'שבוע'") },
                    { col1: tx("חודשי"), col2: tx("לחץ 'חודש'") },
                    { col1: tx("סינון לפי נותן/ת שירות"), col2: tx("בחר שם מהרשימה מעל היומן") },
                ],
            },
        ],
    },
    {
        id: "dashboard",
        title: tx("לוח בקרה"),
        category: tx("פעילות יומית"),
        icon: "📊",
        content: [
            {
                text: tx("מסך ראשי של היום — כל מה שצריך לדעת ולעשות עכשיו: תורים, תשלומים, חברי מועדון."),
            },
            {
                heading: tx("קלפי KPI"),
                table: [
                    { col1: tx("תורים היום"), col2: tx("כמה תורים מתוכננים להיום") },
                    { col1: tx("חברי מועדון"), col2: tx("כמה לקוחות פעילים במועדון") },
                    { col1: tx("הודעות ממתינות"), col2: tx("הודעות אוטומטיות שעדיין לא נשלחו") },
                    { col1: tx("ממתין לאישור"), col2: tx("לקוח אמר ששילם — ממתין לאימות שלך") },
                ],
            },
            {
                heading: tx("רישום תשלום ידני"),
                steps: [
                    tx("לחץ '💳 גבה' ליד תור ברשימה."),
                    tx("בחר שיטת תשלום: מזומן / כרטיס / ביט / פייבוקס / העברה."),
                    tx("לחץ 'שמור'."),
                ],
            },
            {
                heading: tx("אימות תשלום מקוון (ביט/פייבוקס)"),
                steps: [
                    tx("לחץ 'אמת תשלום ✅' ליד תור עם סטטוס 'ממתין לאישור'."),
                    tx("אשר שהכסף הגיע בפועל."),
                    tx("המערכת שולחת הודעת פרטי תור מלאה ללקוח."),
                ],
            },
            {
                heading: tx("יעד חודשי"),
                steps: [
                    tx("לחץ על 'יעד חודשי' בפינה."),
                    tx("הכנס סכום יעד בשקלים."),
                    tx("הפס הירוק מציג כמה כבר הושג מהיעד."),
                ],
            },
        ],
    },
    {
        id: "clients",
        title: tx("לקוחות"),
        category: tx("פעילות יומית"),
        icon: "👥",
        content: [
            {
                text: tx("מאגר כל לקוחות העסק עם פילטרים, חיפוש, וניהול קל."),
            },
            {
                heading: tx("הוספת לקוח חדש"),
                steps: [
                    tx("לחץ 'הוסף לקוח +' (ימין עליון)."),
                    tx("מלא שם מלא (חובה), טלפון, מייל, תאריך לידה."),
                    tx("סמן 'הסכמה לשיווק' — חובה לשליחת הודעות שיווקיות."),
                    tx("שמור."),
                ],
                tip: tx("תאריך לידה חשוב! המערכת שולחת הודעת יום הולדת אוטומטית ביום ההולדת."),
            },
            {
                heading: tx("פילטרים"),
                table: [
                    { col1: tx("כולם"), col2: tx("כל הלקוחות") },
                    { col1: tx("רגילים"), col2: tx("לקוחות שאינם חברי מועדון") },
                    { col1: tx("חברי מועדון 👑"), col2: tx("נרשמו דרך דף הנחיתה") },
                    { col1: tx("לפי חודש יום הולדת"), col2: tx("לחץ על שם החודש — מציג לקוחות יום הולדת") },
                ],
                tip: tx("השתמש בפילטר חודש יום הולדת כדי לשלוח הצעות מיוחדות ללקוחות הנכונים."),
            },
            {
                heading: tx("כרטיס לקוח מלא"),
                steps: [
                    tx("לחץ על שם הלקוח — עובר לכרטיס CRM המלא."),
                    tx("בכרטיס: פרטים, נקודות נאמנות, היסטוריית תורים, תשלומים, הודעות שנשלחו."),
                ],
            },
            {
                heading: tx("מימוש נקודות"),
                steps: [
                    tx("כנס לכרטיס הלקוח."),
                    tx("לחץ 'מש נקודות'."),
                    tx("הכנס כמה נקודות לממש."),
                    tx("המערכת מחשבת הנחה ושולחת הודעת וואטסאפ."),
                ],
            },
        ],
    },
    {
        id: "expenses",
        title: tx("ניהול עסק"),
        category: tx("פיננסים"),
        icon: "💼",
        content: [
            {
                text: tx("ניהול פיננסי מלא — הוצאות, הכנסות, חישובי מס, וייצוא לרואה חשבון."),
            },
            {
                heading: tx("הוספת הוצאה ידנית"),
                steps: [
                    tx("לחץ 'הוסף הוצאה +'."),
                    tx("מלא: שם הוצאה, ספק, מספר חשבונית (אופציונלי), קטגוריה, סכום, מע\"מ, תאריך."),
                    tx("שמור."),
                ],
            },
            {
                heading: tx("סריקת חשבונית עם AI 📸"),
                steps: [
                    tx("לחץ 'סרוק חשבונית 📷'."),
                    tx("צלם או העלה תמונת חשבונית/קבלה."),
                    tx("ה-AI מזהה אוטומטית: שם, ספק, סכום, מע\"מ, תאריך."),
                    tx("בדוק את הנתונים ואשר."),
                ],
                tip: tx("חוסך זמן — פשוט צלם את הקבלה במקום להזין ידנית."),
            },
            {
                heading: tx("סיכום חודשי"),
                table: [
                    { col1: tx("הכנסות ברוטו"), col2: tx("כל התשלומים שנרשמו בחודש") },
                    { col1: tx("מע\"מ להחזר"), col2: tx("מע\"מ על הוצאות") },
                    { col1: tx("מע\"מ לתשלום"), col2: tx("מע\"מ הכנסות פחות החזר") },
                    { col1: tx("מס הכנסה משוער"), col2: tx("לפי האחוז בהגדרות") },
                    { col1: tx("הכנסה נטו"), col2: tx("אחרי כל הניכויים") },
                ],
            },
            {
                heading: tx("ייצוא לאקסל (לרואה חשבון)"),
                steps: [
                    tx("לחץ 'ייצא לאקסל 📊'."),
                    tx("בחר טווח תאריכים."),
                    tx("קובץ xlsx יורד אוטומטית — כולל הוצאות, הכנסות, חישובי מע\"מ."),
                ],
            },
        ],
    },
    {
        id: "products",
        title: tx("מוצרים ומלאי"),
        category: tx("פיננסים"),
        icon: "📦",
        content: [
            {
                text: tx("ניהול מלאי המוצרים שאתה מוכר בעסק — מוצרי טיפוח, ציוד ועוד."),
            },
            {
                heading: tx("הוספת מוצר"),
                steps: [
                    tx("לחץ 'הוסף מוצר +'."),
                    tx("מלא שם, תיאור (אופציונלי), קטגוריה, מחיר, כמות במלאי."),
                    tx("שמור."),
                ],
            },
            {
                heading: tx("רישום מכירה"),
                steps: [
                    tx("לחץ 'מכור' על המוצר הרצוי."),
                    tx("הכנס כמות."),
                    tx("המלאי מתעדכן אוטומטית ונרשמת מכירה."),
                ],
            },
            {
                heading: tx("היסטוריית מכירות"),
                steps: [
                    tx("לחץ 'היסטוריה' על המוצר."),
                    tx("מציג: תאריך, מוכר, כמות, סכום."),
                ],
            },
        ],
    },
    {
        id: "team",
        title: tx("ניהול צוות"),
        category: tx("ניהול צוות"),
        icon: "👥",
        content: [
            {
                text: tx("ניהול חברי הצוות — מטפלים, עובדים ומנהלים. כל אחד מקבל כניסה, צבע ביומן, ושיטת שכר."),
            },
            {
                heading: tx("הוספת חבר צוות"),
                steps: [
                    tx("לחץ 'הוסף חבר צוות +'."),
                    tx("מלא שם, מייל, סיסמה ראשונית."),
                    tx("בחר תפקיד: איש צוות / מנהל."),
                    tx("בחר צבע ביומן (לחץ על הריבוע הצבעוני)."),
                    tx("בחר שיטת שכר: ללא / שעתי (₪/שעה) / עמלה (%)."),
                    tx("שמור."),
                ],
            },
            {
                heading: tx("שיטות שכר"),
                table: [
                    { col1: tx("ללא שכר"), col2: tx("לא נכנס לחישובי שכר") },
                    { col1: tx("שעתי"), col2: tx("הכנס תעריף לשעה — מחושב לפי שעות שנרשמו") },
                    { col1: tx("עמלה (%)"), col2: tx("הכנס אחוז מכל תור שלו") },
                ],
            },
            {
                heading: tx("השבתת / מחיקת עובד"),
                steps: [
                    tx("השבתה: לחץ 'השבת' — עדיין מופיע בהיסטוריה, אך לא זמין לתורים חדשים."),
                    tx("מחיקה: לחץ 🗑️ — לא ניתן למחוק את בעל החשבון."),
                ],
            },
        ],
    },
    {
        id: "payroll",
        title: tx("דוחות שכר"),
        category: tx("ניהול צוות"),
        icon: "💰",
        content: [
            {
                text: tx("חישוב שכר חודשי לכל חבר צוות לפי שיטת השכר שהוגדרה."),
            },
            {
                heading: tx("צפייה בדוח"),
                steps: [
                    tx("בחר חודש ושנה בחלק העליון."),
                    tx("הדוח מתעדכן אוטומטית."),
                ],
            },
            {
                heading: tx("מה מחושב"),
                table: [
                    { col1: tx("שכר שעתי"), col2: tx("שעות עבודה × תעריף שעתי") },
                    { col1: tx("עמלות"), col2: tx("סה\"כ הכנסות מתוריו × אחוז העמלה") },
                    { col1: tx("סה\"כ לתשלום"), col2: tx("שכר שעתי + עמלות") },
                ],
                warning: tx("שעות עבודה חייבות להירשם במערכת (WorkSession). אם לא נרשמו שעות — השכר השעתי יהיה 0."),
            },
        ],
    },
    {
        id: "payments",
        title: tx("תשלומים"),
        category: tx("פיננסים"),
        icon: "💳",
        content: [
            {
                text: tx("היסטוריה מלאה של כל התשלומים, מסוכמים לפי חודש ושיטת תשלום."),
            },
            {
                heading: tx("פילטרים"),
                table: [
                    { col1: tx("חודש/שנה"), col2: tx("בחר בחלק העליון") },
                    { col1: tx("שיטת תשלום"), col2: tx("הכל / מזומן / כרטיס / ביט / פייבוקס / העברה") },
                ],
            },
            {
                heading: tx("מחיקת תשלום"),
                steps: [
                    tx("לחץ 🗑️ ← אישור מחיקה."),
                ],
                warning: tx("מחיקת תשלום מחזירה נקודות קאשבק אם ניתנו ללקוח."),
            },
        ],
    },
    {
        id: "settings-branding",
        title: tx("הגדרות — מיתוג ועיצוב"),
        category: tx("הגדרות"),
        icon: "🎨",
        content: [
            {
                heading: tx("לוגו"),
                steps: [
                    tx("הגדרות → לשונית 'מיתוג ועיצוב'."),
                    tx("לחץ 'בחר קובץ לוגו'."),
                    tx("בחר קובץ PNG שקוף (מומלץ, לפחות 400×400 פיקסל)."),
                    tx("נשמר אוטומטית."),
                ],
                tip: tx("הלוגו מופיע בממשק ההתחברות ובדפי הנחיתה שהלקוחות רואים."),
            },
        ],
    },
    {
        id: "settings-landing",
        title: tx("הגדרות — דפי נחיתה"),
        category: tx("הגדרות"),
        icon: "🚀",
        content: [
            {
                text: tx("הגדרת דף ההרשמה שהלקוחות רואים כשהם מצטרפים למועדון."),
            },
            {
                heading: tx("AI מחולל עיצוב ✨"),
                steps: [
                    tx("הגדרות → 'דפי נחיתה'."),
                    tx("כתוב תיאור עסק בשדה (לדוגמה: 'עסק בוטיק, שירות אישי ואווירה נעימה')."),
                    tx("לחץ 'צור עיצוב'."),
                    tx("הצבעים, הכותרת והתיאור מתמלאים אוטומטית."),
                    tx("שמור."),
                ],
                warning: tx("מכסה: 3 שימושים בחודש בלבד (מתאפס ב-1 לחודש)."),
            },
            {
                heading: tx("הגדרת דף ידנית"),
                steps: [
                    tx("הגדר צבע ראשי ומשני (לחץ על ריבוע הצבע)."),
                    tx("כתוב כותרת ותיאור."),
                    tx("בחר גופן (Heebo מומלץ לעברית)."),
                    tx("העלה תמונת רקע (1920×1080 מומלץ)."),
                    tx("העלה עד 3 תמונות גלריה (ריבועיות, 800×800+)."),
                    tx("בחר תבנית עיצוב."),
                    tx("שמור."),
                ],
                tip: tx("לינק דף הנחיתה: [הדומיין שלך]/join/[מזהה העסק]. שים אותו בביו של האינסטגרם!"),
            },
        ],
    },
    {
        id: "settings-messages",
        title: tx("הגדרות — הודעות אוטומטיות"),
        category: tx("הגדרות"),
        icon: "📩",
        content: [
            {
                text: tx("כל ההודעות נשלחות אוטומטית — אין צורך לשלוח ידנית. ניתן להתאים את תוכן כל הודעה."),
            },
            {
                heading: tx("הודעות קיימות"),
                table: [
                    { col1: tx("אישור תור"), col2: tx("מיד כשנוצר תור ללא מקדמה") },
                    { col1: tx("בקשת מקדמה"), col2: tx("מיד כשנוצר תור עם מקדמה > 0") },
                    { col1: tx("אישור מקדמה + פרטים"), col2: tx("אחרי שבעל העסק מאשר מקדמה") },
                    { col1: tx("תזכורת"), col2: tx("יום לפני התור") },
                    { col1: "Aftercare", col2: tx("X דקות אחרי סיום תור") },
                    { col1: tx("שינוי תור"), col2: tx("כשמשנים תאריך/שעה") },
                    { col1: tx("ביטול תור"), col2: tx("כשמבטלים תור") },
                    { col1: tx("ברוכים הבאים למועדון"), col2: tx("כשלקוח נרשם דרך דף הנחיתה") },
                    { col1: tx("אחרי תשלום"), col2: tx("אחרי אישור תשלום ידני") },
                    { col1: tx("יום הולדת"), col2: tx("ביום ההולדת של הלקוח") },
                    { col1: tx("לקוח שאינו חבר"), col2: tx("הזמנה להצטרף למועדון") },
                    { col1: tx("מימוש נקודות"), col2: tx("אחרי מימוש נקודות") },
                ],
            },
            {
                heading: tx("משתנים (placeholders)"),
                table: [
                    { col1: "{client_name}", col2: tx("שם הלקוח") },
                    { col1: "{appointment_date}", col2: tx("תאריך התור") },
                    { col1: "{appointment_time}", col2: tx("שעת התור") },
                    { col1: "{appointment_title}", col2: tx("שם הטיפול") },
                    { col1: "{artist_name}", col2: tx("שם נותן/ת השירות") },
                    { col1: "{staff_title}", col2: tx("איך העסק קורא לנותן/ת השירות (למשל: מטפל/ת, מדריך/ה)") },
                    { col1: "{deposit_amount}", col2: tx("סכום מקדמה בש\"ח") },
                    { col1: "{bit_link}", col2: tx("לינק תשלום ביט") },
                    { col1: "{paybox_link}", col2: tx("לינק תשלום פייבוקס") },
                    { col1: "{bank_details}", col2: tx("פרטי העברה בנקאית") },
                    { col1: "{studio_address}", col2: tx("כתובת העסק") },
                    { col1: "{map_link}", col2: tx("לינק ניווט") },
                    { col1: "{portfolio_link}", col2: tx("לינק תיק עבודות") },
                    { col1: "{join_link}", col2: tx("לינק הצטרפות למועדון") },
                    { col1: "{loyalty_points}", col2: tx("יתרת נקודות הלקוח") },
                    { col1: "{cancellation_free_days}", col2: tx("ימי ביטול חינמי") },
                    { col1: "{deposit_lock_days}", col2: tx("ימי נעילת מקדמה") },
                ],
                tip: tx("לחץ על כפתור המשתנה בממשק ← מועתק אוטומטית ← הדבק בהודעה."),
            },
        ],
    },
    {
        id: "settings-policy",
        title: tx("הגדרות — מדיניות וכתובת"),
        category: tx("הגדרות"),
        icon: "📋",
        content: [
            {
                heading: tx("כתובת העסק"),
                text: tx("הכתובת הפיזית — נכנסת ל-{studio_address} בהודעות. לדוגמה: 'רחוב הרצל 45, קומה 2, תל אביב'."),
            },
            {
                heading: tx("לינק ניווט — איך מוצאים"),
                steps: [
                    tx("פתח maps.google.com בדפדפן."),
                    tx("חפש את כתובת העסק."),
                    tx("לחץ 'שתף' (Share) ← 'העתק קישור'."),
                    tx("הדבק את הלינק בשדה."),
                ],
            },
            {
                heading: tx("לינק תיק עבודות"),
                table: [
                    { col1: tx("אינסטגרם"), col2: tx("instagram.com/שם_המשתמש_שלך") },
                    { col1: tx("לינקטר"), col2: tx("linktr.ee/שם_שלך") },
                    { col1: tx("אתר"), col2: tx("כתובת האתר שלך") },
                ],
            },
            {
                heading: tx("פרטי בנק — איפה מוצאים"),
                steps: [
                    tx("שיק ביטול — בחלק התחתון יש שם בנק, סניף ומספר חשבון."),
                    tx("אפליקציית הבנק ← 'פרטי חשבון'."),
                    tx("פנקס שיקים — בחלק התחתון של כל שיק."),
                ],
                tip: tx("הפרטים מתחברים אוטומטית לפורמט: 'שם_בנק | סניף X | חשבון Y' בהודעות."),
            },
            {
                heading: tx("מדיניות ביטולים"),
                table: [
                    { col1: tx("ימי ביטול חינמי"), col2: tx("כמה ימים לפני התור ניתן לבטל ולקבל החזר מלא (ברירת מחדל: 7)") },
                    { col1: tx("ימי נעילת מקדמה"), col2: tx("כמה ימים לפני ניתן לשנות תור בלי לאבד מקדמה (ברירת מחדל: 7)") },
                ],
            },
        ],
    },
    {
        id: "settings-automation",
        title: tx("הגדרות — חוקים ואוטומציה"),
        category: tx("הגדרות"),
        icon: "⚙️",
        content: [
            {
                heading: tx("נקודות נאמנות"),
                table: [
                    { col1: tx("נקודות לכל תור"), col2: tx("נקודות שהלקוח מקבל אחרי כל ביקור (ברירת מחדל: 10)") },
                    { col1: tx("נקודות בהרשמה"), col2: tx("נקודות מתנה לחברי מועדון חדשים (ברירת מחדל: 50)") },
                    { col1: tx("% קאשבק מתשלום"), col2: tx("אחוז מכל תשלום שמתווסף כנקודות (ברירת מחדל: 5%)") },
                    { col1: tx("הטבת יום הולדת"), col2: tx("אחוז הנחה ביום ההולדת (ברירת מחדל: 10%)") },
                ],
            },
            {
                heading: tx("Aftercare — עיכוב הודעה"),
                text: tx("מספר הדקות אחרי שעת התור שאחריהן נשלחת הודעת הטיפול. ברירת מחדל: 30 דקות. המלצה: 60–120 דקות."),
            },
            {
                heading: tx("שעות יומן"),
                text: tx("שעת פתיחה וסגירה ביומן (ברירת מחדל: 08:00–23:00). לא מונע תורים מחוץ לשעות — רק קובע תצוגה."),
            },
        ],
    },
    {
        id: "settings-finance",
        title: tx("הגדרות — תשלומים ופיננסים"),
        category: tx("הגדרות"),
        icon: "💰",
        content: [
            {
                heading: tx("לינק ביט — איך מוצאים"),
                steps: [
                    tx("פתח אפליקציית ביט."),
                    tx("לחץ על התמונה שלך (פרופיל)."),
                    tx("לחץ 'שתף פרופיל' / 'הלינק שלי'."),
                    tx("העתק את הלינק."),
                ],
                tip: tx("הלינק נכנס ל-{bit_link} בהודעת בקשת מקדמה."),
            },
            {
                heading: tx("לינק פייבוקס — איך מוצאים"),
                steps: [
                    tx("פתח אפליקציית Paybox."),
                    tx("לחץ על הלוגו/פרופיל שלך."),
                    tx("לחץ 'שתף' / 'הלינק שלי'."),
                    tx("העתק את הלינק."),
                ],
            },
            {
                heading: tx("אחוזי מס (לחישובים בדוחות)"),
                table: [
                    { col1: tx("מע\"מ"), col2: tx("17% (ישראל)") },
                    { col1: tx("מס הכנסה"), col2: tx("10% (ברירת מחדל)") },
                    { col1: tx("ביטוח לאומי"), col2: tx("5% (ברירת מחדל)") },
                ],
                warning: tx("אלו הערכות בלבד. ייעץ עם רואה חשבון לחישוב מדויק."),
            },
        ],
    },
    {
        id: "settings-whatsapp",
        title: tx("חיבור וואטסאפ — Green API"),
        category: tx("חיבורים חיצוניים"),
        icon: "📱",
        content: [
            {
                text: tx("Green API מאפשרת לשלוח וואטסאפ מהמספר הקיים שלך על ידי סריקת QR. עלות: ~50 ₪/חודש."),
            },
            {
                heading: tx("הגדרה שלב אחר שלב"),
                steps: [
                    tx("כנס לאתר green-api.com ← צור חשבון."),
                    tx("לחץ 'Create Instance' ← בחר תוכנית."),
                    tx("בתוך ה-Instance ← לחץ 'Scan QR'."),
                    tx("פתח וואטסאפ בטלפון ← ⋮ → מכשירים מקושרים → קשר מכשיר ← סרוק את ה-QR."),
                    tx("Instance ID — מופיע בדף ה-Instance (מספר)."),
                    tx("API Token — לחץ 'Show Token' ← העתק."),
                    tx("הכנס Instance ID + Token בהגדרות BizControl ← שמור."),
                    tx("בהגדרות: העתק כתובת Webhook (תיבה כתומה)."),
                    tx("כנס ל-green-api.com → Instance → Settings → Webhooks ← הדבק שם."),
                ],
                tip: tx("ה-Instance חייב להיות ירוק (פעיל). אם כבה — סרוק QR מחדש."),
            },
        ],
    },
    {
        id: "settings-meta",
        title: tx("חיבור וואטסאפ — Meta Cloud API"),
        category: tx("חיבורים חיצוניים"),
        icon: "🔵",
        content: [
            {
                text: tx("Meta Cloud API מאפשרת 1,000 הודעות חינם בחודש. דורש מספר טלפון נפרד שאינו מחובר לאפליקציית וואטסאפ."),
            },
            {
                heading: tx("הגדרה שלב אחר שלב"),
                steps: [
                    tx("כנס ל-developers.facebook.com ← 'My Apps' ← 'Create App'."),
                    tx("בחר 'Business' ← מלא שם ← 'Create App'."),
                    tx("חפש 'WhatsApp' בלוח הבקרה ← 'Set Up'."),
                    tx("Phone Number ID — מופיע בלשונית 'API Setup' ← העתק."),
                    tx("Access Token קבוע: Business Settings → System Users → Create System User (Admin) ← 'Generate Token' ← בחר אפליקציה ← הרשאה whatsapp_business_messaging ← Generate ← העתק."),
                    tx("הכנס Phone Number ID + Token בהגדרות ← שמור."),
                    tx("העתק Webhook URL מהתיבה הכחולה בהגדרות."),
                    tx("ב-Meta Developers → WhatsApp → Configuration → Webhook → Edit."),
                    tx("הכנס Callback URL (מהתיבה הכחולה) + Verify Token: bizcontrol_verify."),
                    tx("לחץ 'Verify and Save' ← תחת Webhook Fields הפעל: messages."),
                ],
                warning: tx("דורש מספר טלפון שאינו מחובר לאפליקציית וואטסאפ (SIM נפרד / eSIM)."),
            },
        ],
    },
    {
        id: "settings-email",
        title: tx("חיבור מייל — Resend API"),
        category: tx("חיבורים חיצוניים"),
        icon: "📧",
        content: [
            {
                text: tx("BizControl שולח מיילים אוטומטיים (אישורי תור, תזכורות, קבלות תשלום) דרך Resend — שירות מייל מהיר ואמין."),
            },
            {
                heading: tx("הגדרה שלב אחר שלב"),
                steps: [
                    tx("כנס ל-resend.com ← הרשם חינם (אין צורך בכרטיס אשראי לגרסה הבסיסית)."),
                    tx("בתפריט שמאל לחץ 'API Keys' ← 'Create API Key' ← תן שם כלשהו ← Create."),
                    tx("העתק את המפתח (מתחיל ב-re_...)."),
                    tx("ב-BizControl ← הגדרות ← אינטגרציות ← 'חבר אימייל'."),
                    tx("הדבק את ה-API Key ← שמור."),
                    tx("לחץ 'שלח מייל בדיקה' ← הכנס כתובת לבדיקה ← ודא שהגיע."),
                ],
                tip: tx("ללא אימות דומיין — הדומיין השולח יהיה onboarding@resend.dev. זה בסדר לבדיקות. לכתובת ממותגת (studio@yourname.com) יש לאמת דומיין."),
            },
            {
                heading: tx("אימות דומיין (אופציונלי — לכתובת מותאמת אישית)"),
                steps: [
                    tx("ב-Resend ← 'Domains' ← 'Add Domain' ← הכנס את הדומיין שלך."),
                    tx("Resend יראה לך רשומות DNS להוסיף אצל ספק הדומיין שלך (Wix / GoDaddy / Cloudflare)."),
                    tx("הוסף את הרשומות ← המתן עד 24 שעות לאימות."),
                    tx("לאחר אימות — הכנס כתובת שולח (studio@yourdomain.com) בשדה 'כתובת שולח' בהגדרות."),
                ],
            },
        ],
    },
    {
        id: "settings-meta-social",
        title: tx("Instagram + Facebook — לידים אוטומטיים"),
        category: tx("חיבורים חיצוניים"),
        icon: "📸",
        content: [
            {
                text: tx("כל הודעת DM באינסטגרם, הודעת Messenger בפייסבוק, או מילוי טופס Lead Ads — מגיעים אוטומטית לאינבוקס הלידים ב-BizControl."),
            },
            {
                heading: tx("מה נדרש לפני ההגדרה"),
                steps: [
                    tx("דף פייסבוק עסקי פעיל."),
                    tx("חשבון Instagram Business מחובר לדף הפייסבוק (הגדרות דף ← Instagram)."),
                    tx("גישה ל-developers.facebook.com עם חשבון שהוא Admin על הדף."),
                ],
            },
            {
                heading: tx("שלב 1 — יצירת Meta App"),
                steps: [
                    tx("כנס ל-developers.facebook.com ← 'My Apps' ← 'Create App'."),
                    tx("בחר סוג 'Business' ← מלא שם ← Create."),
                    tx("בלוח הבקרה של האפליקציה: הוסף מוצרים — Messenger, Instagram, Webhooks."),
                ],
            },
            {
                heading: tx("שלב 2 — קבלת Access Token"),
                steps: [
                    "Business Settings (business.facebook.com) ← System Users ← Add.",
                    tx("צור System User מסוג Admin ← Generate Token."),
                    tx("בחר את האפליקציה שיצרת ← הרשאות: pages_read_engagement, instagram_basic, leads_retrieval, messages."),
                    tx("שמור את ה-Token (מתחיל ב-EAA...)."),
                ],
            },
            {
                heading: tx("שלב 3 — הגדרה ב-BizControl"),
                steps: [
                    tx("הגדרות ← אינטגרציות ← 'חבר Instagram & Facebook'."),
                    tx("הכנס Facebook Page ID (נמצא בדף ← About ← Page Transparency)."),
                    tx("הכנס Instagram Account ID (מהגרף API Explorer: me?fields=instagram_business_account)."),
                    tx("הכנס את ה-Access Token ← שמור."),
                ],
            },
            {
                heading: tx("שלב 4 — הגדרת Webhook ב-Meta"),
                steps: [
                    tx("ב-Meta Developers ← האפליקציה שלך ← Webhooks ← Add Callback URL."),
                    tx("Callback URL: העתק מ-BizControl (מסך שלב 2 באשף)."),
                    "Verify Token: bizcontrol_verify",
                    tx("לחץ Verify and Save."),
                    tx("Subscribe לאירועים: messages, messaging_postbacks, leadgen, feed."),
                ],
                tip: tx("לאחר הגדרה: שלח DM לדף/לאינסטגרם ← תוך שניות יופיע ליד חדש בBizControl."),
            },
            {
                heading: tx("מה מגיע אוטומטית לאחר ההגדרה"),
                table: [
                    { col1: "Instagram DM", col2: tx("ליד חדש עם שם + הודעה ראשונה") },
                    { col1: "Facebook Messenger", col2: tx("ליד חדש עם שם + הודעה ראשונה") },
                    { col1: tx("Lead Ads (טופס מודעה)"), col2: tx("ליד עם כל הפרטים מהטופס") },
                ],
            },
        ],
    },
    {
        id: "settings-utm",
        title: tx("TikTok + Google Ads — מעקב UTM"),
        category: tx("חיבורים חיצוניים"),
        icon: "🎯",
        content: [
            {
                text: tx("TikTok ו-Google לא מאפשרים גישה ל-DMs דרך API. הדרך לקבל לידים מהם היא להוביל את המשתמשים לדף הנחיתה של העסק עם UTM parameters — המערכת יוצרת ליד אוטומטית."),
            },
            {
                heading: tx("איך זה עובד"),
                steps: [
                    tx("הלקוח לוחץ על המודעה ב-TikTok/Google."),
                    tx("מגיע לדף הנחיתה שלך עם UTM בכתובת (לדוגמה: ?utm_source=tiktok&utm_campaign=summer)."),
                    tx("ממלא את הטופס (שם + טלפון)."),
                    tx("המערכת יוצרת לקוח + ליד עם source=tiktok ושם הקמפיין."),
                    tx("הליד מופיע באינבוקס הלידים עם מקור ברור."),
                ],
            },
            {
                heading: tx("פורמט הקישור למודעה"),
                code: "https://bizcontrol.app/s/STUDIO-SLUG?utm_source=tiktok&utm_campaign=CAMPAIGN-NAME",
            },
            {
                heading: tx("פרמטרים נתמכים"),
                table: [
                    { col1: "utm_source", col2: tx("tiktok / google / instagram / facebook (מקור התנועה)") },
                    { col1: "utm_campaign", col2: tx("שם הקמפיין (לדוגמה: summer_promo)") },
                    { col1: "utm_medium", col2: tx("סוג המדיה (cpc, social, email...)") },
                    { col1: "source", col2: tx("קיצור של utm_source (קיצור נוחות)") },
                ],
            },
            {
                heading: tx("דוגמאות לקישורים"),
                table: [
                    { col1: "TikTok", col2: "/s/mystudio?utm_source=tiktok&utm_campaign=tattoo_june" },
                    { col1: "Google", col2: "/s/mystudio?utm_source=google&utm_campaign=brand" },
                    { col1: "Instagram Bio", col2: "/s/mystudio?utm_source=instagram&utm_campaign=bio" },
                    { col1: "Facebook Post", col2: "/s/mystudio?utm_source=facebook&utm_campaign=post_summer" },
                ],
                tip: tx("כל קמפיין בנפרד — תוכל לראות בדיוק איזה מודעה מביאה הכי הרבה לידים בדף האנליטיקס."),
            },
        ],
    },
    {
        id: "settings-google",
        title: tx("חיבור Google Calendar"),
        category: tx("חיבורים חיצוניים"),
        icon: "📆",
        content: [
            {
                text: tx("כל תור שנוצר/עודכן/בוטל ב-BizControl מסתנכרן אוטומטית ליומן Google שלך."),
            },
            {
                heading: tx("הגדרה שלב אחר שלב"),
                steps: [
                    tx("כנס ל-console.cloud.google.com."),
                    tx("לחץ 'New Project' ← תן שם ← 'Create'."),
                    tx("APIs & Services ← Library ← חפש 'Google Calendar API' ← Enable."),
                    "Credentials ← Create Credentials ← OAuth 2.0 Client ID.",
                    "Application Type: Web Application.",
                    tx("Authorized redirect URIs: http://localhost:3000/api/auth/google/callback (ולאחר העלייה לאוויר — הדומיין הסופי)."),
                    tx("Create ← קבל Client ID ו-Client Secret."),
                    tx("הכנס Client ID + Client Secret בהגדרות BizControl ← שמור."),
                    tx("לחץ 'חבר יומן Google' ← התחבר עם חשבון Google ← אשר הרשאות."),
                ],
                tip: tx("לאחר חיבור מוצלח יופיע '✅ יומן גוגל מחובר'. אם נתקעת — נתק וחבר מחדש."),
            },
        ],
    },
    {
        id: "landing-page",
        title: tx("דף הצטרפות לקוח (ציבורי)"),
        category: tx("ציבורי"),
        icon: "🌐",
        content: [
            {
                text: tx("דף ציבורי שהלקוח ממלא כדי להצטרף למועדון. לינק: [הדומיין שלך]/join/[מזהה העסק]."),
            },
            {
                heading: tx("מה הלקוח ממלא"),
                table: [
                    { col1: tx("שם מלא"), col2: tx("חובה") },
                    { col1: tx("טלפון"), col2: tx("חובה") },
                    { col1: tx("מייל"), col2: tx("אופציונלי") },
                    { col1: tx("תאריך לידה"), col2: tx("לתזכורת יום הולדת") },
                    { col1: tx("הסכמה לשיווק"), col2: tx("נדרש לחוק") },
                ],
            },
            {
                heading: tx("מה קורה אחרי הרשמה"),
                steps: [
                    tx("לקוח נוצר במערכת (או מעודכן אם קיים לפי טלפון)."),
                    tx("מסומן כחבר מועדון 👑."),
                    tx("מקבל נקודות הצטרפות."),
                    tx("מקבל הודעת וואטסאפ 'ברוכים הבאים'."),
                ],
                tip: tx("שים את הלינק בביו של האינסטגרם, בסטורי, ובQR על הקיר בעסק!"),
            },
        ],
    },
    {
        id: "deposit-page",
        title: tx("דף תשלום מקדמה (ציבורי)"),
        category: tx("ציבורי"),
        icon: "💸",
        content: [
            {
                text: tx("דף ציבורי שנשלח ללקוח בהודעת וואטסאפ לאחר קביעת תור עם מקדמה."),
            },
            {
                heading: tx("תהליך"),
                steps: [
                    tx("נוצר תור עם מקדמה ← הלקוח מקבל הודעת וואטסאפ עם לינק."),
                    tx("הלקוח פותח את הלינק ← רואה פרטי תור וסכום מקדמה."),
                    tx("הלקוח משלם דרך ביט/פייבוקס (לינקים שהוגדרו בהגדרות)."),
                    tx("הלקוח לוחץ 'אישרתי ששלחתי' ← מוסיף הערה."),
                    tx("הסטטוס ב-BizControl ← 'ממתין לאישור'."),
                    tx("בעל העסק מאמת בלוח הבקרה ← לחץ 'אמת תשלום ✅'."),
                    tx("המערכת שולחת ללקוח הודעה עם כל פרטי התור."),
                ],
            },
        ],
    },
];

const CATEGORIES = [tx("הכל"), tx("פעילות יומית"), tx("פיננסים"), tx("ניהול צוות"), tx("הגדרות"), tx("חיבורים חיצוניים"), tx("ציבורי")];

export default function HelpPage() {
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState(tx("הכל"));
    const [openId, setOpenId] = useState<string | null>(null);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return ARTICLES.filter((a) => {
            const matchCat = category === "הכל" || a.category === category;
            if (!matchCat) return false;
            if (!q) return true;
            const haystack = [
                a.title,
                a.category,
                ...a.content.flatMap(s => [
                    s.heading || "",
                    s.text || "",
                    s.tip || "",
                    s.warning || "",
                    s.code || "",
                    s.note || "",
                    ...(s.steps || []),
                    ...(s.table || []).flatMap(r => [r.col1, r.col2]),
                ])
            ].join(" ").toLowerCase();
            return haystack.includes(q);
        });
    }, [search, category]);

    return (
        <RequireAuth>
            <AppShell title={tx("מרכז עזרה")}>
                <div className="max-w-5xl mx-auto pb-16">

                    {/* Header */}
                    <div className="mb-8 text-center">
                        <div className="text-5xl mb-4">🆘</div>
                        <h1 className="text-3xl font-bold text-slate-800">{tx("מרכז עזרה")}</h1>
                        <p className="text-slate-500 mt-2">{tx("מדריך מלא לכל פיצ'ר, חיבור וקיצור דרך במערכת")}</p>
                    </div>

                    <StartTourCard />
                    <GuideVideos />

                    {/* Search */}
                    <div className="relative mb-6">
                        <span className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">🔍</span>
                        <input
                            type="text"
                            value={search}
                            onChange={e => { setSearch(e.target.value); setOpenId(null); }}
                            placeholder={tx("חפש פיצ'ר, הגדרה, חיבור...")}
                            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 ps-11 text-sm outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch("")}
                                className="absolute end-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Category tabs */}
                    <div className="flex flex-wrap gap-2 mb-8">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat}
                                onClick={() => { setCategory(cat); setOpenId(null); }}
                                className={[
                                    "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                                    category === cat
                                        ? "bg-sky-600 text-white"
                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                                ].join(" ")}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>

                    {/* Results count */}
                    {search && (
                        <p className="text-sm text-slate-500 mb-4">
                            {tx("נמצאו")} {filtered.length}{tx(" תוצאות עבור “")}{search}&rdquo;
                        </p>
                    )}

                    {/* Articles */}
                    {filtered.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <div className="text-4xl mb-3">🔍</div>
                            <p className="font-medium">{tx("לא נמצאו תוצאות")}</p>
                            <p className="text-sm mt-1">{tx("נסה מילת חיפוש אחרת")}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filtered.map(article => (
                                <div
                                    key={article.id}
                                    className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                                >
                                    {/* Article header */}
                                    <button
                                        onClick={() => setOpenId(openId === article.id ? null : article.id)}
                                        className="w-full flex items-center justify-between px-6 py-4 text-start hover:bg-slate-50 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">{article.icon}</span>
                                            <div className="text-start">
                                                <div className="font-bold text-slate-800 text-sm">{article.title}</div>
                                                <div className="text-xs text-slate-400 mt-0.5">{article.category}</div>
                                            </div>
                                        </div>
                                        <span className="text-slate-400 text-xs me-2">
                                            {openId === article.id ? "▲" : "▼"}
                                        </span>
                                    </button>

                                    {/* Article content */}
                                    {openId === article.id && (
                                        <div className="border-t border-slate-100 px-6 py-5 space-y-6">
                                            {article.content.map((section, i) => (
                                                <div key={i}>
                                                    {section.heading && (
                                                        <h3 className="font-bold text-slate-800 text-sm mb-3">
                                                            {section.heading}
                                                        </h3>
                                                    )}
                                                    {section.text && (
                                                        <p className="text-sm text-slate-600 leading-relaxed mb-3">
                                                            {section.text}
                                                        </p>
                                                    )}
                                                    {section.steps && (
                                                        <ol className="space-y-2">
                                                            {section.steps.map((step, j) => (
                                                                <li key={j} className="flex items-start gap-3">
                                                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-sky-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">
                                                                        {j + 1}
                                                                    </span>
                                                                    <span className="text-sm text-slate-700 leading-relaxed">{step}</span>
                                                                </li>
                                                            ))}
                                                        </ol>
                                                    )}
                                                    {section.table && (
                                                        <div className="rounded-xl overflow-hidden border border-slate-100">
                                                            <table className="w-full text-sm">
                                                                <tbody>
                                                                    {section.table.map((row, j) => (
                                                                        <tr key={j} className={j % 2 === 0 ? "bg-slate-50" : "bg-white"}>
                                                                            <td className="px-4 py-2.5 font-medium text-slate-700 w-1/3 border-e border-slate-100 font-mono text-xs">
                                                                                {row.col1}
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-slate-600 text-xs">
                                                                                {row.col2}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                    {section.code && (
                                                        <div className="mt-3 bg-slate-900 rounded-xl px-4 py-3 overflow-x-auto">
                                                            <code className="text-xs text-emerald-300 font-mono whitespace-pre-wrap break-all">{section.code}</code>
                                                        </div>
                                                    )}
                                                    {section.tip && (
                                                        <div className="mt-3 flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                                                            <span className="text-emerald-600 mt-0.5">💡</span>
                                                            <p className="text-xs text-emerald-800 leading-relaxed">{section.tip}</p>
                                                        </div>
                                                    )}
                                                    {section.warning && (
                                                        <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                                                            <span className="text-amber-600 mt-0.5">⚠️</span>
                                                            <p className="text-xs text-amber-800 leading-relaxed">{section.warning}</p>
                                                        </div>
                                                    )}
                                                    {section.note && (
                                                        <div className="mt-3 flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                                                            <span className="text-blue-600 mt-0.5">ℹ️</span>
                                                            <p className="text-xs text-blue-800 leading-relaxed">{section.note}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
