// The guided tours (components/tour) — the owner, 2026-10-15: "a new business owner learns the system step by step,
// inside it, each step checked, with praise after success".
//
// A step is done only when the thing really exists: `confirms` names items of the setup checklist that the server
// checks against real data (GET /api/dashboard/setup-progress). A step whose items aren't in the checklist (a feature
// not in the plan, an item the owner marked "not relevant") is left out.
//
// `moves` are what to do on the step's screen, each pointing at a marked element (data-tour="…"): the first one that
// applies (its `unless` item not yet done) and is on the screen now is the one shown — so the same list serves the
// phone and the computer, and follows the screen as a form opens.

export type TourMove = { target: string; say: string; unless?: string };

export type TourStep = {
    id: string;                 // api/tutorial_routes STEPS
    confirms: string[];         // setup-progress item ids
    href: string;               // where the step happens
    title: string;
    intro: string;              // what it is and why
    moves: TourMove[];
    done: string;               // the praise
};

export const OWNER_START_ID = "owner_start";

export const OWNER_START: TourStep[] = [
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
    },
];
