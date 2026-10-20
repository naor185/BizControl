// The system's languages — Hebrew and English (the owner, 2026-10-19: Arabic out). The choice is kept in the user's
// account (PUT /api/auth/me/locale — the owner's is the business's too) and on the device, for the first paint.
import { EN } from "@/lib/en";

export type Locale = "he" | "en";

export const LOCALES: { code: Locale; label: string; short: string; dir: "rtl" | "ltr" }[] = [
    { code: "he", label: "עברית",  short: "עב", dir: "rtl" },
    { code: "en", label: "English", short: "EN", dir: "ltr" },
];

export const LOCALE_KEY = "biz_locale";

/** The language kept on this device — he unless it's en (an old "ar" too). */
export function savedLocale(): Locale {
    try { return localStorage.getItem(LOCALE_KEY) === "en" ? "en" : "he"; } catch { return "he"; }
}

// The screens' own texts in the chosen language — tx("טקסט", { 0: n }) anywhere, in a component or not (the
// translation's stages 2–4; the screens are written in Hebrew, English from lib/en.ts — a text without English yet
// stays Hebrew). The language is read when the page loads; changing it reloads the page (components/LanguageProvider),
// so texts worked out when a module loads are right too. The signed-in screens render after the browser loads
// (RequireAuth), so the server's Hebrew page never meets an English first paint.
let txLocale: Locale = typeof window === "undefined" ? "he" : savedLocale();

export function setTxLocale(l: Locale) { txLocale = l; }

/** A page to the business's clients — booking, payment, gift card, joining the club, the health form… — speaks the
 *  business's language (the `locale` its public answer carries), not the device's: the texts (tx) and the direction,
 *  Hebrew right to left and English left to right. Called with the answer, before the page shows it. */
export function speakBusiness(locale: string | null | undefined): Locale {
    const l: Locale = locale === "en" ? "en" : "he";
    txLocale = l;
    if (typeof document !== "undefined") {
        document.documentElement.lang = l;
        document.documentElement.dir = l === "en" ? "ltr" : "rtl";
    }
    return l;
}

/** The X-Lang header in the page's language — a public page's requests (plain fetch, not apiFetch) get the server's
 *  messages in it too. */
export const langHeader = (): Record<string, string> => ({ "X-Lang": txLocale });

/** The dates' and numbers' locale for the chosen language. */
export const intl = (): string => (txLocale === "en" ? "en-GB" : "he-IL");

export function tx(he: string, vars?: Record<string | number, unknown>): string {
    let out = he;
    if (txLocale === "en") {
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(he);      // the spaces around a text stay where they were
        let hit = m ? EN[m[2]] : undefined;
        // Hebrew glues a prefix to what follows ("ב-08:00", "ל-40") — the English word needs its space
        if (m && hit && /[בלמהשוכ]-$/.test(m[2]) && !/\s$/.test(hit)) hit += " ";
        if (m && hit !== undefined) out = m[1] + hit + m[3];
    }
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
    return out;
}

export const translations = {
    he: {
        // Nav
        nav_calendar:   "יומן תורים",
        nav_my_shifts:  "המשמרות שלי",
        nav_business:   "ניהול עסק",
        nav_expenses:   "הוצאות",
        nav_products:   "מוצרים ומלאי",
        nav_dashboard:  "לוח בקרה",
        nav_clients:    "לקוחות",
        nav_club:       "מועדון VIP",
        nav_team:       "ניהול צוות",
        nav_payroll:    "דוחות שכר",
        nav_payments:   "תשלומים",
        nav_settings:   "הגדרות",
        nav_help:       "מרכז עזרה",
        nav_leads:      "לידים",
        nav_wallet:     "Wallet Card",
        nav_pos:        "קופה",
        nav_more:       "עוד",
        nav_msg_templates: "תבניות הודעות",
        // Auth
        login_title:    "התחברות למערכת",
        login_subtitle: "הזן את פרטי הגישה שלך",
        login_slug:     "מזהה עסק (לא חובה לבעלי עסק)",
        login_email:    "אימייל",
        login_password: "סיסמה",
        login_remember: "זכור אותי",
        login_btn:      "התחבר",
        login_loading:  "מתחבר...",
        login_2fa_title: "אימות דו-שלבי",
        login_2fa_sub:  "הכנס את הקוד מאפליקציית האימות",
        login_2fa_btn:  "כניסה",
        login_2fa_back: "חזור",
        // Common
        save:     "שמור",
        saving:   "שומר...",
        cancel:   "ביטול",
        delete:   "מחיקה",
        edit:     "עריכה",
        add:      "הוסף",
        close:    "סגור",
        loading:  "טוען...",
        error:    "שגיאה",
        success:  "בוצע",
        logout:   "התנתקות",
        // Dashboard
        dash_today:     "גבייה יומית",
        dash_analytics: "אנליטיקה",
        dash_revenue:   "הכנסות",
        dash_appointments: "תורים",
        // Clients
        client_name:  "שם לקוח",
        client_phone: "טלפון",
        client_email: "אימייל",
        client_notes: "הערות",
        // Appointments
        appt_scheduled: "מתוכנן",
        appt_done:      "בוצע",
        appt_canceled:  "בוטל",
        appt_no_show:   "לא הגיע",
        // Billing
        // Portal
        portal_welcome:  "שלום,",
        portal_points:   "נקודות",
        portal_upcoming: "קרובים",
        portal_history:  "היסטוריה",
        portal_cancel:   "ביטול תור",
        portal_artist:   "נותן/ת השירות",
        portal_price:    "מחיר",
        portal_deposit:  "מקדמה",
        portal_remaining: "נשאר",
        portal_exit:     "יציאה",
    },
    en: {
        // Nav
        nav_calendar:   "Calendar",
        nav_my_shifts:  "My shifts",
        nav_business:   "Business",
        nav_expenses:   "Expenses",
        nav_products:   "Products",
        nav_dashboard:  "Dashboard",
        nav_clients:    "Clients",
        nav_club:       "VIP Club",
        nav_team:       "Team",
        nav_payroll:    "Payroll",
        nav_payments:   "Payments",
        nav_settings:   "Settings",
        nav_help:       "Help",
        nav_leads:      "Leads",
        nav_wallet:     "Wallet Card",
        nav_pos:        "Register",
        nav_more:       "More",
        nav_msg_templates: "Msg Templates",
        // Auth
        login_title:    "Sign in",
        login_subtitle: "Enter your access credentials",
        login_slug:     "Studio ID (optional for owners)",
        login_email:    "Email",
        login_password: "Password",
        login_remember: "Remember me",
        login_btn:      "Sign in",
        login_loading:  "Signing in...",
        login_2fa_title: "Two-Factor Authentication",
        login_2fa_sub:  "Enter the code from your authenticator app",
        login_2fa_btn:  "Verify",
        login_2fa_back: "Back",
        // Common
        save:     "Save",
        saving:   "Saving...",
        cancel:   "Cancel",
        delete:   "Delete",
        edit:     "Edit",
        add:      "Add",
        close:    "Close",
        loading:  "Loading...",
        error:    "Error",
        success:  "Done",
        logout:   "Logout",
        // Dashboard
        dash_today:     "Daily Collection",
        dash_analytics: "Analytics",
        dash_revenue:   "Revenue",
        dash_appointments: "Appointments",
        // Clients
        client_name:  "Client Name",
        client_phone: "Phone",
        client_email: "Email",
        client_notes: "Notes",
        // Appointments
        appt_scheduled: "Scheduled",
        appt_done:      "Done",
        appt_canceled:  "Canceled",
        appt_no_show:   "No Show",
        // Billing
        // Portal
        portal_welcome:  "Hello,",
        portal_points:   "Points",
        portal_upcoming: "Upcoming",
        portal_history:  "History",
        portal_cancel:   "Cancel Appointment",
        portal_artist:   "Artist",
        portal_price:    "Price",
        portal_deposit:  "Deposit",
        portal_remaining: "Remaining",
        portal_exit:     "Sign Out",
    },
} as const;

export type TranslationKey = keyof (typeof translations)["he"];
export type Translations = typeof translations;
