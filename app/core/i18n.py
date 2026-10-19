"""The system in the user's language — Hebrew, or English (the owner, 2026-10-12: "the whole system turns English";
2026-10-19: Hebrew and English only). The web sends each request's language (the header X-Lang: he | en — the choice
saved in the user's account, users.locale; without one, the business's — the owner's — studio_settings.default_locale).
The server's messages are written in Hebrew and said in English from one dictionary, Hebrew text → English text; a
message not in it yet stays Hebrew. Each stage of the translation adds the messages of its screens."""
from __future__ import annotations

LANGS = ("he", "en")


def lang_of(header: str | None) -> str:
    """The X-Lang header: "en" → en; anything else (none, he) → he. Not the browser's Accept-Language — a phone set
    to English sends that even when the user chose Hebrew in the system."""
    return "en" if (header or "").strip().lower().startswith("en") else "he"


def say(text, lang: str):
    """A Hebrew message in the request's language (as it is when there's no English for it yet, or it isn't text)."""
    return EN.get(text, text) if lang == "en" and isinstance(text, str) else text


EN: dict[str, str] = {
    # ── found / allowed ──
    "לא נמצא": "Not found",
    "לקוח לא נמצא": "Client not found",
    "משתמש לא נמצא": "User not found",
    "עסק לא נמצא": "Business not found",
    "תור לא נמצא": "Appointment not found",
    "תשלום לא נמצא": "Payment not found",
    "עסקה לא נמצאה": "Transaction not found",
    "שיחה לא נמצאה": "Conversation not found",
    "המשמרת לא נמצאה": "Shift not found",
    "העובד/ת לא נמצא/ה": "Staff member not found",
    "אין הרשאה": "Not allowed",
    "אין לך הרשאה לפעולה הזו": "You're not allowed to do this",
    "לא מחובר": "Not signed in",
    "האזור הזה של בעל העסק והמנהלים": "This area is for the business owner and managers",
    "רק בעל העסק או מנהל יכולים לשנות את זה": "Only the business owner or a manager can change this",
    "בעל העסק בלבד מנהל את המנהלים": "Only the business owner manages the managers",
    "קישור לא תקין": "Invalid link",
    "הקישור לא תקין": "Invalid link",
    "הקישור לא תקין או פג תוקף": "The link is invalid or has expired",
    "אין תמונה זמינה": "No image available",
    "status לא תקין": "Invalid status",
    # ── signing in, the account ──
    "הסיסמה הנוכחית שגויה": "The current password is wrong",
    "הסיסמה חייבת להכיל לפחות 8 תווים, אות אחת וספרה אחת": "The password needs at least 8 characters, a letter and a digit",
    "את הסיסמה של בעל העסק משנים בהגדרות ← החשבון שלי, עם הסיסמה הנוכחית":
        "The business owner's password is changed in Settings → My account, with the current password",
    "כתובת המייל כבר רשומה במערכת": "This email is already registered",
    "שם פרטי ושם משפחה נדרשים": "First and last name are required",
    "שליחת מייל האימות נכשלה, נסה שוב מאוחר יותר": "Sending the verification email failed — please try again later",
    "טוקן אימות לא תקין": "Invalid verification token",
    "אימות דו-שלבי לא מופעל": "Two-step verification isn't on",
    "קוד שגוי": "Wrong code",
    "קוד שגוי או פג תוקף": "Wrong or expired code",
    "קוד שגוי — נותר ניסיון אחד": "Wrong code — one try left",
    "קוד שגוי — בדוק שסרקת את ה-QR נכון": "Wrong code — check that you scanned the QR correctly",
    "קוד זמני לא תקין או פג תוקף": "The temporary code is invalid or has expired",
    "קוד לא תקין, כבר נוצל, או פג תוקף": "The code is invalid, already used, or expired",
    "לא הצלחנו לזהות את המכשיר הזה — התחברו מחדש ונסו שוב": "We couldn't recognize this device — sign in again and retry",
    "תוכנית המנוי של העסק פגה. אנא פנה לחידוש.": "The business's subscription has ended. Please renew it.",
    # ── the attendance clock, the team ──
    "שעון הנוכחות לא כלול במסלול של העסק": "The attendance clock isn't included in the business's plan",
    "בעל העסק לא מחתים שעון נוכחות": "The business owner doesn't clock in",
    "בעסק הזה מחתימים כניסה ויציאה בסריקת הברקוד שבכניסה": "In this business you clock in and out by scanning the barcode at the door",
    "תיקון שעות נוכחות — רק בעל העסק או מנהל שהורשה": "Fixing attendance hours — only the business owner or an allowed manager",
    "את המשמרות שלך מתקן בעל העסק": "Your own shifts are fixed by the business owner",
    "אין משמרת פתוחה — קודם מחתימים כניסה": "No open shift — clock in first",
    "הפסקה — לעובדים במשמרת": "Breaks are for staff on a shift",
    "שעת הכניסה עוד לא הגיעה": "The clock-in time hasn't come yet",
    "שעת היציאה צריכה להיות אחרי הכניסה, ובתוך 24 שעות": "The clock-out must be after the clock-in, within 24 hours",
    "חסר העובד או שעת הכניסה": "The staff member or the clock-in time is missing",
    "לעובד כבר יש משמרת פתוחה": "This staff member already has an open shift",
    "אפשר לבטל רק בשתי הדקות הראשונות — בעל העסק או המנהל יכולים לתקן":
        "Undo is only possible in the first two minutes — the owner or a manager can fix it",
    "אפשר רק בשתי הדקות שאחרי היציאה": "Only within two minutes of clocking out",
    "יש כבר משמרת פתוחה": "There's already an open shift",
    "הברקוד הזה לא שייך לעסק שלך — ודא/י שנכנסת לחשבון שלך בעסק הזה":
        "This barcode doesn't belong to your business — make sure you're signed in to your account in this business",
    "שעון הנוכחות בברקוד לא פעיל בעסק": "The barcode attendance clock isn't on in this business",
    "אפשר לשנות רק תורים ביומן שלך": "You can only change appointments in your own calendar",
    "אפשר לבטל רק תורים ביומן שלך": "You can only cancel appointments in your own calendar",
    # ── stage 3: the team — the schedule, requests, pay to the accountant, the activity log ──
    "חודש לא תקין": "Invalid month",
    "סידור העבודה — לבעל העסק ולמי שמנהל את הצוות": "The schedule is for the owner and whoever manages the team",
    "משמרת ארוכה מ-16 שעות — בדקו את השעות": "A shift longer than 16 hours — check the times",
    "יש כבר משמרת בשעות האלה לאותו עובד/ת": "This staff member already has a shift at these hours",
    "בחרו עובד/ת, יום ושעות": "Choose a staff member, a day and times",
    "סוג אילוץ לא מוכר": "Unknown constraint type",
    "המועד להגשת אילוצים לשבוע הזה עבר — דברו עם בעל העסק": "The constraints deadline for this week has passed — talk to the owner",
    "טווח לא תקין — עד חודשיים": "Invalid range — up to two months",
    "את הבקשות מאשרים בעל העסק ומי שמנהל את הצוות": "Requests are approved by the owner and whoever manages the team",
    "המשמרת כבר התחילה": "The shift has already started",
    "הסידור לשבוע הזה עוד לא פורסם": "This week's schedule isn't published yet",
    "בחרו עמית/ה מהצוות": "Choose a colleague from the team",
    "כבר יש בקשת החלפה פתוחה על המשמרת הזו": "There's already an open swap request for this shift",
    "הבקשה לא נמצאה או שכבר נענתה": "The request wasn't found or was already answered",
    "סוג בקשה לא מוכר": "Unknown request type",
    "תאריך הסיום לפני תאריך ההתחלה": "The end date is before the start date",
    "אפשר לבקש עד שבוע אחורה": "You can ask up to a week back",
    "הבקשה לא נמצאה או שכבר טופלה": "The request wasn't found or was already handled",
    "המשמרות השתנו מאז הבקשה — אי אפשר לאשר אותה כמו שהיא": "The shifts changed since the request — it can't be approved as it is",
    "ההחלפה יוצרת שתי משמרות באותו זמן — בדקו את הסידור": "The swap makes two shifts at the same time — check the schedule",
    "אפשר לבטל רק בקשה שעוד מחכה": "Only a request that's still waiting can be canceled",
    "יומן הפעילות פתוח לבעל העסק בלבד": "The activity log is for the business owner only",
    "לא הוגדר מייל של רואה החשבון — מגדירים אותו בחשבוניות ← הגדרות": "No accountant email set — set it in Invoices → Settings",
    "השליחה נכשלה — נסו שוב בעוד כמה דקות": "Sending failed — try again in a few minutes",
    # ── stage 4a: settings, the account, connections ──
    "שינוי הגדרות העסק — בעל העסק לא אפשר את זה": "Changing the business settings — the owner didn't allow this",
    "WhatsApp לא מוגדר — יש להגדיר ספק ופרטי חיבור": "WhatsApp isn't set up — set a provider and connection details",
    "ההתחברות פגה, יש להתחבר שוב": "Your sign-in expired, please sign in again",
    "טוקן לא תקין": "Invalid token",
    "מספר טלפון לא תקין": "Invalid phone number",
    "כתובת אימייל לא תקינה": "Invalid email address",
    "אימייל זה כבר רשום. נסה להתחבר": "This email is already registered. Try signing in",
    "אימייל או סיסמה שגויים": "Wrong email or password",
    "כרטיס בארנק לא זמין אצל העסק": "The wallet card isn't available at this business",
    "תכנית זו הופסקה. כל בעלי העסקים מנוהלים כעת דרך BizControl.": "This program was discontinued. All business owners are now managed through BizControl.",
    "חסר טוקן אימות": "Missing verification token",
    "קישור האימות אינו תקף או שכבר נעשה בו שימוש": "The verification link is invalid or was already used",
    "קישור האימות פג תוקף — יש לבקש שליחה חוזרת": "The verification link expired — ask for it to be sent again",
}
