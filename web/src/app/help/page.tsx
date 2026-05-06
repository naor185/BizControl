"use client";

import { useState, useMemo } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";

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
};

const ARTICLES: Article[] = [
    {
        id: "calendar",
        title: "יומן תורים",
        category: "פעילות יומית",
        icon: "📅",
        content: [
            {
                text: "יומן ויזואלי לניהול כל התורים — ניתן לראות לפי יום/שבוע/חודש ולנהל הכל ממקום אחד.",
            },
            {
                heading: "יצירת תור חדש",
                steps: [
                    "לחץ על כל מקום פנוי ביומן — נפתח חלון יצירת תור.",
                    "בחר לקוח (חפש לפי שם/טלפון). לקוח חדש? לחץ 'לקוח חדש' ישירות בחלון.",
                    "בחר אמן/ית מהרשימה (חייב להיות רשום בצוות).",
                    "הכנס שם טיפול, מחיר כולל, וסכום מקדמה (אם נדרש).",
                    "שמור — המערכת שולחת הודעת וואטסאפ אוטומטית ללקוח.",
                ],
                tip: "אם סכום המקדמה > 0, נשלחת אוטומטית הודעת בקשת תשלום עם לינקי ביט/פייבוקס/בנק.",
            },
            {
                heading: "גרירת תור לשעה/תאריך אחר",
                steps: [
                    "גרור את בלוק התור ביומן למיקום החדש (drag & drop).",
                    "המערכת שולחת הודעת 'תור עודכן' ללקוח אוטומטית.",
                ],
            },
            {
                heading: "אישור קבלת מקדמה",
                steps: [
                    "לחץ על התור ← לחץ 'אשר מקדמה ✅'.",
                    "המערכת שולחת ללקוח הודעה עם כל פרטי התור (כתובת, ניווט, תיק עבודות, מדיניות ביטולים).",
                ],
                tip: "לאחר אישור המקדמה הכתובת, המפה ותיק העבודות נשלחים אוטומטית מהגדרות המדיניות.",
            },
            {
                heading: "סימון תור כהסתיים",
                steps: [
                    "לחץ על התור ← לחץ 'סמן כהסתיים ✅'.",
                    "המערכת מוסיפה נקודות נאמנות ללקוח ושולחת הודעת Aftercare אחרי עיכוב שהוגדר.",
                ],
            },
            {
                heading: "תצוגות יומן",
                table: [
                    { col1: "יומי", col2: "לחץ 'יום' בפינה הימנית העליונה" },
                    { col1: "שבועי", col2: "לחץ 'שבוע'" },
                    { col1: "חודשי", col2: "לחץ 'חודש'" },
                    { col1: "סינון לפי אמן/ית", col2: "בחר שם מהרשימה מעל היומן" },
                ],
            },
        ],
    },
    {
        id: "dashboard",
        title: "לוח בקרה",
        category: "פעילות יומית",
        icon: "📊",
        content: [
            {
                text: "מסך ראשי של היום — כל מה שצריך לדעת ולעשות עכשיו: תורים, תשלומים, חברי מועדון.",
            },
            {
                heading: "קלפי KPI",
                table: [
                    { col1: "תורים היום", col2: "כמה תורים מתוכננים להיום" },
                    { col1: "חברי מועדון", col2: "כמה לקוחות פעילים במועדון" },
                    { col1: "הודעות ממתינות", col2: "הודעות אוטומטיות שעדיין לא נשלחו" },
                    { col1: "ממתין לאישור", col2: "לקוח אמר ששילם — ממתין לאימות שלך" },
                ],
            },
            {
                heading: "רישום תשלום ידני",
                steps: [
                    "לחץ '💳 גבה' ליד תור ברשימה.",
                    "בחר שיטת תשלום: מזומן / כרטיס / ביט / פייבוקס / העברה.",
                    "לחץ 'שמור'.",
                ],
            },
            {
                heading: "אימות תשלום מקוון (ביט/פייבוקס)",
                steps: [
                    "לחץ 'אמת תשלום ✅' ליד תור עם סטטוס 'ממתין לאישור'.",
                    "אשר שהכסף הגיע בפועל.",
                    "המערכת שולחת הודעת פרטי תור מלאה ללקוח.",
                ],
            },
            {
                heading: "יעד חודשי",
                steps: [
                    "לחץ על 'יעד חודשי' בפינה.",
                    "הכנס סכום יעד בשקלים.",
                    "הפס הירוק מציג כמה כבר הושג מהיעד.",
                ],
            },
        ],
    },
    {
        id: "clients",
        title: "לקוחות",
        category: "פעילות יומית",
        icon: "👥",
        content: [
            {
                text: "מאגר כל לקוחות הסטודיו עם פילטרים, חיפוש, וניהול קל.",
            },
            {
                heading: "הוספת לקוח חדש",
                steps: [
                    "לחץ 'הוסף לקוח +' (ימין עליון).",
                    "מלא שם מלא (חובה), טלפון, מייל, תאריך לידה.",
                    "סמן 'הסכמה לשיווק' — חובה לשליחת הודעות שיווקיות.",
                    "שמור.",
                ],
                tip: "תאריך לידה חשוב! המערכת שולחת הודעת יום הולדת אוטומטית ביום ההולדת.",
            },
            {
                heading: "פילטרים",
                table: [
                    { col1: "כולם", col2: "כל הלקוחות" },
                    { col1: "רגילים", col2: "לקוחות שאינם חברי מועדון" },
                    { col1: "חברי מועדון 👑", col2: "נרשמו דרך דף הנחיתה" },
                    { col1: "לפי חודש יום הולדת", col2: "לחץ על שם החודש — מציג לקוחות יום הולדת" },
                ],
                tip: "השתמש בפילטר חודש יום הולדת כדי לשלוח הצעות מיוחדות ללקוחות הנכונים.",
            },
            {
                heading: "כרטיס לקוח מלא",
                steps: [
                    "לחץ על שם הלקוח — עובר לכרטיס CRM המלא.",
                    "בכרטיס: פרטים, נקודות נאמנות, היסטוריית תורים, תשלומים, הודעות שנשלחו.",
                ],
            },
            {
                heading: "מימוש נקודות",
                steps: [
                    "כנס לכרטיס הלקוח.",
                    "לחץ 'מש נקודות'.",
                    "הכנס כמה נקודות לממש.",
                    "המערכת מחשבת הנחה ושולחת הודעת וואטסאפ.",
                ],
            },
        ],
    },
    {
        id: "inbox",
        title: "תיבת הודעות",
        category: "פעילות יומית",
        icon: "💬",
        content: [
            {
                text: "תיבת דואר נכנס של וואטסאפ — כל הודעה שלקוח שלח חזרה אליך מופיעה כאן. ניתן לקרוא ולענות ישירות.",
            },
            {
                heading: "קריאה ומענה",
                steps: [
                    "לחץ על שיחה ברשימה השמאלית.",
                    "קרא את היסטוריית ההודעות.",
                    "כתוב בשדה הטקסט התחתון.",
                    "Enter לשליחה, Shift+Enter לשורה חדשה.",
                ],
            },
            {
                heading: "מעבר לפרופיל לקוח",
                steps: [
                    "בתוך שיחה פתוחה — לחץ 'צפה בפרופיל לקוח ←' בחלק העליון.",
                ],
            },
            {
                heading: "עדכון אוטומטי",
                table: [
                    { col1: "רשימת שיחות", col2: "מתרעננת כל 15 שניות" },
                    { col1: "הודעות בשיחה פתוחה", col2: "מתרעננות כל 10 שניות" },
                    { col1: "עיגול אדום בסרגל", col2: "מספר הודעות שלא נקראו — מתעדכן כל 30 שניות" },
                ],
            },
            {
                heading: "תנאים לפעולה תקינה",
                warning: "חייב לקנפג ספק וואטסאפ (Green API או Meta) בהגדרות → לשונית אינטגרציות. ללא חיבור — הודעות נכנסות לא יגיעו.",
            },
        ],
    },
    {
        id: "expenses",
        title: "ניהול עסק",
        category: "פיננסים",
        icon: "💼",
        content: [
            {
                text: "ניהול פיננסי מלא — הוצאות, הכנסות, חישובי מס, וייצוא לרואה חשבון.",
            },
            {
                heading: "הוספת הוצאה ידנית",
                steps: [
                    "לחץ 'הוסף הוצאה +'.",
                    "מלא: שם הוצאה, ספק, מספר חשבונית (אופציונלי), קטגוריה, סכום, מע\"מ, תאריך.",
                    "שמור.",
                ],
            },
            {
                heading: "סריקת חשבונית עם AI 📸",
                steps: [
                    "לחץ 'סרוק חשבונית 📷'.",
                    "צלם או העלה תמונת חשבונית/קבלה.",
                    "ה-AI מזהה אוטומטית: שם, ספק, סכום, מע\"מ, תאריך.",
                    "בדוק את הנתונים ואשר.",
                ],
                tip: "חוסך זמן — פשוט צלם את הקבלה במקום להזין ידנית.",
            },
            {
                heading: "סיכום חודשי",
                table: [
                    { col1: "הכנסות ברוטו", col2: "כל התשלומים שנרשמו בחודש" },
                    { col1: "מע\"מ להחזר", col2: "מע\"מ על הוצאות" },
                    { col1: "מע\"מ לתשלום", col2: "מע\"מ הכנסות פחות החזר" },
                    { col1: "מס הכנסה משוער", col2: "לפי האחוז בהגדרות" },
                    { col1: "הכנסה נטו", col2: "אחרי כל הניכויים" },
                ],
            },
            {
                heading: "ייצוא לאקסל (לרואה חשבון)",
                steps: [
                    "לחץ 'ייצא לאקסל 📊'.",
                    "בחר טווח תאריכים.",
                    "קובץ xlsx יורד אוטומטית — כולל הוצאות, הכנסות, חישובי מע\"מ.",
                ],
            },
        ],
    },
    {
        id: "products",
        title: "מוצרים ומלאי",
        category: "פיננסים",
        icon: "📦",
        content: [
            {
                text: "ניהול מלאי המוצרים שאתה מוכר בסטודיו — תכשיטים, קרמים, ציוד ועוד.",
            },
            {
                heading: "הוספת מוצר",
                steps: [
                    "לחץ 'הוסף מוצר +'.",
                    "מלא שם, תיאור (אופציונלי), קטגוריה, מחיר, כמות במלאי.",
                    "שמור.",
                ],
            },
            {
                heading: "רישום מכירה",
                steps: [
                    "לחץ 'מכור' על המוצר הרצוי.",
                    "הכנס כמות.",
                    "המלאי מתעדכן אוטומטית ונרשמת מכירה.",
                ],
            },
            {
                heading: "היסטוריית מכירות",
                steps: [
                    "לחץ 'היסטוריה' על המוצר.",
                    "מציג: תאריך, מוכר, כמות, סכום.",
                ],
            },
        ],
    },
    {
        id: "team",
        title: "צוות ומקעקעים",
        category: "ניהול צוות",
        icon: "🎨",
        content: [
            {
                text: "ניהול חברי הצוות — מקעקעים, פירסרים, עובדים. כל אחד מקבל כניסה, צבע ביומן, ושיטת שכר.",
            },
            {
                heading: "הוספת חבר צוות",
                steps: [
                    "לחץ 'הוסף חבר צוות +'.",
                    "מלא שם, מייל, סיסמה ראשונית.",
                    "בחר תפקיד: מקעקע / פירסר / מנהל.",
                    "בחר צבע ביומן (לחץ על הריבוע הצבעוני).",
                    "בחר שיטת שכר: ללא / שעתי (₪/שעה) / עמלה (%).",
                    "שמור.",
                ],
            },
            {
                heading: "שיטות שכר",
                table: [
                    { col1: "ללא שכר", col2: "לא נכנס לחישובי שכר" },
                    { col1: "שעתי", col2: "הכנס תעריף לשעה — מחושב לפי שעות שנרשמו" },
                    { col1: "עמלה (%)", col2: "הכנס אחוז מכל תור שלו" },
                ],
            },
            {
                heading: "השבתת / מחיקת עובד",
                steps: [
                    "השבתה: לחץ 'השבת' — עדיין מופיע בהיסטוריה, אך לא זמין לתורים חדשים.",
                    "מחיקה: לחץ 🗑️ — לא ניתן למחוק את בעל החשבון.",
                ],
            },
        ],
    },
    {
        id: "payroll",
        title: "דוחות שכר",
        category: "ניהול צוות",
        icon: "💰",
        content: [
            {
                text: "חישוב שכר חודשי לכל חבר צוות לפי שיטת השכר שהוגדרה.",
            },
            {
                heading: "צפייה בדוח",
                steps: [
                    "בחר חודש ושנה בחלק העליון.",
                    "הדוח מתעדכן אוטומטית.",
                ],
            },
            {
                heading: "מה מחושב",
                table: [
                    { col1: "שכר שעתי", col2: "שעות עבודה × תעריף שעתי" },
                    { col1: "עמלות", col2: "סה\"כ הכנסות מתוריו × אחוז העמלה" },
                    { col1: "סה\"כ לתשלום", col2: "שכר שעתי + עמלות" },
                ],
                warning: "שעות עבודה חייבות להירשם במערכת (WorkSession). אם לא נרשמו שעות — השכר השעתי יהיה 0.",
            },
        ],
    },
    {
        id: "message-log",
        title: "יומן הודעות",
        category: "פעילות יומית",
        icon: "📋",
        content: [
            {
                text: "רשימת כל ההודעות האוטומטיות שהמערכת שלחה או מנסה לשלוח — מאפשר לראות שגיאות ולתקן.",
            },
            {
                heading: "סטטוסים",
                table: [
                    { col1: "ממתין", col2: "הודעה בתור, עדיין לא נשלחה" },
                    { col1: "נשלח ✅", col2: "נשלחה בהצלחה" },
                    { col1: "נכשל ❌", col2: "ניסיון שליחה נכשל — ניתן לנסות שנית" },
                ],
            },
            {
                heading: "פעולות",
                steps: [
                    "הודעה שנכשלה ← לחץ 'נסה שנית 🔄'.",
                    "הודעה ממתינה שלא צריך ← לחץ 'בטל ✕'.",
                ],
            },
            {
                heading: "מה לבדוק כשהודעות נכשלות",
                steps: [
                    "האם ספק הוואטסאפ מוגדר נכון? (הגדרות → אינטגרציות)",
                    "האם ה-Instance פעיל ב-green-api.com? (אייקון ירוק)",
                    "האם מספר הלקוח נכון?",
                    "האם הטוקן/מפתח לא פג תוקף?",
                ],
            },
        ],
    },
    {
        id: "payments",
        title: "תשלומים",
        category: "פיננסים",
        icon: "💳",
        content: [
            {
                text: "היסטוריה מלאה של כל התשלומים, מסוכמים לפי חודש ושיטת תשלום.",
            },
            {
                heading: "פילטרים",
                table: [
                    { col1: "חודש/שנה", col2: "בחר בחלק העליון" },
                    { col1: "שיטת תשלום", col2: "הכל / מזומן / כרטיס / ביט / פייבוקס / העברה" },
                ],
            },
            {
                heading: "מחיקת תשלום",
                steps: [
                    "לחץ 🗑️ ← אישור מחיקה.",
                ],
                warning: "מחיקת תשלום מחזירה נקודות קאשבק אם ניתנו ללקוח.",
            },
        ],
    },
    {
        id: "settings-branding",
        title: "הגדרות — מיתוג ועיצוב",
        category: "הגדרות",
        icon: "🎨",
        content: [
            {
                heading: "לוגו",
                steps: [
                    "הגדרות → לשונית 'מיתוג ועיצוב'.",
                    "לחץ 'בחר קובץ לוגו'.",
                    "בחר קובץ PNG שקוף (מומלץ, לפחות 400×400 פיקסל).",
                    "נשמר אוטומטית.",
                ],
                tip: "הלוגו מופיע בממשק ההתחברות ובדפי הנחיתה שהלקוחות רואים.",
            },
        ],
    },
    {
        id: "settings-landing",
        title: "הגדרות — דפי נחיתה",
        category: "הגדרות",
        icon: "🚀",
        content: [
            {
                text: "הגדרת דף ההרשמה שהלקוחות רואים כשהם מצטרפים למועדון.",
            },
            {
                heading: "AI מחולל עיצוב ✨",
                steps: [
                    "הגדרות → 'דפי נחיתה'.",
                    "כתוב תיאור עסק בשדה (לדוגמה: 'סטודיו קעקועים בוטיק, אווירה אפלה ואקסקלוסיבית').",
                    "לחץ 'צור עיצוב'.",
                    "הצבעים, הכותרת והתיאור מתמלאים אוטומטית.",
                    "שמור.",
                ],
                warning: "מכסה: 3 שימושים בחודש בלבד (מתאפס ב-1 לחודש).",
            },
            {
                heading: "הגדרת דף ידנית",
                steps: [
                    "הגדר צבע ראשי ומשני (לחץ על ריבוע הצבע).",
                    "כתוב כותרת ותיאור.",
                    "בחר גופן (Heebo מומלץ לעברית).",
                    "העלה תמונת רקע (1920×1080 מומלץ).",
                    "העלה עד 3 תמונות גלריה (ריבועיות, 800×800+).",
                    "בחר תבנית עיצוב.",
                    "שמור.",
                ],
                tip: "לינק דף הנחיתה: [הדומיין שלך]/join/[מזהה הסטודיו]. שים אותו בביו של האינסטגרם!",
            },
        ],
    },
    {
        id: "settings-messages",
        title: "הגדרות — הודעות אוטומטיות",
        category: "הגדרות",
        icon: "📩",
        content: [
            {
                text: "כל ההודעות נשלחות אוטומטית — אין צורך לשלוח ידנית. ניתן להתאים את תוכן כל הודעה.",
            },
            {
                heading: "הודעות קיימות",
                table: [
                    { col1: "אישור תור", col2: "מיד כשנוצר תור ללא מקדמה" },
                    { col1: "בקשת מקדמה", col2: "מיד כשנוצר תור עם מקדמה > 0" },
                    { col1: "אישור מקדמה + פרטים", col2: "אחרי שבעל העסק מאשר מקדמה" },
                    { col1: "תזכורת", col2: "יום לפני התור" },
                    { col1: "Aftercare", col2: "X דקות אחרי סיום תור" },
                    { col1: "שינוי תור", col2: "כשמשנים תאריך/שעה" },
                    { col1: "ביטול תור", col2: "כשמבטלים תור" },
                    { col1: "ברוכים הבאים למועדון", col2: "כשלקוח נרשם דרך דף הנחיתה" },
                    { col1: "אחרי תשלום", col2: "אחרי אישור תשלום ידני" },
                    { col1: "יום הולדת", col2: "ביום ההולדת של הלקוח" },
                    { col1: "לקוח שאינו חבר", col2: "הזמנה להצטרף למועדון" },
                    { col1: "מימוש נקודות", col2: "אחרי מימוש נקודות" },
                ],
            },
            {
                heading: "משתנים (placeholders)",
                table: [
                    { col1: "{client_name}", col2: "שם הלקוח" },
                    { col1: "{appointment_date}", col2: "תאריך התור" },
                    { col1: "{appointment_time}", col2: "שעת התור" },
                    { col1: "{appointment_title}", col2: "שם הטיפול" },
                    { col1: "{artist_name}", col2: "שם האמן/ית" },
                    { col1: "{deposit_amount}", col2: "סכום מקדמה בש\"ח" },
                    { col1: "{bit_link}", col2: "לינק תשלום ביט" },
                    { col1: "{paybox_link}", col2: "לינק תשלום פייבוקס" },
                    { col1: "{bank_details}", col2: "פרטי העברה בנקאית" },
                    { col1: "{studio_address}", col2: "כתובת הסטודיו" },
                    { col1: "{map_link}", col2: "לינק ניווט" },
                    { col1: "{portfolio_link}", col2: "לינק תיק עבודות" },
                    { col1: "{join_link}", col2: "לינק הצטרפות למועדון" },
                    { col1: "{loyalty_points}", col2: "יתרת נקודות הלקוח" },
                    { col1: "{cancellation_free_days}", col2: "ימי ביטול חינמי" },
                    { col1: "{deposit_lock_days}", col2: "ימי נעילת מקדמה" },
                ],
                tip: "לחץ על כפתור המשתנה בממשק ← מועתק אוטומטית ← הדבק בהודעה.",
            },
        ],
    },
    {
        id: "settings-policy",
        title: "הגדרות — מדיניות וכתובת",
        category: "הגדרות",
        icon: "📋",
        content: [
            {
                heading: "כתובת הסטודיו",
                text: "הכתובת הפיזית — נכנסת ל-{studio_address} בהודעות. לדוגמה: 'רחוב הרצל 45, קומה 2, תל אביב'.",
            },
            {
                heading: "לינק ניווט — איך מוצאים",
                steps: [
                    "פתח maps.google.com בדפדפן.",
                    "חפש את כתובת הסטודיו.",
                    "לחץ 'שתף' (Share) ← 'העתק קישור'.",
                    "הדבק את הלינק בשדה.",
                ],
            },
            {
                heading: "לינק תיק עבודות",
                table: [
                    { col1: "אינסטגרם", col2: "instagram.com/שם_המשתמש_שלך" },
                    { col1: "לינקטר", col2: "linktr.ee/שם_שלך" },
                    { col1: "אתר", col2: "כתובת האתר שלך" },
                ],
            },
            {
                heading: "פרטי בנק — איפה מוצאים",
                steps: [
                    "שיק ביטול — בחלק התחתון יש שם בנק, סניף ומספר חשבון.",
                    "אפליקציית הבנק ← 'פרטי חשבון'.",
                    "פנקס שיקים — בחלק התחתון של כל שיק.",
                ],
                tip: "הפרטים מתחברים אוטומטית לפורמט: 'שם_בנק | סניף X | חשבון Y' בהודעות.",
            },
            {
                heading: "מדיניות ביטולים",
                table: [
                    { col1: "ימי ביטול חינמי", col2: "כמה ימים לפני התור ניתן לבטל ולקבל החזר מלא (ברירת מחדל: 7)" },
                    { col1: "ימי נעילת מקדמה", col2: "כמה ימים לפני ניתן לשנות תור בלי לאבד מקדמה (ברירת מחדל: 7)" },
                ],
            },
        ],
    },
    {
        id: "settings-automation",
        title: "הגדרות — חוקים ואוטומציה",
        category: "הגדרות",
        icon: "⚙️",
        content: [
            {
                heading: "נקודות נאמנות",
                table: [
                    { col1: "נקודות לכל תור", col2: "נקודות שהלקוח מקבל אחרי כל ביקור (ברירת מחדל: 10)" },
                    { col1: "נקודות בהרשמה", col2: "נקודות מתנה לחברי מועדון חדשים (ברירת מחדל: 50)" },
                    { col1: "% קאשבק מתשלום", col2: "אחוז מכל תשלום שמתווסף כנקודות (ברירת מחדל: 5%)" },
                    { col1: "הטבת יום הולדת", col2: "אחוז הנחה ביום ההולדת (ברירת מחדל: 10%)" },
                ],
            },
            {
                heading: "Aftercare — עיכוב הודעה",
                text: "מספר הדקות אחרי שעת התור שאחריהן נשלחת הודעת הטיפול. ברירת מחדל: 30 דקות. המלצה: 60–120 דקות.",
            },
            {
                heading: "שעות יומן",
                text: "שעת פתיחה וסגירה ביומן (ברירת מחדל: 08:00–23:00). לא מונע תורים מחוץ לשעות — רק קובע תצוגה.",
            },
        ],
    },
    {
        id: "settings-finance",
        title: "הגדרות — תשלומים ופיננסים",
        category: "הגדרות",
        icon: "💰",
        content: [
            {
                heading: "לינק ביט — איך מוצאים",
                steps: [
                    "פתח אפליקציית ביט.",
                    "לחץ על התמונה שלך (פרופיל).",
                    "לחץ 'שתף פרופיל' / 'הלינק שלי'.",
                    "העתק את הלינק.",
                ],
                tip: "הלינק נכנס ל-{bit_link} בהודעת בקשת מקדמה.",
            },
            {
                heading: "לינק פייבוקס — איך מוצאים",
                steps: [
                    "פתח אפליקציית Paybox.",
                    "לחץ על הלוגו/פרופיל שלך.",
                    "לחץ 'שתף' / 'הלינק שלי'.",
                    "העתק את הלינק.",
                ],
            },
            {
                heading: "אחוזי מס (לחישובים בדוחות)",
                table: [
                    { col1: "מע\"מ", col2: "17% (ישראל)" },
                    { col1: "מס הכנסה", col2: "10% (ברירת מחדל)" },
                    { col1: "ביטוח לאומי", col2: "5% (ברירת מחדל)" },
                ],
                warning: "אלו הערכות בלבד. ייעץ עם רואה חשבון לחישוב מדויק.",
            },
        ],
    },
    {
        id: "settings-whatsapp",
        title: "חיבור וואטסאפ — Green API",
        category: "חיבורים חיצוניים",
        icon: "📱",
        content: [
            {
                text: "Green API מאפשרת לשלוח וואטסאפ מהמספר הקיים שלך על ידי סריקת QR. עלות: ~50 ₪/חודש.",
            },
            {
                heading: "הגדרה שלב אחר שלב",
                steps: [
                    "כנס לאתר green-api.com ← צור חשבון.",
                    "לחץ 'Create Instance' ← בחר תוכנית.",
                    "בתוך ה-Instance ← לחץ 'Scan QR'.",
                    "פתח וואטסאפ בטלפון ← ⋮ → מכשירים מקושרים → קשר מכשיר ← סרוק את ה-QR.",
                    "Instance ID — מופיע בדף ה-Instance (מספר).",
                    "API Token — לחץ 'Show Token' ← העתק.",
                    "הכנס Instance ID + Token בהגדרות BizControl ← שמור.",
                    "בהגדרות: העתק כתובת Webhook (תיבה כתומה).",
                    "כנס ל-green-api.com → Instance → Settings → Webhooks ← הדבק שם.",
                ],
                tip: "ה-Instance חייב להיות ירוק (פעיל). אם כבה — סרוק QR מחדש.",
            },
        ],
    },
    {
        id: "settings-meta",
        title: "חיבור וואטסאפ — Meta Cloud API",
        category: "חיבורים חיצוניים",
        icon: "🔵",
        content: [
            {
                text: "Meta Cloud API מאפשרת 1,000 הודעות חינם בחודש. דורש מספר טלפון נפרד שאינו מחובר לאפליקציית וואטסאפ.",
            },
            {
                heading: "הגדרה שלב אחר שלב",
                steps: [
                    "כנס ל-developers.facebook.com ← 'My Apps' ← 'Create App'.",
                    "בחר 'Business' ← מלא שם ← 'Create App'.",
                    "חפש 'WhatsApp' בלוח הבקרה ← 'Set Up'.",
                    "Phone Number ID — מופיע בלשונית 'API Setup' ← העתק.",
                    "Access Token קבוע: Business Settings → System Users → Create System User (Admin) ← 'Generate Token' ← בחר אפליקציה ← הרשאה whatsapp_business_messaging ← Generate ← העתק.",
                    "הכנס Phone Number ID + Token בהגדרות ← שמור.",
                    "העתק Webhook URL מהתיבה הכחולה בהגדרות.",
                    "ב-Meta Developers → WhatsApp → Configuration → Webhook → Edit.",
                    "הכנס Callback URL (מהתיבה הכחולה) + Verify Token: bizcontrol_verify.",
                    "לחץ 'Verify and Save' ← תחת Webhook Fields הפעל: messages.",
                ],
                warning: "דורש מספר טלפון שאינו מחובר לאפליקציית וואטסאפ (SIM נפרד / eSIM).",
            },
        ],
    },
    {
        id: "settings-smtp",
        title: "חיבור מייל (SMTP)",
        category: "חיבורים חיצוניים",
        icon: "📧",
        content: [
            {
                heading: "הגדרות Gmail",
                table: [
                    { col1: "SMTP Host", col2: "smtp.gmail.com" },
                    { col1: "SMTP Port", col2: "587" },
                    { col1: "SMTP User", col2: "כתובת הג'ימייל שלך" },
                    { col1: "SMTP Password", col2: "App Password (לא הסיסמה הרגילה!)" },
                    { col1: "From Email", col2: "כתובת הג'ימייל שלך" },
                ],
            },
            {
                heading: "יצירת App Password בגוגל",
                steps: [
                    "כנס ל-myaccount.google.com/security.",
                    "ודא שאימות דו-שלבי (2FA) מופעל.",
                    "חפש 'App Passwords'.",
                    "בחר 'Other (Custom Name)' ← כתוב 'BizControl' ← Generate.",
                    "הסיסמה שמופיעה (16 תווים) — זו הסיסמה להכניס ב-SMTP Password.",
                ],
                warning: "יש להשתמש ב-App Password ולא בסיסמה הרגילה של גוגל. Gmail חוסם כניסה ישירה.",
            },
            {
                heading: "הגדרות Outlook / Office365",
                table: [
                    { col1: "SMTP Host", col2: "smtp.office365.com" },
                    { col1: "SMTP Port", col2: "587" },
                    { col1: "SMTP User", col2: "כתובת המייל שלך" },
                    { col1: "SMTP Password", col2: "הסיסמה הרגילה" },
                ],
            },
            {
                heading: "בדיקת חיבור",
                steps: [
                    "שמור את הגדרות SMTP.",
                    "לחץ 'שלח מייל בדיקה 📧'.",
                    "הכנס כתובת מייל לבדיקה.",
                    "אם הגיע — הכל עובד.",
                ],
            },
        ],
    },
    {
        id: "settings-google",
        title: "חיבור Google Calendar",
        category: "חיבורים חיצוניים",
        icon: "📆",
        content: [
            {
                text: "כל תור שנוצר/עודכן/בוטל ב-BizControl מסתנכרן אוטומטית ליומן Google שלך.",
            },
            {
                heading: "הגדרה שלב אחר שלב",
                steps: [
                    "כנס ל-console.cloud.google.com.",
                    "לחץ 'New Project' ← תן שם ← 'Create'.",
                    "APIs & Services ← Library ← חפש 'Google Calendar API' ← Enable.",
                    "Credentials ← Create Credentials ← OAuth 2.0 Client ID.",
                    "Application Type: Web Application.",
                    "Authorized redirect URIs: http://localhost:3000/api/auth/google/callback (ולאחר העלייה לאוויר — הדומיין הסופי).",
                    "Create ← קבל Client ID ו-Client Secret.",
                    "הכנס Client ID + Client Secret בהגדרות BizControl ← שמור.",
                    "לחץ 'חבר יומן Google' ← התחבר עם חשבון Google ← אשר הרשאות.",
                ],
                tip: "לאחר חיבור מוצלח יופיע '✅ יומן גוגל מחובר'. אם נתקעת — נתק וחבר מחדש.",
            },
        ],
    },
    {
        id: "landing-page",
        title: "דף הצטרפות לקוח (ציבורי)",
        category: "ציבורי",
        icon: "🌐",
        content: [
            {
                text: "דף ציבורי שהלקוח ממלא כדי להצטרף למועדון. לינק: [הדומיין שלך]/join/[מזהה הסטודיו].",
            },
            {
                heading: "מה הלקוח ממלא",
                table: [
                    { col1: "שם מלא", col2: "חובה" },
                    { col1: "טלפון", col2: "חובה" },
                    { col1: "מייל", col2: "אופציונלי" },
                    { col1: "תאריך לידה", col2: "לתזכורת יום הולדת" },
                    { col1: "הסכמה לשיווק", col2: "נדרש לחוק" },
                ],
            },
            {
                heading: "מה קורה אחרי הרשמה",
                steps: [
                    "לקוח נוצר במערכת (או מעודכן אם קיים לפי טלפון).",
                    "מסומן כחבר מועדון 👑.",
                    "מקבל נקודות הצטרפות.",
                    "מקבל הודעת וואטסאפ 'ברוכים הבאים'.",
                ],
                tip: "שים את הלינק בביו של האינסטגרם, בסטורי, ובQR על הקיר בסטודיו!",
            },
        ],
    },
    {
        id: "deposit-page",
        title: "דף תשלום מקדמה (ציבורי)",
        category: "ציבורי",
        icon: "💸",
        content: [
            {
                text: "דף ציבורי שנשלח ללקוח בהודעת וואטסאפ לאחר קביעת תור עם מקדמה.",
            },
            {
                heading: "תהליך",
                steps: [
                    "נוצר תור עם מקדמה ← הלקוח מקבל הודעת וואטסאפ עם לינק.",
                    "הלקוח פותח את הלינק ← רואה פרטי תור וסכום מקדמה.",
                    "הלקוח משלם דרך ביט/פייבוקס (לינקים שהוגדרו בהגדרות).",
                    "הלקוח לוחץ 'אישרתי ששלחתי' ← מוסיף הערה.",
                    "הסטטוס ב-BizControl ← 'ממתין לאישור'.",
                    "בעל הסטודיו מאמת בלוח הבקרה ← לחץ 'אמת תשלום ✅'.",
                    "המערכת שולחת ללקוח הודעה עם כל פרטי התור.",
                ],
            },
        ],
    },
];

const CATEGORIES = ["הכל", "פעילות יומית", "פיננסים", "ניהול צוות", "הגדרות", "חיבורים חיצוניים", "ציבורי"];

export default function HelpPage() {
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState("הכל");
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
                    ...(s.steps || []),
                    ...(s.table || []).flatMap(r => [r.col1, r.col2]),
                ])
            ].join(" ").toLowerCase();
            return haystack.includes(q);
        });
    }, [search, category]);

    return (
        <RequireAuth>
            <AppShell title="מרכז עזרה">
                <div className="max-w-5xl mx-auto pb-16">

                    {/* Header */}
                    <div className="mb-8 text-center">
                        <div className="text-5xl mb-4">🆘</div>
                        <h1 className="text-3xl font-bold text-slate-800">מרכז עזרה</h1>
                        <p className="text-slate-500 mt-2">מדריך מלא לכל פיצ'ר, חיבור וקיצור דרך במערכת</p>
                    </div>

                    {/* Search */}
                    <div className="relative mb-6">
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">🔍</span>
                        <input
                            type="text"
                            value={search}
                            onChange={e => { setSearch(e.target.value); setOpenId(null); }}
                            placeholder="חפש פיצ'ר, הגדרה, חיבור..."
                            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 pr-11 text-sm outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch("")}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
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
                                        ? "bg-slate-900 text-white"
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
                            נמצאו {filtered.length} תוצאות עבור &ldquo;{search}&rdquo;
                        </p>
                    )}

                    {/* Articles */}
                    {filtered.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <div className="text-4xl mb-3">🔍</div>
                            <p className="font-medium">לא נמצאו תוצאות</p>
                            <p className="text-sm mt-1">נסה מילת חיפוש אחרת</p>
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
                                        className="w-full flex items-center justify-between px-6 py-4 text-right hover:bg-slate-50 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">{article.icon}</span>
                                            <div className="text-right">
                                                <div className="font-bold text-slate-800 text-sm">{article.title}</div>
                                                <div className="text-xs text-slate-400 mt-0.5">{article.category}</div>
                                            </div>
                                        </div>
                                        <span className="text-slate-400 text-xs ml-2">
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
                                                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center font-bold mt-0.5">
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
                                                                            <td className="px-4 py-2.5 font-medium text-slate-700 w-1/3 border-l border-slate-100 font-mono text-xs">
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
