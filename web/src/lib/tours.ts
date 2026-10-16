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
    who: "owner" | "worker";
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
    who: "owner",
    title: "הצעדים הראשונים",
    auto: true,
    welcome: "אני ויקי, העוזרת האישית שלך ב-BizControl. נעבור יחד על הצעדים הראשונים",
    finish: "עוד צעדים מומלצים מחכים ברשימת \"הקמת העסק\" במסך הסקירה, ובמרכז העזרה יש מדריך לכל מסך.",
    next: "owner_workday",
    steps: [
        {
            id: "business",
            confirms: ["logo", "business_details"],
            href: "/automation?tab=branding",
            title: "פרטי העסק והלוגו",
            intro: "נתחיל מהבסיס: הלוגו והכתובת של העסק. הם מופיעים בהודעות ללקוחות ובדף העסק.",
            moves: [
                { target: "logo-upload", unless: "logo", say: "לחצו על \"בחר תמונה\" והעלו את הלוגו של העסק." },
                { target: "business-address", unless: "business_details", say: "כתבו את כתובת העסק, ואז לחצו למטה על \"שמור הגדרות העסק\"." },
            ],
            done: "פרטי העסק והלוגו נשמרו.",
            video: "/guide/guide-business.mp4",
        },
        {
            id: "service",
            confirms: ["first_service"],
            href: "/services",
            title: "שירות ראשון",
            intro: "שירות הוא מה שהעסק מוכר — קעקוע קטן, תספורת, טיפול פנים — עם מחיר ומשך.",
            moves: [
                { target: "service-form", say: "מלאו שם, מחיר ומשך, ולחצו \"צור שירות\"." },
                { target: "service-new", say: "לחצו על \"שירות חדש\"." },
            ],
            done: "השירות הראשון שלך נשמר.",
            video: "/guide/guide-service.mp4",
        },
        {
            id: "client",
            confirms: ["first_client"],
            href: "/clients",
            title: "לקוח ראשון",
            intro: "לכל לקוח יש כרטיס: פרטים, תורים, תשלומים והיסטוריה.",
            moves: [
                { target: "client-form", say: "כתבו שם וטלפון, ולחצו \"שמור\"." },
                { target: "client-new", say: "לחצו על \"לקוח חדש\"." },
            ],
            done: "הלקוח הראשון נוסף.",
            video: "/guide/guide-client.mp4",
        },
        {
            id: "appointment",
            confirms: ["first_appointment"],
            href: "/calendar",
            title: "תור ראשון",
            intro: "עכשיו נקבע ביומן תור ללקוח ולשירות שיצרתם.",
            moves: [
                { target: "appointment-form", say: "בחרו לקוח ושירות, ולחצו \"קבע תור חדש\"." },
                { target: "type-appointment", say: "בחרו \"קביעת תור\"." },
                { target: "appointment-new", say: "לחצו על + כדי לקבוע תור." },
                { target: "calendar-grid", say: "לחצו על שעה פנויה ביומן." },
            ],
            done: "התור הראשון נקבע ביומן.",
            video: "/guide/guide-appointment.mp4",
        },
        {
            id: "payment",
            confirms: ["payment_method"],
            href: "/automation?tab=finance",
            title: "אמצעי תשלום למקדמות",
            intro: "כדי שלקוחות יוכלו לשלם מקדמה, הוסיפו קישור לביט, לפייבוקס או פרטי חשבון בנק.",
            moves: [
                { target: "pay-bit", say: "הדביקו את קישור הביט שלכם (או פייבוקס, או פרטי בנק למטה), ולחצו \"שמור הגדרות העסק\"." },
            ],
            done: "אמצעי התשלום נשמר — מעכשיו הוא מופיע בדף התשלום של הלקוחות.",
            video: "/guide/guide-payment.mp4",
        },
    ],
};

export const OWNER_WORKDAY: TourDef = {
    id: "owner_workday",
    who: "owner",
    title: "יום עבודה",
    auto: false,
    welcome: "עכשיו נלמד את העבודה היומיומית",
    finish: "הסרטונים של כל הצעדים נמצאים במרכז העזרה, ושם יש גם מדריך לכל מסך.",
    steps: [
        {
            id: "pos_sale",
            confirms: ["pos_sale"],
            later: true,
            href: "/pos",
            title: "מכירה בקופה",
            intro: "בכל מכירה — שירות או מוצר — הקופה רושמת את התשלום ומפיקה קבלה ללקוח. כל מכירה היא קבלה אמיתית, אז עושים את זה במכירה האמיתית הבאה.",
            moves: [
                { target: "pos-checkout", enabled: true, say: "בחרו איך הלקוח שילם ולחצו על \"גבה\"." },
                { target: "pos-add", enabled: true, say: "לחצו על \"+ הוסף לעגלה\"." },
                { target: "pos-services", say: "בחרו את השירות שנמכר (או הקלידו את המחיר במקלדת)." },
                { target: "pos-pad", say: "הקלידו במקלדת את המחיר של מה שנמכר." },
            ],
            done: "המכירה נרשמה והקבלה הופקה.",
            video: "/guide/guide-pos_sale.mp4",
        },
        {
            id: "deposit",
            confirms: ["deposit_approved"],
            later: true,
            href: "/calendar",
            title: "אישור מקדמה",
            intro: "כשלקוח משלם מקדמה ולוחץ \"שילמתי\" בדף התשלום, תקבלו התראה. פותחים את התור ביומן ומאשרים — וזה מפיק קבלה.",
            moves: [
                { target: "deposit-confirm", say: "בחרו באיזה אמצעי התקבלה המקדמה, ולחצו \"אשר וצור קבלה\"." },
                { target: "deposit-approve", say: "לחצו על \"אישור המקדמה\"." },
                { target: "calendar-grid", say: "פתחו ביומן תור שמחכה למקדמה — מסומן בשעון חול, או בפעמון כשהלקוח דיווח ששילם." },
            ],
            done: "המקדמה אושרה והקבלה הופקה.",
            video: "/guide/guide-deposit.mp4",
        },
        {
            id: "worker_task",
            confirms: ["task_assigned"],
            href: "/calendar",
            title: "משימה לעובד",
            intro: "נותנים משימה לעובד: הוא מקבל הודעה, ותזכורת כל עוד לא סימן \"בוצע\".",
            moves: [
                { target: "task-assignee", say: "כתבו מה צריך לעשות, בחרו ב\"למי המשימה\" את העובד, ולחצו \"הוסף משימה\"." },
                { target: "type-task", say: "בחרו \"משימה / תזכורת\"." },
                { target: "calendar-grid", say: "לחצו על שעה פנויה ביומן." },
            ],
            done: "המשימה נמסרה — העובד קיבל הודעה.",
            video: "/guide/guide-worker_task.mp4",
        },
    ],
};

export const WORKER_START: TourDef = {
    id: "worker_start",
    who: "worker",
    title: "הצעדים הראשונים",
    auto: true,
    welcome: "אני ויקי, העוזרת האישית שלך. נעבור יחד על מה שחשוב לך ביומן",
    finish: "אפשר לקרוא לי שוב בכל רגע — לחצו על התמונה שלי למעלה.",
    steps: [
        {
            id: "calendar",
            confirms: [],
            manual: true,
            href: "/calendar",
            title: "היומן שלך",
            intro: "כאן מופיעים התורים והמשימות שלך. לחיצה על תור פותחת את הפרטים שלו.",
            moves: [{ target: "calendar-grid", say: "כאן מופיעים התורים והמשימות שלך. לחיצה על תור פותחת את הפרטים שלו." }],
            done: "",
        },
        {
            id: "clock",
            confirms: ["clock_in"],
            href: "/calendar",
            title: "החתמת כניסה",
            intro: "בתחילת יום עבודה מחתימים כניסה, ובסופו יציאה — השעות נכנסות לשכר.",
            moves: [{ target: "clock", say: "לחצו כאן כדי להחתים כניסה. אם בעסק יש מדבקה בכניסה — הצמידו אליה את הטלפון." }],
            done: "הכניסה נרשמה.",
            video: "/guide/guide-clock.mp4",
        },
        {
            id: "task_done",
            confirms: ["task_done"],
            href: "/calendar",
            title: "סימון משימה",
            intro: "משימה שקיבלתם מופיעה ביומן. כשמסיימים — מסמנים \"בוצע\", ובעל העסק מקבל עדכון.",
            moves: [
                { target: "task-done", say: "לחצו על \"בוצע\"." },
                { target: "task-item", say: "לחצו על המשימה ביומן." },
            ],
            done: "המשימה סומנה — בעל העסק קיבל עדכון.",
            video: "/guide/guide-task_done.mp4",
        },
    ],
};

export const TOURS: TourDef[] = [OWNER_START, OWNER_WORKDAY, WORKER_START];
