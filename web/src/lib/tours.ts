import { tx } from "@/lib/i18n";
// The guided tours (components/tour) — the owner, 2026-10-15: "a new business owner learns the system step by step,
// inside it, each step checked, with praise after success".
//
// A step is done only when the thing really exists: `confirms` names checks the server makes against the real data
// (GET /api/tutorial/checks — the setup checklist, a sale at the till, a deposit approved, a task given, a shift
// clocked, a task marked done). A step whose check doesn't apply (not in the plan, marked "not relevant", no one to
// give a task to…) is left out. A step that only shows something (`manual`) is done when the user says "הבנתי".
// A step with money in it (`later`) — a sale, a deposit — is never practised on purpose: it makes a real receipt; it is
// checked by the next real one, and "אעשה את זה בפעם הבאה" moves on.
//
// `moves` are what to do on the step's screen, each pointing at a marked element (data-tour="…"): the first one that
// applies (its `unless` check not yet done; `enabled` — a button that can be pressed now) and is on the screen is shown,
// so the same list serves the phone and the computer and follows the screen as a form opens.

export type TourMove = { target: string; say: string; unless?: string; enabled?: boolean };

export type TourStep = {
    id: string;                 // api/tutorial_routes STEPS
    confirms: string[];         // check ids (api/tutorial_routes get_checks)
    manual?: boolean;           // nothing to check — "הבנתי"
    later?: boolean;            // done with the next real one — "אעשה את זה בפעם הבאה"
    href: string;               // where the step happens
    title: string;
    intro: string;              // what it is and why
    moves: TourMove[];
    done: string;               // the praise
    video?: string;             // a short recording of the step on a phone — web/public/guide (its cover: the same, .jpg)
};

export type TourDef = {
    id: string;
    title: string;
    auto: boolean;              // opens by itself once, for someone with its steps to do
    welcome: string;            // after "היי {name}!"
    finish: string;             // after "כל הכבוד, סיימת את …!"
    steps: TourStep[];
    next?: string;              // the tour offered when this one is finished
};

export const posterOf = (video: string) => video.replace(/\.mp4$/, ".jpg");

export const OWNER_START: TourDef = {
    id: "owner_start",
    title: tx("הצעדים הראשונים"),
    auto: true,
    welcome: tx("אני ויקי, העוזרת האישית שלך ב-BizControl. נעבור יחד על הצעדים הראשונים"),
    finish: tx("עוד צעדים מומלצים מחכים ברשימת \"הקמת העסק\" בלוח הבקרה, ובמרכז העזרה יש מדריך לכל מסך."),
    next: "owner_messages",          // the owner, 2026-10-17: the messages before the working day
    steps: [
        {
            id: "business",
            confirms: ["logo", "business_details"],
            href: "/automation?tab=branding",
            title: tx("פרטי העסק והלוגו"),
            intro: tx("נתחיל מהבסיס: הלוגו והכתובת של העסק. הם מופיעים בהודעות ללקוחות ובדף העסק."),
            moves: [
                { target: "logo-upload", unless: "logo", say: tx("לחצו על \"בחר תמונה\" והעלו את הלוגו של העסק.") },
                { target: "business-address", unless: "business_details", say: tx("כתבו את כתובת העסק, ואז לחצו למטה על \"שמור הגדרות העסק\".") },
            ],
            done: tx("פרטי העסק והלוגו נשמרו."),
            video: "/guide/guide-business.mp4",
        },
        {
            id: "service",
            confirms: ["first_service"],
            href: "/services",
            title: tx("שירות ראשון"),
            intro: tx("שירות הוא מה שהעסק מוכר — למשל תספורת, קעקוע, טיפול פנים, או כל שירות אחר. לכל שירות אפשר לבחור צבע, ואם המחיר קבוע — גם מחיר."),
            moves: [
                { target: "service-form", say: tx("מלאו שם ומשך — ומחיר, אם הוא קבוע — ולחצו \"צור שירות\".") },
                { target: "service-new", say: tx("לחצו על \"שירות חדש\".") },
            ],
            done: tx("השירות הראשון שלך נשמר."),
            video: "/guide/guide-service.mp4",
        },
        {
            id: "client",
            confirms: ["first_client"],
            href: "/clients",
            title: tx("לקוח ראשון"),
            intro: tx("לכל לקוח יש כרטיס: פרטים, תורים, תשלומים והיסטוריה."),
            moves: [
                { target: "client-form", say: tx("כתבו שם וטלפון, ולחצו \"שמור\". אפשר להתחיל מהשם והטלפון שלכם — לראות איך זה באמת עובד, ואחר כך למחוק אם תרצו. ואפשר גם לקוח אמיתי — מה שתחליטו.") },
                { target: "client-new", say: tx("לחצו על \"לקוח חדש\".") },
            ],
            done: tx("הלקוח הראשון נוסף."),
            video: "/guide/guide-client.mp4",
        },
        {
            id: "appointment",
            confirms: ["first_appointment"],
            href: "/calendar",
            title: tx("תור ראשון"),
            intro: tx("עכשיו נקבע ביומן תור ללקוח ולשירות שיצרתם."),
            moves: [
                { target: "appointment-form", say: tx("בחרו לקוח ושירות, ולחצו \"קבע תור חדש\".") },
                { target: "type-appointment", say: tx("בחרו \"קביעת תור\".") },
                { target: "appointment-new", say: tx("לחצו על + כדי לקבוע תור.") },
                { target: "calendar-grid", say: tx("לחצו על שעה פנויה ביומן.") },
            ],
            done: tx("התור הראשון נקבע ביומן."),
            video: "/guide/guide-appointment.mp4",
        },
        {
            id: "payment",
            confirms: ["payment_method"],
            href: "/automation?tab=finance",
            title: tx("אמצעי תשלום למקדמות"),
            intro: tx("כדי שלקוחות יוכלו לשלם מקדמה, הוסיפו קישור לביט, לפייבוקס או פרטי חשבון בנק."),
            moves: [
                { target: "pay-bit", say: tx("הדביקו את קישור הביט שלכם (או פייבוקס, או פרטי בנק למטה), ולחצו \"שמור הגדרות העסק\".") },
            ],
            done: tx("אמצעי התשלום נשמר — מעכשיו הוא מופיע בדף התשלום של הלקוחות."),
            video: "/guide/guide-payment.mp4",
        },
    ],
};

export const OWNER_WORKDAY: TourDef = {
    id: "owner_workday",
    title: tx("יום עבודה"),
    auto: false,
    welcome: tx("עכשיו נלמד את העבודה היומיומית"),
    finish: tx("הסרטונים של כל הצעדים נמצאים במרכז העזרה, ושם יש גם מדריך לכל מסך."),
    steps: [
        {
            id: "pos_sale",
            confirms: ["pos_sale"],
            later: true,
            href: "/pos",
            title: tx("מכירה בקופה"),
            intro: tx("בכל מכירה — שירות או מוצר — הקופה רושמת את התשלום ומפיקה קבלה ללקוח. כל מכירה היא קבלה אמיתית, אז עושים את זה במכירה האמיתית הבאה."),
            moves: [
                { target: "pos-checkout", enabled: true, say: tx("בחרו איך הלקוח שילם ולחצו על \"גבה\".") },
                { target: "pos-add", enabled: true, say: tx("לחצו על \"+ הוסף לעגלה\".") },
                { target: "pos-services", say: tx("בחרו את השירות שנמכר (או הקלידו את המחיר במקלדת).") },
                { target: "pos-pad", say: tx("הקלידו במקלדת את המחיר של מה שנמכר.") },
            ],
            done: tx("המכירה נרשמה והקבלה הופקה."),
            video: "/guide/guide-pos_sale.mp4",
        },
        {
            id: "deposit",
            confirms: ["deposit_approved"],
            later: true,
            href: "/calendar",
            title: tx("אישור מקדמה"),
            intro: tx("כשלקוח משלם מקדמה ולוחץ \"שילמתי\" בדף התשלום, תקבלו התראה. פותחים את התור ביומן ומאשרים — וזה מפיק קבלה."),
            moves: [
                { target: "deposit-confirm", say: tx("בחרו באיזה אמצעי התקבלה המקדמה, ולחצו \"אשר וצור קבלה\".") },
                { target: "deposit-approve", say: tx("לחצו על \"אישור המקדמה\".") },
                { target: "calendar-grid", say: tx("פתחו ביומן תור שמחכה למקדמה — מסומן בשעון חול, או בפעמון כשהלקוח דיווח ששילם.") },
            ],
            done: tx("המקדמה אושרה והקבלה הופקה."),
            video: "/guide/guide-deposit.mp4",
        },
        {
            id: "worker_task",
            confirms: ["task_assigned"],
            href: "/calendar",
            title: tx("משימה לעובד"),
            intro: tx("נותנים משימה לעובד: הוא מקבל הודעה, ותזכורת כל עוד לא סימן \"בוצע\"."),
            moves: [
                { target: "task-assignee", say: tx("כתבו מה צריך לעשות, בחרו ב\"למי המשימה\" את העובד, ולחצו \"הוסף משימה\".") },
                { target: "type-task", say: tx("בחרו \"משימה / תזכורת\".") },
                { target: "calendar-grid", say: tx("לחצו על שעה פנויה ביומן.") },
            ],
            done: tx("המשימה נמסרה — העובד קיבל הודעה."),
            video: "/guide/guide-worker_task.mp4",
        },
    ],
};

// The messages that go out to clients (the owner, 2026-10-16): where they are and when each goes out, turning one off
// (for everyone), changing its words and seeing it as the client will, and a client's removal from marketing — all
// shown, nothing changed for the owner ("הבנתי").
export const OWNER_MESSAGES: TourDef = {
    id: "owner_messages",
    title: tx("ההודעות ללקוחות"),
    auto: false,
    welcome: tx("עכשיו נראה את ההודעות שיוצאות ללקוחות שלך"),
    next: "owner_workday",
    finish: tx("עכשיו אתם יודעים בדיוק מה יוצא ללקוחות ומתי. ההודעות תמיד כאן: ניהול עסק ← לקוחות ושיווק ← תבניות הודעות."),
    steps: [
        {
            id: "messages_where",
            confirms: [],
            manual: true,
            href: "/message-templates",
            title: tx("כל ההודעות במקום אחד"),
            intro: tx("כאן כל ההודעות שהמערכת שולחת ללקוחות בשבילך — אישור תור, תזכורות, תשלומים ומועדון. ליד כל הודעה כתוב מתי היא יוצאת."),
            moves: [{ target: "msg-card", say: tx("כל כרטיס הוא הודעה אחת: מה היא, ומתי היא יוצאת. ההודעות יוצאות לבד — לא צריך לעשות כלום.") }],
            done: "",
            video: "/guide/guide-messages_where.mp4",
        },
        {
            id: "messages_off",
            confirms: [],
            manual: true,
            href: "/message-templates",
            title: tx("לכבות הודעה"),
            intro: tx("לא רוצים שהודעה מסוימת תצא? מכבים אותה במתג — והיא לא תצא לאף לקוח."),
            moves: [{ target: "msg-switch", say: tx("זה המתג של ההודעה. כבוי — היא לא יוצאת לאף לקוח. תזכורות ואישורים לתורים יוצאים תמיד, אלא אם כיביתם אותם כאן.") }],
            done: "",
            video: "/guide/guide-messages_off.mp4",
        },
        {
            id: "messages_text",
            confirms: [],
            manual: true,
            href: "/message-templates",
            title: tx("לשנות את הנוסח"),
            intro: tx("אפשר לכתוב לכל הודעה נוסח משלכם, ולראות בדיוק איך הלקוח יראה אותה לפני ששומרים."),
            moves: [
                { target: "msg-preview", say: tx("כאן רואים איך ההודעה תיראה ללקוח, עם הפרטים שלו. מרוצים? לחצו \"שמירה\".") },
                { target: "msg-editor", say: tx("כתבו כאן את הנוסח, או בחרו נוסח מוכן. הכפתורים למטה מוסיפים פרטים — שם הלקוח, תאריך, שעה.") },
                { target: "msg-edit", say: tx("לחצו \"עריכת הנוסח\".") },
            ],
            done: "",
            video: "/guide/guide-messages_text.mp4",
        },
        {
            id: "messages_optout",
            confirms: [],
            manual: true,
            href: "/message-templates",
            title: tx("הסרה מהודעות שיווקיות"),
            intro: tx("לקוח שלא רוצה הודעות שיווקיות — תפוצות, הזמנה למועדון, ברכת יום הולדת — יכול להסיר את עצמו."),
            moves: [{ target: "msg-marketing", say: tx("הלקוח מסיר את עצמו בקישור שבהודעה, או בתשובה \"הסר\" בוואטסאפ — ואפשר גם לכבות לו את זה בכרטיס הלקוח. תזכורות ואישורים לתורים ימשיכו לצאת אליו.") }],
            done: "",
            video: "/guide/guide-messages_optout.mp4",
        },
    ],
};

export const TOURS: TourDef[] = [OWNER_START, OWNER_MESSAGES, OWNER_WORKDAY];
