"""A business that works in English talks to its clients in English (the owner, 2026-10-20: "the whole system in
English"). The system's own messages — confirmations, reminders, deposits, receipts, the club, birthdays, the wait
list, booking requests, the health form link, gift cards, classes — are written in Hebrew where they are built; just
before one goes out (services/message_worker.process_due_jobs) it is said in the business's language, line by line
(a WhatsApp message) or text by text between the tags (an e-mail).

Only the system's own lines are known here: what the owner wrote stays exactly as written — an English business
writes its own texts in English. A line with a name, a date or an amount inside is matched by a pattern ({} where a
value goes); a value that is itself a known line (a day name, "today is your birthday!") is said in English too."""
from __future__ import annotations

import re

HEB = re.compile(r"[֐-׿]")

# whole lines (or texts between e-mail tags), as the system writes them
LINES: dict[str, str] = {
    # ── days, months, little words that fill a pattern ──
    "ראשון": "Sunday", "שני": "Monday", "שלישי": "Tuesday", "רביעי": "Wednesday", "חמישי": "Thursday",
    "שישי": "Friday", "שבת": "Saturday",
    "ינואר": "January", "פברואר": "February", "מרץ": "March", "אפריל": "April", "מאי": "May", "יוני": "June",
    "יולי": "July", "אוגוסט": "August", "ספטמבר": "September", "אוקטובר": "October", "נובמבר": "November",
    "דצמבר": "December",
    "מחר": "tomorrow", "היום": "today", "בעוד שבוע": "in a week", "בעוד 3 ימים": "in 3 days",
    "בעוד שעתיים": "in two hours", "בקרוב": "soon",
    "נותן/ת השירות": "Service provider", "הצוות": "the team", "המועדון שלנו": "our club", "העסק": "the business",
    "נעצר": "was stopped", "בוטל": "was canceled", "הקפאה": "a freeze", "עצירה": "a stop",

    # ── a new appointment ──
    "התור שלך נקבע בהצלחה ✅": "Your appointment is booked ✅",
    "התור שלך ל-": "Your appointment for",
    "נקבע.": "is booked.",
    "תאריך:": "Date:", "שעה:": "Time:", "📅 תאריך:": "📅 Date:", "📍 כתובת:": "📍 Address:", "📋 שירות:": "📋 Service:",
    "🕐 שעה:": "🕐 Time:", "🗺️ ניווט:": "🗺️ Directions:", "מתי?": "When?",
    "נשמח לראותך! 🙏": "We look forward to seeing you! 🙏", "נשמח לראותך!": "We look forward to seeing you!",
    "נשמח לראותך בקרוב!": "Hope to see you soon!",
    "הודעה זו נשלחה אוטומטית ממערכת BizControl.": "This message was sent automatically by BizControl.",
    "לתשלום לחצו כאן": "Click here to pay", "לתשלום לחץ כאן": "Click here to pay",
    "— אחרי התשלום לחצו שם על \"שילמתי\" וצרפו צילום של התשלום, ונאשר את התור.":
        "— after paying, tap \"I've paid\" there and attach a picture of the payment, and we'll confirm the appointment.",
    "🗺️ הגעה בוויז/גוגל מפות": "🗺️ Directions with Waze / Google Maps",
    "🗺️ ניווט למיקום": "🗺️ Directions",
    "לחץ כאן לניווט": "Click for directions",
    "אחרי התשלום לחצו שם על \"שילמתי\" וצרפו צילום של התשלום — ונאשר את התור ✅":
        "After paying, tap \"I've paid\" there and attach a picture of the payment — and we'll confirm the appointment ✅",
    "מחכים לך! 🙏": "See you soon! 🙏", "מחכים לך!": "See you soon!", "מחכים לך! 🙌": "See you soon! 🙌",
    "✅ אישור תור": "✅ Appointment confirmation",
    "התור שלך נקבע ✅": "Your appointment is booked ✅",
    "תור חדש נקבע": "New appointment booked",
    "היי! התור שלך נקבע בהצלחה. מחכים לך 😊": "Hi! Your appointment is booked. See you soon 😊",

    # ── the deposit ──
    "המקדמה אושרה! ✅": "Your deposit is approved! ✅",
    "✅ המקדמה אושרה — פרטי התור שלך": "✅ Your deposit is approved — your appointment details",
    "✅ המקדמה שלך אושרה! אנו מחכים לראותך.": "✅ Your deposit is approved! We look forward to seeing you.",
    "התור שלך מאושר ונעול:": "Your appointment is confirmed and locked:",
    "ללא תשלום המקדמה התור אינו מאושר סופית.": "Without the deposit the appointment isn't finally confirmed.",
    "ניתן לשלם דרך:": "You can pay with:",
    "אחרי העברת המקדמה שלח/י אישור ונאשר את התור.": "After sending the deposit, send us the confirmation and we'll confirm the appointment.",

    # ── a change, a cancellation ──
    "🔄 עדכון תור": "🔄 Appointment update",
    "עדכון מועד תור 🔄": "Appointment time update 🔄",
    "עודכן למועד חדש.": "was moved to a new time.",
    "תאריך חדש:": "New date:", "שעה חדשה:": "New time:",
    "אם יש שאלות — אנחנו כאן 😊": "Any questions — we're here 😊",
    "מחכים לראותך! 🙏": "Looking forward to seeing you! 🙏",
    "התור שלך עודכן 🔄": "Your appointment was updated 🔄",
    "🔄 עדכון מועד התור שלך": "🔄 Your appointment's new time",
    "היי! מועד התור שלך עודכן. מחכים לך 🙌": "Hi! Your appointment's time was updated. See you soon 🙌",
    "מצטערים, התור שלך בוטל. נשמח לקבוע תור חדש בהקדם!": "Sorry, your appointment was canceled. We'd be happy to book a new one soon!",
    "התור שלך בוטל": "Your appointment was canceled",
    "ביטול תור": "Appointment canceled",

    # ── reminders ──
    "תזכורת ידידותית — מחר יש לך תור!": "A friendly reminder — you have an appointment tomorrow!",
    "רצינו להזכיר — בעוד שבוע יש לך תור!": "Just a reminder — you have an appointment in a week!",
    "תזכורת — בעוד שלושה ימים יש לך תור!": "A reminder — you have an appointment in three days!",
    "תזכורת — היום יש לך תור!": "A reminder — you have an appointment today!",
    "תזכורת לתור מחר 📅": "Reminder: your appointment tomorrow 📅",
    "תזכורת לתור בעוד שבוע 📅": "Reminder: your appointment in a week 📅",
    "תזכורת לתור בעוד שלושה ימים 📅": "Reminder: your appointment in three days 📅",
    "רק מזכירים שיש לנו פגישה מחר —": "Just a reminder that we have an appointment tomorrow —",
    "רק מזכירים שיש תור ל-": "Just a reminder of your appointment for",
    "בעוד שבוע.": "in a week.", "בעוד שלושה ימים.": "in three days.",
    "נתראה!": "See you!",
    "תזכורת —": "A reminder —", "היום יש לך תור!": "you have an appointment today!",
    "תזכורת: יש לך תור היום ☀️": "Reminder: you have an appointment today ☀️",
    "תזכורת לתור היום ☀️": "Reminder: your appointment today ☀️",
    "תזכורת! יש לך תור מחר. מחכים לך 🕐": "Reminder! You have an appointment tomorrow. See you 🕐",

    # ── after the visit, receipts ──
    "שמחים שבחרת בנו ❤️": "So glad you chose us ❤️",
    "תודה על התשלום! 🙏": "Thank you for your payment! 🙏",
    "תודה על הביקור! 🙏": "Thanks for your visit! 🙏",
    "⭐ נשמח לביקורת שלך בגוגל!": "⭐ We'd love your review on Google!",
    "💊 הוראות טיפול": "💊 Aftercare instructions",
    "🎁 נקודות:": "🎁 Points:",
    "תודה על התשלום! שמחים שבחרת בנו ❤️": "Thank you for your payment! So glad you chose us ❤️",
    "תודה על הרכישה ❤️": "Thanks for your purchase ❤️",
    "הקישור פעיל תמיד — ניתן לשמור או להדפיס בכל עת.": "The link always works — you can save or print it anytime.",
    "🧾 צפה בקבלה": "🧾 View the receipt",
    "הקבלה שלך מוכנה 🧾": "Your receipt is ready 🧾",
    "🧾 הקבלה שלך עבור כרטיס המתנה:": "🧾 Your receipt for the gift card:",
    "🧾 הקבלה שלך עבור כרטיס המתנה": "🧾 Your receipt for the gift card",
    "תודה שבחרת בנו.": "Thanks for choosing us.",
    "אם יש לך שאלה — אנחנו כאן ונשמח לעזור.": "If you have a question — we're here and happy to help.",

    # ── the club, points ──
    "שמחים שביקרת אצלנו!": "So glad you visited us!",
    "הצטרף/י למועדון הלקוחות שלנו 🎉": "Join our client club 🎉",
    "הצטרף/י למועדון הלקוחות שלנו 🎁": "Join our client club 🎁",
    "🎁 הצטרף/י למועדון הלקוחות שלנו": "🎁 Join our client club",
    "הצטרף/י עכשיו": "Join now",
    "🎉 ברוכים הבאים למועדון!": "🎉 Welcome to the club!",
    "שמחים מאוד שהצטרפת אלינו!": "So happy you joined us!",
    "עם כל ביקור תצבור נקודות נוספות שניתן לממש להנחות ומבצעים מיוחדים.": "Every visit earns more points you can use for discounts and special offers.",
    "מחכים לראותך בקרוב! 💫": "Hope to see you soon! 💫",
    "ברוכים הבאים למועדון! 👑": "Welcome to the club! 👑",
    "שמחים שהצטרפת למועדון הלקוחות שלנו.": "So glad you joined our client club.",
    "נשמח לראותך שוב בקרוב! 💫": "Hope to see you again soon! 💫",
    "ברוך הבא למועדון! אנחנו שמחים שהצטרפת 🎉": "Welcome to the club! We're so glad you joined 🎉",
    "תודה שאתה/את חלק מהמועדון שלנו ❤️": "Thanks for being part of our club ❤️",
    "עוד לא חבר/ה במועדון?": "Not a club member yet?",
    "היום חסכת": "Today you saved",

    # ── birthdays ──
    "חודש יום ההולדת שלך הגיע!": "Your birthday month is here!",
    "עוד יומיים יום ההולדת שלך!": "Your birthday is in two days!",
    "היום יום ההולדת שלך!": "Today is your birthday!",
    "מחר יום ההולדת שלך!": "Your birthday is tomorrow!",
    "רצינו להיות הראשונים לאחל לך מכל הלב — מזל טוב! 🎉": "We wanted to be the first to wish you a very happy birthday! 🎉",
    "נשמח לחגוג איתך 🥳": "We'd love to celebrate with you 🥳",
    "הכנו לך מתנה אישית:": "We have a personal gift for you:",
    ", במיוחד בשבילך ליום המיוחד שלך ❤️": ", just for you on your special day ❤️",
    "קוד הקופון שלך:": "Your coupon code:",

    # ── the wait list, booking requests ──
    "נודיע לך בוואטסאפ כשיתפנה מקום 😊": "We'll let you know on WhatsApp when a spot opens up 😊",
    "המקום לא שמור — קבע/י מהר 📅": "The spot isn't held — book fast 📅",
    "לקביעת תור מהיר:": "Book quickly:",
    "ברגע שיתפנה מקום, תקבל הודעה מיידית.": "The moment a spot opens up, you'll get a message.",
    "לביטול הרישום שלח/י 'ביטול' בתשובה להודעה זו.": "To leave the list, reply 'cancel' to this message.",
    "✅ התור שלך אושר!": "✅ Your appointment is approved!",
    "🔗 צפה בפרטי התור שלך:": "🔗 See your appointment details:",
    "ניתן לשריין זמן אחר דרך האתר שלנו. 🙏": "You can book another time on our site. 🙏",

    # ── gift cards ──
    "כרטיס מתנה": "Gift card",
    "שווי הכרטיס": "Card value",
    "קוד המימוש שלך": "Your redemption code",
    "הצג/י את הקוד בעסק בזמן התשלום לניכוי האוטומטי מהסכום.": "Show the code at the business when paying to take it off the amount.",
    "ללא תפוגה": "no expiry",
    "🎁 תודה על הרכישה!": "🎁 Thanks for your purchase!",
    "תודה על הרכישה! 🙏": "Thanks for your purchase! 🙏",
    "מזל טוב ותודה שאת/ה חלק מהמשפחה שלנו!": "Congratulations, and thanks for being part of our family!",
    "הנמען/ת": "the recipient",

    # ── the health form ──
    "הצהרת בריאות": "Health declaration",

    # ── marketing footers, the platform's own number ──
    "🤖 הודעה אוטומטית ממערכת BizControl.": "🤖 An automatic message from BizControl.",
    "אין להשיב להודעה זו.": "Please don't reply to this message.",
    "האפליקציה שלנו": "Our app",
    "בפעם הבאה אפשר לקבוע תור בעצמך ולראות מתי יש תור פנוי — באפליקציית BizFind.": "Next time you can book yourself and see free times — in the BizFind app.",
    "באפליקציית BizFind אפשר לראות את התורים והקבלות שלך.": "In the BizFind app you can see your appointments and receipts.",
    "באפליקציית BizFind אפשר להירשם לשיעורים ולראות מתי יש מקום.": "In the BizFind app you can book classes and see when there's a spot.",
    "כחבר/ת מועדון אפשר לראות שם גם כמה נקודות יש לך, את התורים והקבלות.": "As a club member you can also see your points, appointments and receipts there.",
    "באפליקציית BizFind אפשר לראות כמה נקודות יש לך במועדון, את התורים והקבלות.": "In the BizFind app you can see your club points, appointments and receipts.",
    "הודעה מהעסק": "A message from the business",
    "להסרה מהודעות שיווקיות:": "To stop marketing messages:", "להסרה מרשימת הדיוור:": "To unsubscribe:",
    "לחץ כאן": "click here",

    # ── the field's ready-made texts (app/data/business_types — the tattoo aftercare, the generic thank-you) ──
    "לאחר סיום הקעקוע נשארים עם הניילון/מדבקה למשך כשעתיים.": "After the tattoo, keep the wrap/film on for about two hours.",
    "לאחר מכן ניתן להסיר את הניילון או המדבקה ולשטוף בעדינות עם מים פושרים וסבון.": "Then remove the wrap or film and wash gently with lukewarm water and soap.",
    "יום לאחר הקעקוע מתחילים למרוח את החמאה/המשחה פעמיים ביום - בוקר וערב למשך שלושה שבועות.": "From the day after, apply the balm/ointment twice a day — morning and evening — for three weeks.",
    "יש למרוח שכבה דקה ומאוזנת: לא יותר מדי ולא מעט מדי.": "Apply a thin, even layer: not too much and not too little.",
    "במקרים של יובש גבוה ניתן למרוח עד 3 פעמים ביום.": "If it gets very dry, you can apply it up to 3 times a day.",
    "בזמן ההחלמה:": "While it heals:",
    "❌ לא לגרד": "❌ Don't scratch",
    "❌ לא לקלף": "❌ Don't peel",
    "🚫 להימנע מבריכה, ים, ג׳קוזי וסאונה למשך שבועיים": "🚫 Avoid pools, the sea, jacuzzis and saunas for two weeks",
    "לאחר כחודש וחצי מומלץ להגיע לביקורת כדי לוודא החלמה מלאה של הקעקוע. 🙏": "After about six weeks, come in for a check-up to make sure the tattoo healed fully. 🙏",

    # ── the subscription's e-mails to the owner (services/plan_alert_service) ──
    "המערכת — יומן, לקוחות, תשלומים והגדרות — תיחסם, ותוצג רק הודעה על סיום המנוי.":
        "The system — calendar, clients, payments and settings — will be locked, showing only a notice that the subscription ended.",
    "אתר העסק יעבור לארכיון: דף הנחיתה, הזמנת תורים אונליין, רשימת ההמתנה, ההצטרפות למועדון וחנות כרטיסי המתנה יפסיקו לקבל לקוחות. מי שיכנס יראה שהעסק אינו זמין להזמנות.":
        "The business's site will be archived: the landing page, online booking, the wait list, joining the club and the gift card shop will stop taking clients. Visitors will see the business isn't taking bookings.",
    "העסק יוסתר מהחיפוש ב-BizFind.": "The business will be hidden from BizFind search.",
    "שום דבר לא נמחק: הלקוחות, היומן, ההיסטוריה והתשלומים נשמרים.": "Nothing is deleted: clients, the calendar, history and payments are kept.",
    "אחרי החידוש הכול חוזר לפעול מעצמו — הכניסה למערכת, האתר וקביעת התורים.": "After renewing, everything works again by itself — signing in, the site and booking.",
    "המערכת — יומן, לקוחות, תשלומים והגדרות — חסומה, ומוצגת רק הודעה על סיום המנוי.":
        "The system — calendar, clients, payments and settings — is locked, showing only a notice that the subscription ended.",
    "אתר העסק בארכיון: דף הנחיתה, הזמנת תורים אונליין, רשימת ההמתנה, ההצטרפות למועדון וחנות כרטיסי המתנה אינם מקבלים לקוחות. מי שנכנס רואה שהעסק אינו זמין להזמנות.":
        "The business's site is archived: the landing page, online booking, the wait list, joining the club and the gift card shop aren't taking clients. Visitors see the business isn't taking bookings.",
    "העסק מוסתר מהחיפוש ב-BizFind.": "The business is hidden from BizFind search.",
    "ברגע שהמנוי יחודש הכול חוזר לפעול מעצמו — הכניסה למערכת, האתר וקביעת התורים.": "The moment the subscription is renewed, everything works again by itself — signing in, the site and booking.",
    "שלום,": "Hello,",
    "האתר והמערכת של": "The site and system of",
    "המנוי של": "The subscription of",
    "כדי להחזיר הכול לפעולה — מחדשים את המנוי:": "To bring everything back — renew the subscription:",
    "כדי להמשיך ללא הפרעה — מחדשים את המנוי לפני שהוא מסתיים:": "To carry on without interruption — renew before it ends:",
    "אימייל:": "Email:",
    "לצפייה במסלולים ובמנוי שלכם": "See the plans and your subscription",
    "BizControl — מערכת ניהול עסק": "BizControl — business management",

    # ── classes and memberships ──
    "נרשמת אוטומטית — נתראה!": "You were booked automatically — see you!",
    "המנוי שלך חזר לפעילות היום.": "Your membership is active again today.",
    "נותרו לך 2 כניסות בכרטיסייה.": "You have 2 visits left on your punch card.",

    # ── the business's word for the one giving the service (the field's words) ──
    "נותן/ת שירות": "Service provider", "אמן/ית": "Artist", "מטפל/ת": "Therapist", "ספר/ית": "Barber",
    "מניקוריסטית": "Manicurist", "קוסמטיקאית": "Beautician", "מדריך/ה": "Instructor", "מאמן/ת": "Trainer",
    "מעסה": "Massage therapist", "מעצב/ת שיער": "Hair stylist", "צלם/ת": "Photographer",
    "🖼️ תיק עבודות:": "🖼️ Portfolio:", "🗺️ ניווט:": "🗺️ Directions:",

    # ── the system's e-mails to the owner and the team (sign-up, password, invitation, a new club member) ──
    "אימות כתובת המייל — BizControl": "Verify your email — BizControl",
    "איפוס סיסמה — BizControl": "Reset your password — BizControl",
    "אם לא ביקשת איפוס סיסמה — התעלם מהודעה זו. הסיסמה לא תשתנה.": "If you didn't ask to reset your password, ignore this message. Your password won't change.",
    "אם לא ביקשת הודעה זו, ניתן להתעלם ממנה.": "If you didn't ask for this message, you can ignore it.",
    "אם לא נרשמת ל-BizControl — ניתן להתעלם מהודעה זו.": "If you didn't sign up for BizControl, you can ignore this message.",
    "ב-BizControl": "on BizControl",
    "ברוך הבא ל-BizControl! 🎉": "Welcome to BizControl! 🎉",
    "בתפקיד": "as",
    "הוזמנת להצטרף לסטודיו": "You've been invited to join",
    "הסטודיו": "The business",
    "הקישור תקף ל-7 ימים.": "The link is valid for 7 days.",
    "הקישור תקף ל-72 שעות.": "The link is valid for 72 hours.",
    "הקישור תקף ל-72 שעות. לאחר מכן ניתן לבקש קישור חדש דרך \"שכחתי סיסמה\".": "The link is valid for 72 hours. After that you can ask for a new one with \"Forgot password\".",
    "חבר/ה חדש/ה הצטרפ/ה למועדון הלקוחות של": "A new member joined the client club of",
    "כדי להשלים את ההרשמה ולוודא שנוכל לשלוח לך עדכונים, נא לאמת את כתובת המייל שלך:": "To finish signing up and make sure we can send you updates, please verify your email address:",
    "להגדיר סיסמה אישית מיד לאחר הכניסה הראשונה:": "to set a personal password right after your first sign-in:",
    "להלן פרטי הגישה שלך:": "Here are your sign-in details:",
    "לחץ על הכפתור כדי להגדיר סיסמה חדשה:": "Click the button to set a new password:",
    "מומלץ בחום": "We strongly recommend",
    "נוצר בהצלחה במערכת BizControl.": "was created in BizControl.",
    "ניהול העסק שלך, בפשטות": "Your business, simply managed",
    "ניתן לצפות בפרטי הלקוח בפאנל הניהול של BizControl.": "You can see the client's details in BizControl.",
    "קיבלנו בקשה לאיפוס הסיסמה שלך ב-BizControl.": "We got a request to reset your BizControl password.",
    "תודה שנרשמת ל-BizControl! 🎉": "Thanks for signing up for BizControl! 🎉",
    "✅ אמת את כתובת המייל": "✅ Verify your email",
    "✅ הגדר סיסמה והתחבר למערכת": "✅ Set a password and sign in",
    "⭐ נקודות התחלה": "⭐ Starting points",
    "🌐 כתובת האתר": "🌐 Website",
    "🏠 מזהה סטודיו": "🏠 Business ID",
    "🏢 שם העסק": "🏢 Business name",
    "👤 בעל העסק": "👤 Business owner",
    "👤 שם מלא": "👤 Full name",
    "💼 תכנית": "💼 Plan",
    "📍 עיר": "📍 City",
    "📧 אימייל": "📧 Email", "📧 מייל": "📧 Email",
    "📱 טלפון": "📱 Phone",
    "🔐 הגדר סיסמה אישית": "🔐 Set a personal password",
    "🔐 הגדר סיסמה חדשה": "🔐 Set a new password",
    "🔑 סיסמה זמנית": "🔑 Temporary password",
    "🕐 זמן הצטרפות": "🕐 Joined at",
}

# lines with a value inside — Hebrew with {} where the value goes, English with {0}, {1}… in the Hebrew's order;
# the specific before the general
PATTERNS: dict[str, str] = {
    # appointments
    "היי {} 👋": "Hi {0} 👋", "היי {}! 👋": "Hi {0}! 👋", "היי {}! 😊": "Hi {0}! 😊", "היי {}! 🎉": "Hi {0}! 🎉",
    "היי {}! 🌟": "Hi {0}! 🌟", "היי {}! 🙏": "Hi {0}! 🙏", "היי {},": "Hi {0},", "שלום {},": "Hello {0},",
    "שלום {} 👋": "Hello {0} 👋", "שלום {}! 🎉": "Hello {0}! 🎉", "שלום {}! 📋": "Hello {0}! 📋", "שלום": "Hello",
    "בוקר טוב {} ☀️": "Good morning {0} ☀️", "בוקר טוב": "Good morning",
    "התור שלך ל{} נקבע בהצלחה ✅": "Your appointment for {0} is booked ✅",
    "📅 {} בשעה {}": "📅 {0} at {1}", "{} בשעה {}": "{0} at {1}",
    "🖼️ תיק עבודות: {}": "🖼️ Portfolio: {0}",
    "🗺️ ניווט: {}": "🗺️ Directions: {0}",
    "💳 לאישור התור נדרשת מקדמה של ₪{}": "💳 A ₪{0} deposit is required to confirm the appointment",
    "לתשלום: {}": "To pay: {0}",
    "ביטול ללא עלות עד {} ימים לפני התור.": "Free cancellation up to {0} days before the appointment.",
    "היי {}! 🎉 התור שלך ל-{} נקבע ל-{} בשעה {}.": "Hi {0}! 🎉 Your appointment for {1} is set for {2} at {3}.",
    "{} · {} בשעה {}": "{0} · {1} at {2}",
    "{} — {}, {} {}": "{0} — {1}, {2} {3}",
    # deposit
    "✅ {}, המקדמה אושרה!": "✅ {0}, your deposit is approved!",
    "📅 תאריך: {}": "📅 Date: {0}", "🕐 שעה: {}": "🕐 Time: {0}", "📍 כתובת: {}": "📍 Address: {0}",
    "✂️ אמן/ית: {}": "✂️ Artist: {0}", "👥 {}:": "👥 {0}:",
    "מדיניות ביטולים: ביטול עד {} ימים לפני — החזר מלא. פחות מ-{} ימים — ללא החזר. שינוי תור עד {} ימים לפני בלבד.":
        "Cancellation policy: cancel up to {0} days before — full refund. Less than {1} days — no refund. Changes up to {2} days before only.",
    "*מדיניות ביטולים:* ביטול עד {} ימים לפני — החזר מלא. פחות מ-{} ימים — ללא החזר מקדמה. שינוי תור אפשרי עד {} ימים לפני.":
        "*Cancellation policy:* cancel up to {0} days before — full refund. Less than {1} days — the deposit isn't refunded. Changes possible up to {2} days before.",
    "מדיניות ביטולים: ביטול עד {} ימים לפני — החזר מלא.": "Cancellation policy: cancel up to {0} days before — full refund.",
    "תזכורת: התור שלך בתאריך {} בשעה {} עדיין ממתין לאישור מקדמה.": "A reminder: your appointment on {0} at {1} is still waiting for the deposit.",
    "💰 סכום המקדמה: ₪{}": "💰 Deposit: ₪{0}",
    "לתשלום — ואחרי התשלום לחצו שם על \"שילמתי\": {}": "To pay — and after paying, tap \"I've paid\" there: {0}",
    "⚠️ שים לב: טרם שולמה מקדמה בסך ₪{}.": "⚠️ Note: the ₪{0} deposit hasn't been paid yet.",
    "⚠️ טרם שולמה מקדמה בסך ₪{}.": "⚠️ The ₪{0} deposit hasn't been paid yet.",
    "💳 ביט: {}": "💳 Bit: {0}", "💳 פייבוקס: {}": "💳 PayBox: {0}", "🏦 העברה בנקאית: {}": "🏦 Bank transfer: {0}",
    "לשאלות: {}": "Questions: {0}",
    "לאישור התור נדרשת מקדמה של {}₪ עד 24 שעות.": "A {0}₪ deposit within 24 hours is required to confirm the appointment.",
    "בדיקה: {}": "Test: {0}",
    "{} | סניף {} | חשבון {}": "{0} | branch {1} | account {2}",
    # change
    "התור שלך ל *{}* עודכן למועד חדש:": "Your appointment for *{0}* moved to a new time:",
    "📅 יום {}, {}": "📅 {0}, {1}", "🕐 שעה {}": "🕐 {0}",
    "{} · יום {}, {} בשעה {}": "{0} · {1}, {2} at {3}",
    # reminders
    "תזכורת: יש לך תור {} 📅": "Reminder: you have an appointment {0} 📅",
    "מזכירים — התור שלך היום בשעה {} 📋 {}": "A reminder — your appointment is today at {0} 📋 {1}",
    "☀️ תזכורת לתור היום בשעה {}": "☀️ Reminder: your appointment today at {0}",
    "{} · שעה {}": "{0} · {1}",
    # after the visit
    "🎁 כחבר/ת מועדון צברת {} נקודות!": "🎁 As a club member you earned {0} points!",
    "סה\"כ: {} נקודות.": "Total: {0} points.",
    "🎁 סה\"כ נקודות במועדון: {} נקודות.": "🎁 Your club points: {0}.",
    "🎁 צברת {} נקודות!": "🎁 You earned {0} points!",
    "צברת {} נקודות. סה״כ: {}": "You earned {0} points. Total: {1}",
    "🎁 צברת {} נקודות! יתרה: {} נקודות.": "🎁 You earned {0} points! Balance: {1} points.",
    "⭐ יתרת נקודות: {} נקודות.": "⭐ Points balance: {0} points.",
    "⭐ יתרת נקודות: {}": "⭐ Points balance: {0}",
    "💳 מקדמה: {} ₪": "💳 Deposit: {0} ₪", "💰 סכום ששולם: {} ₪": "💰 Amount paid: {0} ₪",
    "🧾 הקבלה שלך עבור {}:": "🧾 Your receipt for {0}:", "🧾 הקבלה שלך עבור {}": "🧾 Your receipt for {0}",
    "הקבלה שלך עבור": "Your receipt for",
    "מוכנה.": "is ready.",
    # club
    "הצטרף/י למועדון הלקוחות שלנו וקבל/י {} נקודות מתנה לביקור הבא 🎉": "Join our client club and get {0} gift points for your next visit 🎉",
    "הרשמה: {}": "Join: {0}",
    "להסרה מרשימת ההודעות: {}": "To stop these messages: {0}",
    "להסרה מהודעות שיווקיות: {}": "To stop marketing messages: {0}",
    "להסרה מרשימת התפוצה: {}": "To unsubscribe: {0}",
    "🎁 {} נקודות מתנה מחכות לך — הצטרף/י למועדון": "🎁 {0} gift points are waiting for you — join the club",
    "🎁 קיבלת {} נקודות מתנה עם ההצטרפות!": "🎁 You got {0} gift points for joining!",
    "⭐ יתרת הנקודות שלך: {} נקודות.": "⭐ Your points balance: {0} points.",
    "סה״כ היתרה שלך: {} נקודות.": "Your balance: {0} points.",
    "פינקנו אותך ב-": "We treated you to",
    "{} נקודות": "{0} points",
    "במתנה!": "as a gift!",
    "יתרת הנקודות שלך במועדון: *{} נקודות*": "Your club points balance: *{0} points*",
    "🎉 חסכת ₪{} היום בזכות המועדון! תודה שאת/ה חלק מהמשפחה של {} 💫": "🎉 You saved ₪{0} today thanks to the club! Thanks for being part of the {1} family 💫",
    "🎁 {}, מימשת {} נקודות בשווי {}₪!": "🎁 {0}, you used {1} points worth {2}₪!",
    "נקודות שנותרו: {} נקודות.": "Points left: {0}.",
    "כל הכבוד, {}!": "Well done, {0}!",
    "בזכות מועדון הלקוחות של {}": "thanks to {0}'s client club",
    "הצטרף/י למועדון הלקוחות שלנו וקבל/י": "Join our client club and get",
    "לביקור הבא 🎉": "for your next visit 🎉",
    # birthdays
    "{} יקר/ה,": "Dear {0},",
    "יקר/ה, {} 🎂✨": ", {0} 🎂✨",
    "הכנו לך מתנה אישית: {}% הנחה, במיוחד בשבילך לכבוד יום ההולדת ❤️": "We have a personal gift for you: {0}% off, just for you for your birthday ❤️",
    "{}% הנחה": "{0}% off",
    "הקוד תקף לחודש {}/{}. הזן בקופה בעת התשלום.": "The code is valid for {0}/{1}. Enter it at the till when paying.",
    "🎂 {}, {} — ומתנה מחכה לך!": "🎂 {0}, {1} — and a gift is waiting for you!",
    "היי {}, מזל טוב! 🎉": "Hi {0}, happy birthday! 🎉",
    "הנה הטבה מיוחדת של {}% הנחה לחודש ההולדת שלך — במיוחד בשבילך ❤️": "Here's a special {0}% off for your birthday month — just for you ❤️",
    "קוד הקופון שלך: *{}*": "Your coupon code: *{0}*",
    "קוד הקופון שלך: {}": "Your coupon code: {0}",
    # wait list, booking requests
    "נוספת לרשימת ההמתנה של {}.": "You're on {0}'s wait list.",
    "נרשמת לרשימת המתנה של {}.": "You're on {0}'s wait list.",
    "התפנה מקום ב{}!": "A spot opened up at {0}!",
    "👤 {}, התור שלך עם {} אושר.": "👤 {0}, your appointment with {1} is approved.",
    "❌ בקשת התור שלך ל-{} לא אושרה.": "❌ Your booking request for {0} wasn't approved.",
    "סיבה: {}": "Reason: {0}",
    # health form
    "היי {}, {} — נבקש למלא הצהרת בריאות קצרה ולחתום. זה לוקח דקה:": "Hi {0}, {1} — please fill in a short health declaration and sign it. It takes a minute:",
    "לקראת התור שלך ב-{} ב-{} בשעה {}": "ahead of your appointment at {0} on {1} at {2}",
    "לפני הטיפול ב-{}": "before your treatment at {0}",
    # gift cards
    "איזה כיף, {}! קיבלת מתנה 🎁": "How nice, {0}! You got a gift 🎁",
    "איזה כיף, {}! קיבלת מתנה": "How nice, {0}! You got a gift",
    "{} שלח/ה לך כרטיס מתנה ל-{}!": "{0} sent you a gift card for {1}!",
    "תוקף: {}": "Valid until: {0}", "בתוקף עד {}": "Valid until {0}",
    "🎁 קיבלת כרטיס מתנה ל-{} בשווי ₪{}": "🎁 You got a ₪{1} gift card for {0}",
    "כולל בונוס של ₪{}!": "Including a ₪{0} bonus!", "🎉 כולל בונוס של ₪{}!": "🎉 Including a ₪{0} bonus!",
    "🎁 כרטיס המתנה שלך ל-{} מוכן!": "🎁 Your gift card for {0} is ready!",
    "שווי: ₪{}": "Value: ₪{0}", "קוד המימוש: {}": "Redemption code: {0}",
    "כרטיס המתנה שלך ל-{} בשווי ₪{} נשלח בהצלחה ל-{}.": "Your ₪{1} gift card for {0} was sent to {2}.",
    "🎁 תודה על הרכישה — כרטיס המתנה נשלח ל-{}": "🎁 Thanks for your purchase — the gift card was sent to {0}",
    "כרטיס מתנה - {}": "Gift card - {0}",
    "כרטיס המתנה שלך ל-{} בשווי ₪{} נשלח בהצלחה ל-": "Your ₪{1} gift card for {0} was sent to",
    "הקבלה שלך עבור כרטיס המתנה מוכנה.": "Your gift card receipt is ready.",
    # the app
    "{} — האפליקציה שלנו": "{0} — our app",
    "הוזמנת ל-{}! 🎉": "You're invited to {0}! 🎉",
    "🎉 חבר/ה חדש/ה הצטרפ/ה למועדון — {}": "🎉 A new member joined the club — {0}",
    "להורדה: {}": "Download: {0}",
    # classes and memberships (the catalog's texts, services/notifications.EVENTS)
    "היי {}, נרשמת ל{} ב-{} בשעה {} ✅": "Hi {0}, you're booked for {1} on {2} at {3} ✅",
    "נרשמת ל{} ב-{} בשעה {}.": "You're booked for {0} on {1} at {2}.",
    "היי {}, תזכורת: {} ב-{} בשעה {} ⏰": "Hi {0}, a reminder: {1} on {2} at {3} ⏰",
    "תזכורת: {} ב-{} בשעה {}.": "A reminder: {0} on {1} at {2}.",
    "היי {}, עדכון לגבי {} ב-{} בשעה {}:": "Hi {0}, an update about {1} on {2} at {3}:",
    "עדכון לגבי {} ב-{} בשעה {}:": "An update about {0} on {1} at {2}:",
    "היי {}, ביטלנו את {} ב-{} בשעה {} כי לא היו מספיק נרשמים. {}": "Hi {0}, we canceled {1} on {2} at {3} because not enough people signed up. {4}",
    "ביטלנו את {} ב-{} בשעה {} כי לא היו מספיק נרשמים. {}": "We canceled {0} on {1} at {2} because not enough people signed up. {3}",
    "ביטלנו את {} ב-{} בשעה {} כי לא היו מספיק נרשמים.": "We canceled {0} on {1} at {2} because not enough people signed up.",
    "מצטערים! {}": "Sorry! {0}",
    "היי {}, ההרשמה שלך הועברה ל{} ב-{} בשעה {} ✅": "Hi {0}, your booking moved to {1} on {2} at {3} ✅",
    "ההרשמה שלך הועברה ל{} ב-{} בשעה {}.": "Your booking moved to {0} on {1} at {2}.",
    "במקום {} ב-{} בשעה {}.": "Instead of {0} on {1} at {2}.",
    "היי {}, נרשמת לקורס {} ✅": "Hi {0}, you're booked for the course {1} ✅",
    "נרשמת לקורס {}.": "You're booked for the course {0}.",
    "היי {}, ההרשמה שלך לקורס {} בוטלה. {}": "Hi {0}, your booking for the course {1} was canceled. {2}",
    "היי {}, ההרשמה שלך לקורס {} בוטלה.": "Hi {0}, your booking for the course {1} was canceled.",
    "ההרשמה שלך לקורס {} בוטלה. {}": "Your booking for the course {0} was canceled. {1}",
    "היי {}, ההרשמה שלך ל{} ב-{} בוטלה. {}": "Hi {0}, your booking for {1} on {2} was canceled. {3}",
    "היי {}, ההרשמה שלך ל{} ב-{} בוטלה.": "Hi {0}, your booking for {1} on {2} was canceled.",
    "ההרשמה שלך ל{} ב-{} בוטלה. {}": "Your booking for {0} on {1} was canceled. {2}",
    "היי {}, לפי מדיניות הביטולים של {}: {}": "Hi {0}, under {1}'s cancellation policy: {2}",
    "לפי מדיניות הביטולים של {}: {}": "Under {0}'s cancellation policy: {1}",
    "היי {}, התפנה מקום ב{} ב-{} בשעה {} 🎉": "Hi {0}, a spot opened up in {1} on {2} at {3} 🎉",
    "התפנה מקום ב{} ב-{} בשעה {}.": "A spot opened up in {0} on {1} at {2}.",
    "היי {}, המנוי שלך {} מתאריך {}.": "Hi {0}, your membership {1} as of {2}.",
    "המנוי שלך {} מתאריך {}.": "Your membership {0} as of {1}.",
    "היי {}, {} לחידוש — דברו איתנו 🙏": "Hi {0}, {1} To renew — talk to us 🙏",
    "{} לחידוש — דברו איתנו.": "{0} To renew — talk to us.",
    "היי {}, {} שמור לך ב-{} בשעות {} ✅": "Hi {0}, {1} is held for you on {2}, {3} ✅",
    "{} שמור לך ב-{} בשעות {}.": "{0} is held for you on {1}, {2}.",
    "היי {}, ההשכרה של {} ב-{} בשעות {} בוטלה. {}": "Hi {0}, the rental of {1} on {2}, {3} was canceled. {4}",
    "ההשכרה של {} ב-{} בשעות {} בוטלה. {}": "The rental of {0} on {1}, {2} was canceled. {3}",
    "המנוי שלך חוזר לפעילות מחר, {}.": "Your membership is active again tomorrow, {0}.",
    "המנוי שלך מסתיים {} ({}).": "Your membership ends {0} ({1}).",
    "הזמן לאישור המקום בקורס {} עבר, והמקום עבר לבא בתור.": "The time to confirm your spot in the course {0} passed, and the spot went to the next in line.",
    # the subscription's e-mails
    "(תוכנית: {}) אינם פעילים מאז {}. זה מה שקורה עכשיו:": "(plan: {0}) have been inactive since {1}. Here's what happens now:",
    "(תוכנית: {}) מסתיים ב-{}. אם לא תחדשו עד אז, זה מה שיקרה:": "(plan: {0}) ends on {1}. If you don't renew by then, here's what will happen:",
    "תקופת הניסיון מסתיימת בעוד {} ימים": "The trial ends in {0} days",
    "המנוי יפוג בעוד {} ימים": "The subscription expires in {0} days",
    "BizControl — {}": "BizControl — {0}",
    # the generic greeting with a note after it — last
    "היי {}, {}": "Hi {0}, {1}",
}

# the general ones after every specific one ("מזכירים — התור שלך היום בשעה {} 📋 {}" before "{} בשעה {}")
for _k in ("{} · {} בשעה {}", "{} · יום {}, {} בשעה {}", "{} — {}, {} {}", "{} · שעה {}", "📅 {} בשעה {}", "{} בשעה {}",
           "👥 {}:", "{}% הנחה", "{} נקודות", "מצטערים! {}", "היי {}, {}"):
    PATTERNS[_k] = PATTERNS.pop(_k)
_GENERAL = PATTERNS["היי {}, {}"]
_RX = [(re.compile("^" + re.escape(he).replace(re.escape("{}"), "(.+?)") + "$", re.S), en) for he, en in PATTERNS.items()]


def _say(core: str) -> str:
    hit = LINES.get(core)
    if hit is not None:
        return hit
    from app.core.i18n import EN as _SYSTEM          # the system's own texts (exact only, not its general patterns)
    hit = _SYSTEM.get(core)
    if hit is not None:
        return hit
    for rx, en in _RX:
        m = rx.match(core)
        if m:
            said = [_say(g) if HEB.search(g) else g for g in m.groups()]
            if en == _GENERAL and HEB.search(said[-1]):
                continue                     # "היי {name}, {…}" — only a note the system wrote, not an owner's words
            return en.format(*said)
    return core


def _piece(s: str) -> str:
    """One line or one text between tags — its spaces stay where they were."""
    if not HEB.search(s):
        return s
    m = re.match(r"^(\s*)(.*?)(\s*)$", s, re.S)
    lead, core, tail = m.group(1), m.group(2), m.group(3)
    out = _say(core)
    # a Hebrew piece ending in a glued prefix ("התור שלך ל-" + <strong>…) needs a space before what follows
    if out != core and core.endswith("-") and not out.endswith((" ", "-")):
        out += " "
    return lead + out + tail


def speak(text: str | None, lang: str) -> str | None:
    """A message the system built in Hebrew, in `lang` — "he" leaves it as it is."""
    if lang != "en" or not text or not HEB.search(text):
        return text
    if re.search(r"<[a-zA-Z][^>]*>", text):                       # an e-mail: the texts between the tags
        text = re.sub(r"""dir=(["'])rtl\1""", r"dir=\1ltr\1", text)
        text = text.replace("text-align:right", "text-align:left").replace("text-align: right", "text-align: left")
        text = re.sub(r"""alt=(["'])שובר מתנה\1""", r"alt=\1Gift voucher\1", text)
        return re.sub(r">([^<]+)<", lambda m: ">" + _piece(m.group(1)) + "<", text)
    return "\n".join(_piece(line) for line in text.split("\n"))
