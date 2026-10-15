"use client";

// The business's tools — one list for "ניהול עסק": the page on the computer and the phone's sheet (BottomNav), each
// tool once (the owner, 2026-10-15). What shows: by the plan (not in it — shown locked on the website when a plan on
// sale has it, hidden in the apps), by the platform's features, and for a manager by what the owner allowed him.
import { useEffect, useState } from "react";
import {
    Banknote, CalendarRange, ChartLine, ChartPie, Clock, Compass, ConciergeBell, CreditCard, Crown, FileDown, FileUp, Gift,
    HandCoins, HeartPulse, History, LayoutDashboard, LifeBuoy, Mail, Package, Phone, Receipt, Send, Settings,
    SlidersHorizontal, Smartphone, UserCog, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { apiFetch, getToken } from "@/lib/api";
import { isNativeApp } from "@/lib/platform";
import { usePlan } from "@/lib/usePlan";

// what the signed-in user may do (/api/auth/me — core/permissions.MANAGER_PERMISSIONS): a manager sees only what the
// owner allowed him (the owner, 2026-10-13)
export type Perm = "settings" | "receipts" | "money" | "team" | "attendance" | "owner";   // "owner": the owner only

export type BusinessItem = {
    href: string; label: string; description: string; icon: LucideIcon; module?: string; feature?: string; perm?: Perm;
    phoneOnly?: boolean;      // on the computer it's in the side menu already
};

// The categories (the owner, 2026-10-15: "a clean menu — eight tiles, each opens its screens") — only screens that
// exist, each once. New screens join their category (the team's tasks and shift schedule — "צוות ושכר").
export const SECTION_GROUPS: { groupLabel: string; icon: LucideIcon; items: BusinessItem[] }[] = [
    {
        groupLabel: "סקירה ודוחות",
        icon: LayoutDashboard,
        items: [
            { href: "/overview",           label: "סקירה",          description: "מה קורה היום — תורים, לידים ומשימות",            icon: Compass, phoneOnly: true },
            { href: "/analytics/business", label: "אנליטיקה עסקית", description: "הכנסות, תורים ושעות עמוסות",                     icon: ChartLine, module: "analytics", perm: "money" },
            { href: "/clients/analytics",  label: "אנליטיקת לקוחות", description: "שימור, ערך לקוח, לקוחות שנעלמו ואחוזי המרה",      icon: ChartPie },
        ],
    },
    {
        groupLabel: "כספים",
        icon: Wallet,
        items: [
            { href: "/payments",    label: "תשלומים",         description: "היסטוריית תשלומים ואישורים",                   icon: CreditCard },
            { href: "/invoices",    label: "חשבוניות",        description: "חשבוניות, קבלות ומסמכים כספיים",               icon: Receipt, perm: "receipts" },
            { href: "/expenses",    label: "הוצאות עסקיות",   description: "הוצאות, קטגוריות ודוחות",                      icon: HandCoins, perm: "money" },
            { href: "/obligations", label: "התחייבויות",      description: "התחייבויות ותשלומים עתידיים",                  icon: Banknote, module: "obligations", perm: "money" },
        ],
    },
    {
        groupLabel: "לקוחות ושיווק",
        icon: Users,
        items: [
            { href: "/clients",           label: "לקוחות",            description: "רשימה, כרטיס לקוח והיסטוריה",                 icon: Users, module: "crm" },
            { href: "/clients?tab=club",  label: "מועדון לקוחות",     description: "חברים, נקודות, לוח אלופים וימי הולדת",         icon: Crown, module: "customer_club" },
            { href: "/wallet",            label: "כרטיס דיגיטלי",      description: "עיצוב כרטיס מועדון ל-Apple/Google Wallet",     icon: Smartphone, module: "wallet" },
            { href: "/gift-cards",        label: "גיפט קארד וקופונים", description: "קישור למכירת גיפט קארד, קופונים ומעקב",        icon: Gift, module: "gift_cards" },
            { href: "/message-templates", label: "תבניות הודעות",      description: "תבניות לוואטסאפ ומייל",                        icon: Mail, perm: "settings" },
            { href: "/broadcasts",        label: "תפוצות",             description: "הודעות המוניות ומבצעים",                       icon: Send, module: "broadcasts" },
            { href: "/calls",             label: "שיחות",              description: "לוג שיחות, שיוך ללקוחות ויצירת תורים",          icon: Phone, feature: "voice" },
        ],
    },
    {
        groupLabel: "תורים ושירותים",
        icon: CalendarRange,
        items: [
            { href: "/services",         label: "שירותים",               description: "סוגי טיפול, מחירים ומשך זמן",                               icon: ConciergeBell, module: "services" },
            { href: "/wait-list",        label: "רשימת המתנה",           description: "לקוחות הממתינים לתור פנוי",                                  icon: Clock, module: "wait_list" },
            { href: "/classes",          label: "שיעורים",               description: "לוח השיעורים, שיעורים קבועים, קורסים וחדרים",                 icon: CalendarRange, module: "classes" },
            { href: "/classes/settings", label: "הגדרות שיעורים ומנויים", description: "הרשמה, ביטולים, רשימת המתנה והודעות ל{client_plural}",       icon: SlidersHorizontal, module: "classes" },
        ],
    },
    {
        groupLabel: "צוות ושכר",
        icon: UserCog,
        items: [
            { href: "/team",         label: "ניהול צוות", description: "{staff_plural}, תפקידים, שיטת תשלום ושעון נוכחות",      icon: UserCog },
            { href: "/team/payroll", label: "דוח שכר",     description: "מי, כמה ומתי — חישוב שכר חודשי לכל עובד/ת + PDF",       icon: Wallet, perm: "money" },
            { href: "/activity",     label: "יומן פעילות", description: "מי עשה מה ומתי — קבלות, מחיקות, הנחות, הגדרות וצוות",   icon: History, perm: "owner" },
        ],
    },
    {
        groupLabel: "מוצרים ומלאי",
        icon: Package,
        items: [
            { href: "/products", label: "מוצרים ומלאי", description: "קטלוג מוצרים, מחירים ומלאי", icon: Package, module: "products" },
        ],
    },
    {
        groupLabel: "הגדרות",
        icon: Settings,
        items: [
            { href: "/automation",           label: "הגדרות",        description: "מיתוג, אוטומציות, תשלומים, אינטגרציות והגדרות מייל", icon: Settings, perm: "settings" },
            { href: "/settings/health-form", label: "הצהרת בריאות",  description: "הטופס שהלקוח ממלא וחותם לפני הטיפול",             icon: HeartPulse },
            { href: "/migration",            label: "ייבוא נתונים",   description: "העברת לקוחות ושירותים ממערכת אחרת או מקובץ Excel", icon: FileUp, module: "migration" },
            { href: "/export",               label: "ייצוא לאקסל",    description: "הלקוחות והתורים שלך בקובץ אחד — לשמירה או למעבר",  icon: FileDown, perm: "owner" },
        ],
    },
    {
        groupLabel: "מרכז עזרה",
        icon: LifeBuoy,
        items: [
            { href: "/help", label: "מרכז עזרה", description: "מדריכים, תמיכה ויצירת קשר", icon: LifeBuoy },
        ],
    },
];

type Access = { features: Record<string, boolean>; perms: Record<Perm, boolean> | null };
let cached: { token: string | null; state: Promise<Access> } | null = null;

function load(): Promise<Access> {
    const token = getToken();
    if (!cached || cached.token !== token) {
        const state = Promise.all([
            apiFetch<Record<string, boolean>>("/api/studio/features/me").catch(() => ({})),
            apiFetch<{ role?: string; permissions?: Record<Perm, boolean> }>("/api/auth/me")
                .then(m => (m.permissions ? { ...m.permissions, owner: m.role === "owner" } : null))
                .catch(() => null),
        ]).then(([features, perms]) => ({ features, perms }));
        cached = { token, state };
    }
    return cached.state;
}

/** The groups and tools this user sees — asked once per visit, when `active` first turns on. */
export function useBusinessSections(active = true) {
    const plan = usePlan();
    const [isNative] = useState(() => isNativeApp());
    const [access, setAccess] = useState<Access | null>(null);
    useEffect(() => {
        if (!active) return;
        let alive = true;
        load().then(a => { if (alive) setAccess(a); });
        return () => { alive = false; };
    }, [active]);

    const visible = (item: BusinessItem) => {
        const moduleOk = !item.module || plan.has(item.module) || (!isNative && !!plan.upgrade(item.module));
        const featureOk = !item.feature || !!access?.features[item.feature];
        const perms = access?.perms ?? null;
        const permOk = !item.perm || (perms ? perms[item.perm] !== false : item.perm !== "owner");
        return moduleOk && featureOk && permOk;
    };
    const groups = SECTION_GROUPS
        .map(g => ({ ...g, items: g.items.filter(visible) }))
        .filter(g => g.items.length > 0);
    return { groups, plan };
}
