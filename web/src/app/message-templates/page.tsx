"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { CalendarCheck, Bell, Receipt, Globe, Star, Pencil, RotateCcw, MessageCircle, Mail, Info, Smartphone, type LucideIcon } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import BottomSheet from "@/components/ui/bottom-sheet";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { fillTerms, useTerms } from "@/lib/useTerms";
import { toast } from "@/lib/toast";

// The messages the business sends its clients — one card each: on or off, what it says, its text edited in one window
// that goes out on WhatsApp and, when the client has an e-mail, in the e-mail too (the owner, 2026-10-12: "much easier,
// prettier and accessible for someone who doesn't know automations; one window per template; a way to cancel a
// message, not just delete").

// ── The details a text can hold — {key} in the text, the client's own in each message ────────────────────────────────
const PLACEHOLDERS = [
    { key: "{client_name}",            label: "שם לקוח" },
    { key: "{appointment_title}",      label: "שם שירות" },
    { key: "{service_name}",           label: "שם שירות" },
    { key: "{appointment_date}",       label: "תאריך תור" },
    { key: "{appointment_time}",       label: "שעת תור" },
    { key: "{appointment_day}",        label: "יום בשבוע" },
    { key: "{date}",                   label: "תאריך תור" },
    { key: "{time}",                   label: "שעת תור" },
    { key: "{artist_name}",            label: "שם {staff}" },
    { key: "{staff_title}",            label: "המילה \"{staff}\"" },
    { key: "{studio_name}",            label: "שם העסק" },
    { key: "{studio_address}",         label: "כתובת העסק" },
    { key: "{map_link}",               label: "קישור מפה" },
    { key: "{portfolio_link}",         label: "תיק עבודות" },
    { key: "{bit_link}",               label: "קישור ביט" },
    { key: "{paybox_link}",            label: "קישור פייבוקס" },
    { key: "{payment_link}",           label: "קישור תשלום" },
    { key: "{deposit_amount}",         label: "סכום מקדמה" },
    { key: "{cancellation_free_days}", label: "ימי ביטול חינם" },
    { key: "{deposit_lock_days}",      label: "ימי נעילת מקדמה" },
    { key: "{loyalty_points}",         label: "נקודות לקוח" },
    { key: "{points_earned}",          label: "נקודות שנצברו" },
    { key: "{points_total}",           label: "יתרת נקודות" },
    { key: "{points_added}",           label: "נקודות מתנה בהצטרפות" },
    { key: "{points_on_signup}",       label: "נקודות מתנה בהצטרפות" },
    { key: "{payment_amount}",         label: "סכום ששולם" },
    { key: "{coupon_code}",            label: "קוד קופון" },
    { key: "{benefit_percent}",        label: "% הנחה יום הולדת" },
    { key: "{join_link}",              label: "קישור הצטרפות" },
    { key: "{app_link}",               label: "קישור לאפליקציה" },
    { key: "{app_features}",           label: "מה אפשר באפליקציה" },
    { key: "{points_used}",            label: "נקודות שנוצלו" },
    { key: "{discount_amount}",        label: "סכום הנחה" },
    { key: "{receipt_link}",           label: "קישור קבלה" },
    { key: "{booking_link}",           label: "קישור הזמנה" },
    { key: "{total_amount}",           label: "סכום כולל" },
    { key: "{rejection_reason}",       label: "סיבת דחייה" },
    { key: "{service_note}",           label: "הערת שירות" },
];

// ── The messages ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface Message {
    id: string;                       // also its id in messages_off (app/services/service_switches.py) when it has no own switch
    title: string;
    when: string;                     // when it goes out, in a few words
    templateKey: string;
    emailKey?: string;                // the same text goes to the e-mail too
    toggleKey?: string;               // a switch of its own in the settings
    manual?: boolean;                 // sent by hand only — no switch
    autoDetails?: boolean;            // a text with no {details} gets the appointment's details added under it (smart_format)
    times?: Times;                    // when it goes out — ready choices, one tap (stage 2, the owner, 2026-10-12)
    hints: string[];
}
interface Group { id: string; title: string; icon: LucideIcon; messages: Message[]; }
interface Times { key: string; label: string; fallback: number | string; options: { value: number | string; label: string }[]; other?: (v: number) => string; }

// after a visit: at once … a day later — minutes
const AFTER_VISIT = (key: string, fallback: number): Times => ({
    key, label: "מתי לשלוח", fallback, other: v => `אחרי ${v} דקות`,
    options: [{ value: 0, label: "מיד" }, { value: 30, label: "חצי שעה אחרי" }, { value: 60, label: "שעה אחרי" },
              { value: 180, label: "3 שעות אחרי" }, { value: 1440, label: "יום אחרי" }],
});

const GROUPS: Group[] = [
    {
        id: "appointments", title: "תורים", icon: CalendarCheck,
        messages: [
            { id: "confirm", title: "אישור תור", when: "מיד כשנקבע תור בלי מקדמה", autoDetails: true,
              templateKey: "confirm_wa_template", emailKey: "confirm_email_template",
              hints: ["client_name","appointment_title","appointment_date","appointment_time","artist_name","studio_address","map_link","portfolio_link","cancellation_free_days"] },
            { id: "deposit_request", title: "בקשת מקדמה", when: "מיד כשנקבע תור שדורש מקדמה", autoDetails: true,
              templateKey: "deposit_request_wa_template",
              hints: ["client_name","appointment_title","appointment_date","appointment_time","studio_address","map_link","bit_link","paybox_link","payment_link","deposit_amount","cancellation_free_days"] },
            { id: "deposit_approved", title: "המקדמה התקבלה", when: "כשמאשרים שהמקדמה שולמה", autoDetails: true,
              templateKey: "deposit_approved_wa_template",
              hints: ["client_name","appointment_date","appointment_time","artist_name","studio_address","map_link","portfolio_link","cancellation_free_days","deposit_lock_days"] },
            { id: "reschedule", title: "שינוי מועד", when: "כשתור עובר לזמן אחר", autoDetails: true,
              templateKey: "reschedule_wa_template", emailKey: "reschedule_email_template",
              hints: ["client_name","appointment_title","appointment_date","appointment_time","appointment_day"] },
            { id: "cancel", title: "ביטול תור", when: "כשהלקוח ביטל או לא הגיע", autoDetails: true,
              templateKey: "cancel_wa_template", emailKey: "cancel_email_template",
              hints: ["client_name","appointment_title","appointment_date","appointment_time"] },
        ],
    },
    {
        id: "reminders", title: "תזכורות", icon: Bell,
        messages: [
            { id: "reminder_7day", title: "תזכורת שבוע לפני", when: "כשבוע לפני התור", toggleKey: "reminder_7_days_enabled",
              templateKey: "reminder_7day_wa_template", hints: ["client_name","appointment_title","appointment_date","appointment_time"] },
            { id: "reminder_3day", title: "תזכורת 3 ימים לפני", when: "כ-3 ימים לפני התור", toggleKey: "reminder_3_days_enabled",
              templateKey: "reminder_3day_wa_template", hints: ["client_name","appointment_title","appointment_date","appointment_time","studio_address","map_link"] },
            { id: "reminder_1day", title: "תזכורת יום לפני", when: "כ-24 שעות לפני התור", toggleKey: "reminder_1_day_enabled",
              templateKey: "reminder_wa_template", emailKey: "reminder_email_template",
              hints: ["client_name","appointment_title","appointment_date","appointment_time","studio_address","map_link","deposit_amount","payment_link"] },
            { id: "reminder_sameday", title: "תזכורת בבוקר התור", when: "בבוקר יום התור, בשעה שבוחרים כאן", toggleKey: "same_day_reminder_enabled",
              times: { key: "same_day_reminder_hour", label: "באיזו שעה", fallback: 8,
                       options: [7, 8, 9, 10].map(h => ({ value: h, label: `${String(h).padStart(2, "0")}:00` })) },
              templateKey: "same_day_reminder_wa_template", hints: ["client_name","appointment_title","appointment_time","studio_address","map_link","deposit_amount","payment_link"] },
            { id: "reminder_2h", title: "תזכורת כשעתיים לפני", when: "כשעתיים לפני התור", toggleKey: "reminder_2_hours_enabled",
              templateKey: "reminder_2h_wa_template", hints: ["client_name","appointment_title","appointment_time","studio_address","map_link"] },
            { id: "deposit_reminder", title: "תזכורת מקדמה", when: "24 שעות אחרי קביעת התור, אם המקדמה עוד לא שולמה",
              templateKey: "deposit_reminder_wa_template", hints: ["client_name","date","time","deposit_amount"] },
        ],
    },
    {
        id: "payment", title: "תשלומים ואחרי הטיפול", icon: Receipt,
        messages: [
            { id: "post_payment", title: "תודה על התשלום", when: "אחרי תשלום על תור", autoDetails: true,
              templateKey: "post_payment_wa_template", emailKey: "post_payment_email_template",
              hints: ["client_name","appointment_title","appointment_date","appointment_time","payment_amount","points_earned","points_total"] },
            { id: "receipt_link", title: "קישור לקבלה", when: "אחרי תשלום, עם הקבלה הדיגיטלית",
              templateKey: "receipt_link_wa_template", hints: ["client_name","service_name","appointment_title","receipt_link"] },
            { id: "pos_receipt", title: "תודה על הרכישה", when: "אחרי רכישה בקופה", templateKey: "pos_receipt_wa_template",
              hints: ["client_name","total_amount","points_earned","loyalty_points"] },
            { id: "aftercare", title: "הוראות אחרי הטיפול", when: "אחרי שהתור הסתיים", toggleKey: "aftercare_enabled",
              times: AFTER_VISIT("aftercare_delay_minutes", 30),
              templateKey: "aftercare_message", hints: ["client_name"] },
        ],
    },
    {
        id: "online", title: "קביעת תורים אונליין", icon: Globe,
        messages: [
            { id: "booking_request_approved", title: "בקשת תור אושרה", when: "כשמאשרים בקשת תור מהאתר",
              templateKey: "booking_request_approved_wa_template", hints: ["client_name","artist_name","staff_title","appointment_date","service_note","booking_link"] },
            { id: "booking_request_rejected", title: "בקשת תור נדחתה", when: "כשדוחים בקשת תור מהאתר",
              templateKey: "booking_request_rejected_wa_template", hints: ["client_name","appointment_date","rejection_reason"] },
            { id: "waitlist_joined", title: "נרשמת לרשימת המתנה", when: "כשלקוח נרשם לרשימת ההמתנה",
              templateKey: "waitlist_joined_wa_template", hints: ["client_name","studio_name"] },
            { id: "waitlist_notify", title: "התפנה מקום", when: "כשמתפנה תור ללקוחות ברשימת ההמתנה",
              templateKey: "waitlist_notify_wa_template", hints: ["client_name","studio_name","booking_link"] },
        ],
    },
    {
        id: "club", title: "מועדון לקוחות", icon: Star,
        messages: [
            { id: "welcome", title: "ברוכים הבאים למועדון", when: "כשלקוח מצטרף למועדון",
              templateKey: "welcome_wa_template", emailKey: "welcome_email_template", hints: ["client_name","points_added","points_total"] },
            { id: "birthday", title: "יום הולדת", when: "עם קופון הנחה", toggleKey: "birthday_automation_enabled",
              templateKey: "birthday_wa_template", emailKey: "birthday_email_template",
              times: { key: "birthday_send_timing", label: "מתי לשלוח", fallback: "month_start",
                       options: [{ value: "month_start", label: "בתחילת החודש" }, { value: "two_days", label: "יומיים לפני" }] },
              hints: ["client_name","coupon_code","benefit_percent"] },
            { id: "non_member", title: "הזמנה להצטרף למועדון", when: "ללקוח שביקר ועוד לא במועדון", toggleKey: "club_invite_enabled",
              times: AFTER_VISIT("club_invite_delay_minutes", 30),
              templateKey: "non_member_wa_template", hints: ["client_name","join_link","points_on_signup"] },
            { id: "points_redeem", title: "מימוש נקודות", when: "כשלקוח מממש נקודות", toggleKey: "points_celebration_enabled",
              templateKey: "points_redeem_wa_template", hints: ["client_name","points_used","discount_amount","loyalty_points","studio_name"] },
            { id: "points_balance", title: "יתרת נקודות", when: "נשלחת ידנית מתיק הלקוח", manual: true,
              templateKey: "points_balance_wa_template", hints: ["client_name","loyalty_points"] },
        ],
    },
    {
        id: "app", title: "האפליקציה", icon: Smartphone,
        messages: [
            // {app_features}: one or two short lines — self-booking, a club member's points, appointments and receipts — by
            // the business's plan and settings; sent only once BizFind is in the App Store (app/services/app_invite.py)
            { id: "app_invite", title: "הזמנה לאפליקציית BizFind", when: "ללקוח אחרי הביקור הראשון, פעם אחת, או ידנית מתיק הלקוח — רק אחרי שאפליקציית BizFind ב-App Store",
              toggleKey: "app_invite_enabled", times: AFTER_VISIT("app_invite_delay_minutes", 1440),
              templateKey: "app_invite_wa_template", hints: ["client_name","studio_name","app_features","app_link"] },
        ],
    },
];

// Ready texts for each message, a tap away in the edit window (stage 3, the owner, 2026-10-13) — short, warm and
// formal; each uses only the details its message's code fills (the hints above).
const READY: Record<string, { label: string; text: string }[]> = {
    confirm: [
        { label: "קצר", text: "היי {client_name}, התור שלך נקבע ל-{appointment_date} בשעה {appointment_time}. מחכים לך!" },
        { label: "חם", text: "היי {client_name} 😊\nאיזה כיף! קבענו לך תור ל{appointment_title} ב-{appointment_date} בשעה {appointment_time}.\n📍 {studio_address}\n{map_link}\n\nאם משהו משתנה, פשוט כתבו לנו כאן. מחכים לראות אותך!" },
        { label: "רשמי", text: "שלום {client_name},\nתורך ל{appointment_title} נקבע ליום {appointment_date} בשעה {appointment_time}.\nכתובת: {studio_address}\nביטול ללא עלות עד {cancellation_free_days} ימים לפני התור." },
    ],
    deposit_request: [
        { label: "קצר", text: "היי {client_name}, שריינו לך תור ל-{appointment_date} בשעה {appointment_time}.\nלאישור התור נשמח למקדמה של ₪{deposit_amount}: {payment_link}" },
        { label: "חם", text: "היי {client_name} 😊\nשריינו לך תור ל{appointment_title} ב-{appointment_date} בשעה {appointment_time}.\nכדי לסגור את התור, נשמח למקדמה של ₪{deposit_amount} כאן: {payment_link}\nאחרי התשלום שלחו לנו אישור ונאשר. מחכים לך!" },
        { label: "רשמי", text: "שלום {client_name},\nתורך ל{appointment_title} נקבע ליום {appointment_date} בשעה {appointment_time}.\nלאישור סופי נדרשת מקדמה בסך ₪{deposit_amount}: {payment_link}\nביטול ללא עלות עד {cancellation_free_days} ימים לפני התור." },
    ],
    deposit_approved: [
        { label: "קצר", text: "היי {client_name}, המקדמה התקבלה והתור שלך ב-{appointment_date} בשעה {appointment_time} מאושר. מחכים לך!" },
        { label: "חם", text: "היי {client_name} 🙌\nקיבלנו את המקדמה — התור שלך מאושר!\n📅 {appointment_date} בשעה {appointment_time}\n📍 {studio_address}\n{map_link}\nנתראה!" },
        { label: "רשמי", text: "שלום {client_name},\nהמקדמה התקבלה ותורך ליום {appointment_date} בשעה {appointment_time} אושר.\nכתובת: {studio_address}\nביטול ללא עלות עד {cancellation_free_days} ימים לפני התור." },
    ],
    reschedule: [
        { label: "קצר", text: "היי {client_name}, התור שלך עבר ליום {appointment_day}, {appointment_date} בשעה {appointment_time}." },
        { label: "חם", text: "היי {client_name} 👋\nעדכנו את התור שלך ל{appointment_title}:\n📅 יום {appointment_day}, {appointment_date} בשעה {appointment_time}\nאם השעה לא מתאימה, כתבו לנו ונמצא יחד זמן אחר." },
        { label: "רשמי", text: "שלום {client_name},\nמועד תורך ל{appointment_title} שונה ליום {appointment_day}, {appointment_date} בשעה {appointment_time}." },
    ],
    cancel: [
        { label: "קצר", text: "היי {client_name}, התור שלך ב-{appointment_date} בשעה {appointment_time} בוטל." },
        { label: "חם", text: "היי {client_name},\nהתור שלך ל{appointment_title} ב-{appointment_date} בוטל.\nנשמח לקבוע לך תור חדש מתי שנוח — פשוט כתבו לנו 😊" },
        { label: "רשמי", text: "שלום {client_name},\nתורך ל{appointment_title} ביום {appointment_date} בשעה {appointment_time} בוטל.\nלתיאום מועד חדש ניתן לפנות אלינו." },
    ],
    reminder_7day: [
        { label: "קצר", text: "היי {client_name}, מזכירים: בעוד שבוע, ב-{appointment_date} בשעה {appointment_time}, יש לך תור אצלנו." },
        { label: "חם", text: "היי {client_name} 👋\nעוד שבוע נתראה! 📅 {appointment_date} בשעה {appointment_time} ל{appointment_title}.\nאם משהו משתנה, כתבו לנו." },
    ],
    reminder_3day: [
        { label: "קצר", text: "היי {client_name}, מזכירים: ב-{appointment_date} בשעה {appointment_time} יש לך תור אצלנו." },
        { label: "חם", text: "היי {client_name} 😊\nעוד 3 ימים נתראה ל{appointment_title}!\n📅 {appointment_date} בשעה {appointment_time}\n📍 {studio_address}\n{map_link}" },
    ],
    reminder_1day: [
        { label: "קצר", text: "היי {client_name}, תזכורת: מחר בשעה {appointment_time} יש לך תור. מחכים לך!" },
        { label: "חם", text: "היי {client_name} 👋\nמחר נתראה! 📅 {appointment_date} בשעה {appointment_time} ל{appointment_title}.\n📍 {studio_address}\n{map_link}\nמחכים לך!" },
        { label: "רשמי", text: "שלום {client_name},\nתזכורת לתורך מחר, {appointment_date}, בשעה {appointment_time}.\nכתובת: {studio_address}" },
    ],
    reminder_sameday: [
        { label: "קצר", text: "בוקר טוב {client_name}! היום בשעה {appointment_time} יש לך תור. מחכים לך ☀️" },
        { label: "חם", text: "בוקר טוב {client_name} ☀️\nהיום נתראה ל{appointment_title} בשעה {appointment_time}.\n📍 {studio_address}\n{map_link}\nמחכים לך!" },
    ],
    reminder_2h: [
        { label: "קצר", text: "היי {client_name}, נתראה בעוד כשעתיים — בשעה {appointment_time} 😊" },
        { label: "חם", text: "היי {client_name} 👋\nעוד מעט נתראה! התור שלך היום בשעה {appointment_time}.\n📍 {studio_address}\n{map_link}" },
    ],
    deposit_reminder: [
        { label: "קצר", text: "היי {client_name}, עוד לא קיבלנו את המקדמה של ₪{deposit_amount} לתור ב-{date} בשעה {time}. נשמח שתשלימו כדי לשמור את התור." },
        { label: "רשמי", text: "שלום {client_name},\nטרם התקבלה המקדמה בסך ₪{deposit_amount} לתורך ביום {date} בשעה {time}.\nללא תשלום המקדמה התור אינו מאושר סופית." },
    ],
    post_payment: [
        { label: "קצר", text: "תודה {client_name}! התשלום התקבל. שמחנו לראות אותך 🙏" },
        { label: "חם", text: "תודה רבה {client_name} ❤️\nהתשלום של ₪{payment_amount} התקבל.\n⭐ יתרת הנקודות שלך: {points_total}\nנשמח לראות אותך שוב!" },
    ],
    receipt_link: [
        { label: "קצר", text: "היי {client_name}, הקבלה שלך מחכה כאן: {receipt_link}" },
        { label: "רשמי", text: "שלום {client_name},\nמצורף קישור לקבלה עבור {service_name}:\n{receipt_link}\nתודה!" },
    ],
    pos_receipt: [
        { label: "קצר", text: "תודה על הרכישה, {client_name}! 🛍️" },
        { label: "חם", text: "היי {client_name} 😊\nתודה על הרכישה בסך {total_amount}!\n⭐ צברת {points_earned} נקודות — היתרה שלך: {loyalty_points}." },
    ],
    aftercare: [
        { label: "קצר", text: "היי {client_name}, תודה על הביקור! אם יש שאלה — אנחנו כאן 🙏" },
        { label: "חם", text: "היי {client_name} ❤️\nתודה שבחרת בנו! איך ההרגשה?\nאם יש שאלה על ההחלמה או הטיפול — כתבו לנו בכל שעה." },
    ],
    booking_request_approved: [
        { label: "קצר", text: "היי {client_name}, בקשת התור שלך אושרה! נתראה ב-{appointment_date}." },
        { label: "חם", text: "היי {client_name} 🎉\nבקשת התור שלך אושרה! נתראה עם {artist_name} ב-{appointment_date}.\nלפרטי התור: {booking_link}" },
    ],
    booking_request_rejected: [
        { label: "קצר", text: "היי {client_name}, לצערנו לא נוכל לקבל את התור ב-{appointment_date}. נשמח לקבוע מועד אחר." },
        { label: "רשמי", text: "שלום {client_name},\nבקשת התור ל-{appointment_date} לא אושרה.\nסיבה: {rejection_reason}\nנשמח לתאם מועד אחר." },
    ],
    waitlist_joined: [
        { label: "קצר", text: "היי {client_name}, נרשמת לרשימת ההמתנה של {studio_name}. נעדכן ברגע שיתפנה מקום!" },
        { label: "חם", text: "היי {client_name} 😊\nאת/ה ברשימת ההמתנה של {studio_name}.\nברגע שמתפנה מקום — נשלח לך הודעה ראשונים!" },
    ],
    waitlist_notify: [
        { label: "קצר", text: "היי {client_name}, התפנה מקום ב-{studio_name}! לקביעה: {booking_link}" },
        { label: "חם", text: "היי {client_name} 🎉\nחדשות טובות — התפנה תור ב-{studio_name}!\nכדאי לקבוע מהר: {booking_link}" },
    ],
    welcome: [
        { label: "קצר", text: "היי {client_name}, ברוך/ה הבא/ה למועדון שלנו! 🎉" },
        { label: "חם", text: "היי {client_name} 🎉\nשמחים שהצטרפת למועדון!\n🎁 קיבלת {points_added} נקודות מתנה — היתרה שלך: {points_total}.\nנתראה בקרוב!" },
    ],
    birthday: [
        { label: "קצר", text: "מזל טוב {client_name}! 🎂 מתנה מאיתנו: {benefit_percent}% הנחה עם הקוד {coupon_code}." },
        { label: "חם", text: "יום הולדת שמח {client_name}! 🎂🎉\nהכנו לך מתנה: {benefit_percent}% הנחה לביקור הבא.\nקוד הקופון שלך: {coupon_code}\nמחכים לחגוג איתך!" },
    ],
    non_member: [
        { label: "קצר", text: "היי {client_name}, שמחנו לראות אותך! הצטרפו למועדון וקבלו {points_on_signup} נקודות מתנה: {join_link}" },
        { label: "חם", text: "היי {client_name} 👋\nתודה שביקרת אצלנו!\nבמועדון הלקוחות שלנו מחכות לך {points_on_signup} נקודות מתנה לביקור הבא 🎁\nלהצטרפות: {join_link}" },
    ],
    points_redeem: [
        { label: "קצר", text: "היי {client_name}, מימשת {points_used} נקודות וחסכת ₪{discount_amount}! 🎁" },
        { label: "חם", text: "היי {client_name} 🎉\nמימשת {points_used} נקודות בשווי ₪{discount_amount}!\nנשארו לך {loyalty_points} נקודות. תודה שאת/ה חלק מהמועדון של {studio_name} ❤️" },
    ],
    app_invite: [
        { label: "קצר", text: "היי {client_name} 👋\n{app_features}\nלהורדה: {app_link}" },
        { label: "חם", text: "היי {client_name} 👋\nתודה שביקרת ב{studio_name}!\n{app_features}\nלהורדה: {app_link}" },
        { label: "רשמי", text: "שלום {client_name},\n{app_features}\nלהורדה: {app_link}" },
    ],
    points_balance: [
        { label: "קצר", text: "היי {client_name}, יתרת הנקודות שלך: {loyalty_points} ⭐" },
        { label: "חם", text: "היי {client_name} 🌟\nיש לך {loyalty_points} נקודות במועדון — אפשר לממש בביקור הבא.\nמחכים לך!" },
    ],
};

type Settings = Record<string, unknown> & { messages_off?: string[] };

// A client's own details stand in for {…} in the preview — an example, not anyone's real data
function sample(settings: Settings, staff: string, service: string): Record<string, string> {
    const d = new Date(Date.now() + 3 * 86400000);
    const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    return {
        client_name: "דנה", appointment_title: service, service_name: service, appointment_date: date, date, appointment_time: "10:00",
        time: "10:00", appointment_day: "רביעי", artist_name: "נועה", staff_title: staff, studio_name: String(settings.studio_name || "העסק שלך"),
        studio_address: String(settings.studio_address || "רחוב הדוגמה 1"), map_link: "https://maps.google.com/…",
        portfolio_link: "https://instagram.com/…", bit_link: "https://bit.ly/…", paybox_link: "https://payboxapp.page.link/…",
        payment_link: "https://bit.ly/…", deposit_amount: "100", cancellation_free_days: String(settings.cancellation_free_days ?? 2),
        deposit_lock_days: "2", loyalty_points: "120", points_earned: "25", points_total: "145", points_added: "20",
        points_on_signup: "20", payment_amount: "250", coupon_code: "BDAY10", benefit_percent: "10",
        join_link: "https://…/join", points_used: "50", discount_amount: "50", receipt_link: "https://…/receipt",
        booking_link: "https://…/booking", total_amount: "₪250.00", rejection_reason: "השעה כבר תפוסה", service_note: "",
    };
}

// In the edit box a detail is written in words — [שם לקוח] — not {client_name}: the owner never sees the system's keys.
// Saved back as {key}; a label two keys share (שם שירות) becomes the one this message knows.
function toWords(text: string, terms: ReturnType<typeof useTerms>): string {
    return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
        const p = PLACEHOLDERS.find(x => x.key === `{${key}}`);
        return p ? `[${fillTerms(p.label, terms)}]` : whole;
    });
}

function toKeys(text: string, hints: string[], terms: ReturnType<typeof useTerms>): string {
    return text.replace(/\[([^\]\n]+)\]/g, (whole, label: string) => {
        const same = PLACEHOLDERS.filter(x => fillTerms(x.label, terms) === label.trim());
        const p = same.find(x => hints.includes(x.key.slice(1, -1))) ?? same[0];
        return p ? p.key : whole;
    });
}

function fill(text: string, values: Record<string, string>): string {
    return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

// ── The page ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function MessageTemplatesPage() {
    const terms = useTerms();
    const [settings, setSettings] = useState<Settings>({});
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Message | null>(null);

    useEffect(() => {
        apiFetch<Settings>("/api/studio/automation")
            .then(d => { setSettings(d); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    // every change is saved at once — no "save" button to forget
    const save = useCallback(async (patch: Record<string, unknown>, done: string) => {
        try {
            const d = await apiFetch<Settings>("/api/studio/automation", { method: "PATCH", body: JSON.stringify(patch) });
            setSettings(d);
            toast.success(done);
            return true;
        } catch (e: unknown) {
            toast.error((e as Error)?.message || "שגיאה בשמירה");
            return false;
        }
    }, []);

    const isOn = (m: Message) => m.manual ? true
        : m.toggleKey ? (settings[m.toggleKey] as boolean | undefined) ?? true
            : !(settings.messages_off ?? []).includes(m.id);
    const setOn = (m: Message, on: boolean) => {
        const done = on ? `"${m.title}" פעילה` : `"${m.title}" כבויה — לא תישלח`;
        if (m.toggleKey) return save({ [m.toggleKey]: on }, done);
        const off = new Set(settings.messages_off ?? []);
        if (on) off.delete(m.id); else off.add(m.id);
        return save({ messages_off: Array.from(off) }, done);
    };

    const values = sample(settings, terms.staff, terms.service);

    return (
        <RequireAuth>
            <AppShell title="הודעות ללקוחות">
                <div className="max-w-3xl mx-auto pb-24" dir="rtl">
                    <div className="mb-6">
                        <p className="text-slate-600 leading-relaxed">
                            כאן בוחרים אילו הודעות יוצאות ללקוחות ומה כתוב בהן. כל הודעה נשלחת בוואטסאפ — ואם ללקוח יש מייל,
                            אותו טקסט נשלח גם למייל.
                        </p>
                    </div>

                    {loading ? (
                        <p className="text-center text-slate-400 py-16">טוען...</p>
                    ) : (
                        <div className="space-y-8">
                            {GROUPS.map(g => (
                                <section key={g.id} aria-labelledby={`g-${g.id}`}>
                                    <h2 id={`g-${g.id}`} data-tour={g.id === "club" ? "msg-marketing" : undefined} className="flex items-center gap-2 text-base font-black text-slate-800 mb-3">
                                        <g.icon className="w-5 h-5 text-sky-600" aria-hidden /> {g.title}
                                    </h2>
                                    <div className="space-y-3">
                                        {g.messages.map(m => (
                                            <MessageCard key={m.id} m={m} on={isOn(m)} text={(settings[m.templateKey] as string) || ""}
                                                tour={g === GROUPS[0] && m === g.messages[0]}
                                                values={values} settings={settings} terms={terms}
                                                onSwitch={v => setOn(m, v)} onEdit={() => setEditing(m)}
                                                onReset={() => save({ [m.templateKey]: null, ...(m.emailKey ? { [m.emailKey]: null } : {}) }, "חזר לנוסח של המערכת")}
                                                onSetting={(k, v, done) => save({ [k]: v }, done)} />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    )}
                </div>

                {editing && (
                    <EditSheet m={editing} text={(settings[editing.templateKey] as string) || ""} values={values} terms={terms}
                        onClose={() => setEditing(null)}
                        onSave={async t => {
                            const text = t.trim() ? t : null;
                            // one text — WhatsApp and e-mail alike
                            const ok = await save({ [editing.templateKey]: text, ...(editing.emailKey ? { [editing.emailKey]: text } : {}) }, "הנוסח נשמר");
                            if (ok) setEditing(null);
                        }} />
                )}
            </AppShell>
        </RequireAuth>
    );
}

// ── One message ───────────────────────────────────────────────────────────────────────────────────────────────────────
function MessageCard({ m, on, text, values, settings, terms, onSwitch, onEdit, onReset, onSetting, tour = false }: {
    m: Message; on: boolean; text: string; values: Record<string, string>; settings: Settings; terms: ReturnType<typeof useTerms>;
    tour?: boolean;      // the first message — what ויקי points at in "ההודעות ללקוחות" (lib/tours)
    onSwitch: (on: boolean) => void; onEdit: () => void; onReset: () => void;
    onSetting: (key: string, value: unknown, done: string) => void;
}) {
    const own = !!text.trim();
    return (
        <article data-tour={tour ? "msg-card" : undefined} className={`rounded-2xl border bg-white p-4 shadow-sm transition-opacity ${on ? "border-slate-200" : "border-slate-200 opacity-70"}`}>
            <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                    <h3 id={`m-${m.id}`} className="font-bold text-slate-900">{m.title}</h3>
                    <p className="text-sm text-slate-500 mt-0.5">{m.when}</p>
                </div>
                {m.manual ? (
                    <span className="shrink-0 text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">ידנית</span>
                ) : (
                    <div data-tour={tour ? "msg-switch" : undefined} className="shrink-0 flex items-center gap-2">
                        <span className={`text-xs font-bold ${on ? "text-emerald-700" : "text-slate-500"}`}>{on ? "פעילה" : "כבויה"}</span>
                        <Switch checked={on} onChange={onSwitch} labelledBy={`m-${m.id}`} />
                    </div>
                )}
            </div>

            {on ? (
                <>
                    {/* when it goes out — a tap on a ready time */}
                    {m.times && (() => {
                        const t = m.times;
                        const now = settings[t.key] ?? t.fallback;
                        const known = t.options.some(o => o.value === now);
                        return (
                            <div className="mt-3" role="radiogroup" aria-label={`${t.label} — ${m.title}`}>
                                <div className="text-sm font-semibold text-slate-700 mb-1.5">{t.label}</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {t.options.map(o => (
                                        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === now}
                                            onClick={() => o.value !== now && onSetting(t.key, o.value, `"${m.title}" — ${o.label}`)}
                                            className={`min-h-9 px-3 rounded-full text-sm font-semibold border transition-colors ${o.value === now ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-700 border-slate-200 hover:border-sky-300 hover:bg-sky-50"}`}>
                                            {o.label}
                                        </button>
                                    ))}
                                    {!known && t.other && typeof now === "number" && (
                                        <span role="radio" aria-checked className="min-h-9 px-3 inline-flex items-center rounded-full text-sm font-semibold border bg-sky-600 text-white border-sky-600">{t.other(now)}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    {/* what goes out */}
                    <div className="mt-3">
                        {own ? (
                            <Bubble text={fill(text, values)} autoDetails={m.autoDetails && !text.includes("{")} />
                        ) : (
                            <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 p-3 text-sm text-slate-600">
                                <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" aria-hidden />
                                <span>נשלח הנוסח של המערכת — עם הפרטים של כל לקוח ותור. רוצה נוסח משלך? לחצו "עריכת הנוסח".</span>
                            </div>
                        )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={onEdit} data-tour={tour ? "msg-edit" : undefined}
                            className="inline-flex items-center gap-1.5 min-h-10 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold">
                            <Pencil className="w-4 h-4" aria-hidden /> עריכת הנוסח
                        </button>
                        {own && (
                            <button type="button" onClick={onReset}
                                className="inline-flex items-center gap-1.5 min-h-10 px-4 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-semibold">
                                <RotateCcw className="w-4 h-4" aria-hidden /> חזרה לנוסח של המערכת
                            </button>
                        )}
                        <span className="ms-auto inline-flex items-center gap-1 text-xs text-slate-400">
                            <MessageCircle className="w-3.5 h-3.5" aria-hidden /> וואטסאפ
                            {m.emailKey && <><span aria-hidden>·</span><Mail className="w-3.5 h-3.5" aria-hidden /> מייל</>}
                        </span>
                    </div>
                </>
            ) : (
                <p className="mt-2 text-sm text-slate-500">ההודעה לא נשלחת. אפשר להפעיל אותה שוב בכל רגע.</p>
            )}
        </article>
    );
}

// ── How the client sees it ────────────────────────────────────────────────────────────────────────────────────────────
function Bubble({ text, autoDetails }: { text: string; autoDetails?: boolean }) {
    return (
        <div>
            <div className="rounded-2xl rounded-tr-sm bg-[#dcf8c6] text-slate-900 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word shadow-sm max-w-md">
                {text}
            </div>
            {autoDetails && <p className="text-xs text-slate-500 mt-1.5">ומתחת לטקסט המערכת מוסיפה את פרטי התור — תאריך, שעה, כתובת ומפה.</p>}
        </div>
    );
}

// ── Editing the text ──────────────────────────────────────────────────────────────────────────────────────────────────
function EditSheet({ m, text, values, terms, onClose, onSave }: {
    m: Message; text: string; values: Record<string, string>; terms: ReturnType<typeof useTerms>;
    onClose: () => void; onSave: (text: string) => Promise<void>;
}) {
    const [draft, setDraft] = useState(() => toWords(text, terms));
    const stored = toKeys(draft, m.hints, terms);
    const [saving, setSaving] = useState(false);
    const [more, setMore] = useState(false);
    const box = useRef<HTMLTextAreaElement>(null);
    const relevant = PLACEHOLDERS.filter(p => m.hints.includes(p.key.slice(1, -1)));
    const other = PLACEHOLDERS.filter(p => !m.hints.includes(p.key.slice(1, -1)));

    const insert = (ph: string) => {
        const el = box.current;
        if (!el) { setDraft(d => d + ph); return; }
        const a = el.selectionStart, b = el.selectionEnd;
        setDraft(d => d.slice(0, a) + ph + d.slice(b));
        setTimeout(() => { el.focus(); el.setSelectionRange(a + ph.length, a + ph.length); }, 0);
    };
    const chip = (p: { key: string; label: string }) => (
        <button key={p.key} type="button" onClick={() => insert(`[${fillTerms(p.label, terms)}]`)}
            className="min-h-9 px-3 rounded-full border border-sky-200 bg-sky-50 text-sky-800 text-sm font-semibold hover:bg-sky-100">
            + {fillTerms(p.label, terms)}
        </button>
    );

    return (
        <BottomSheet open onClose={onClose} title={`עריכת הנוסח — ${m.title}`}
            footer={
                <div className="flex gap-2">
                    <button type="button" disabled={saving} onClick={async () => { setSaving(true); await onSave(stored); setSaving(false); }}
                        className="flex-1 min-h-11 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold disabled:opacity-50">
                        {saving ? "שומר..." : "שמירה"}
                    </button>
                    <button type="button" onClick={onClose} className="min-h-11 px-5 rounded-xl border border-slate-200 text-slate-700 font-semibold">ביטול</button>
                </div>
            }>
            <div className="space-y-4" dir="rtl">
                <p className="text-sm text-slate-600">
                    הטקסט נשלח בוואטסאפ{m.emailKey ? " וגם במייל" : ""}. לחיצה על פרט מוסיפה אותו לטקסט — וכל לקוח יקבל את שלו.
                    {text ? "" : " השארת הטקסט ריק = הנוסח של המערכת."}
                </p>
                {(READY[m.id] ?? []).length > 0 && (
                    <div>
                        <div className="text-sm font-bold text-slate-700 mb-2">נוסחים מוכנים — נגיעה מכניסה, ואפשר לשנות</div>
                        <div className="grid gap-2">
                            {READY[m.id].map(r => (
                                <button key={r.label} type="button" onClick={() => setDraft(toWords(r.text, terms))}
                                    className="text-right rounded-xl border border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50 p-3">
                                    <span className="inline-block text-xs font-bold text-sky-700 bg-sky-50 border border-sky-100 rounded-full px-2 py-0.5 mb-1">{r.label}</span>
                                    <span className="block text-sm text-slate-700 whitespace-pre-line">{fill(r.text, values)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <textarea ref={box} value={draft} onChange={e => setDraft(e.target.value)} rows={7} dir="rtl" data-tour="msg-editor"
                    placeholder="כתבו כאן את ההודעה, למשל: היי [שם לקוח], מחכים לך ב-[תאריך תור] 😊"
                    aria-label={`הנוסח של ${m.title}`}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-sky-500" />
                <div>
                    <div className="text-sm font-bold text-slate-700 mb-2">הוספת פרטים</div>
                    <div className="flex flex-wrap gap-2">
                        {relevant.map(chip)}
                        {other.length > 0 && !more && (
                            <button type="button" onClick={() => setMore(true)} className="min-h-9 px-3 rounded-full border border-slate-200 text-slate-600 text-sm">עוד פרטים</button>
                        )}
                        {more && other.map(chip)}
                    </div>
                </div>
                {draft.trim() && (
                    <div data-tour="msg-preview">
                        <div className="text-sm font-bold text-slate-700 mb-2">כך הלקוח יראה את זה</div>
                        <Bubble text={fill(stored, values)} autoDetails={m.autoDetails && !stored.includes("{")} />
                    </div>
                )}
            </div>
        </BottomSheet>
    );
}
