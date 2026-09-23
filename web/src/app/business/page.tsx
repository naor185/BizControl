"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    Briefcase, Lock, Unlock, KeyRound, Zap, BarChart3, ShieldCheck, ClipboardList, Timer,
    Wallet, Users, TrendingUp, Phone, Megaphone, Gift, Settings,
    CreditCard, Landmark, Receipt, Banknote, Tag, UserCog, MessageSquare, Bell, Target, Mail,
    Send, Clock, Package, ConciergeBell, Stamp, Smartphone, LifeBuoy,
    type LucideIcon,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import PinModal from "@/components/PinModal";
import { isBusinessSessionValid, clearBusinessSession } from "@/lib/businessSession";
import { apiFetch } from "@/lib/api";

type PinStatus = { has_pin: boolean; is_locked: boolean; locked_until: string | null };

const SECTION_GROUPS: { groupLabel: string; icon: LucideIcon; items: { href: string; label: string; description: string; icon: LucideIcon; gradient: string; module?: string; feature?: string }[] }[] = [
    {
        groupLabel: "כספים",
        icon: Wallet,
        items: [
            { href: "/payments",    label: "תשלומים",         description: "היסטוריית תשלומים ואישורים",                   icon: CreditCard, gradient: "from-violet-500 to-violet-700" },
            { href: "/expenses",    label: "הוצאות עסקיות",   description: "הוצאות, קטגוריות ודוחות",                      icon: BarChart3, gradient: "from-orange-500 to-orange-700" },
            { href: "/billing",     label: "מנוי וחיוב",      description: "תוכנית מנוי ופרטי חיוב",                       icon: Landmark, gradient: "from-indigo-500 to-indigo-700" },
            { href: "/invoices",    label: "חשבוניות",        description: "חשבוניות, קבלות ומסמכים כספיים",               icon: Receipt, gradient: "from-emerald-500 to-emerald-700" },
            { href: "/obligations", label: "התחייבויות",      description: "התחייבויות ותשלומים עתידיים",                  icon: Banknote, gradient: "from-red-500 to-red-700", module: "obligations" },
            { href: "/deposits",    label: "רשימת פיקדונות",  description: "פיקדונות שממתינים לגבייה או וויתור",           icon: Tag, gradient: "from-lime-600 to-emerald-700" },
        ],
    },
    {
        groupLabel: "צוות ושכר",
        icon: Users,
        items: [
            { href: "/team",         label: "ניהול צוות", description: "אמנים, תפקידים ושיטת תשלום",                     icon: UserCog, gradient: "from-cyan-500 to-cyan-700" },
            { href: "/team/payroll", label: "דוח שכר",     description: "מי, כמה ומתי — חישוב שכר חודשי לכל אמן + PDF",   icon: Wallet, gradient: "from-blue-500 to-blue-700" },
        ],
    },
    {
        groupLabel: "אנליטיקה ותובנות",
        icon: TrendingUp,
        items: [
            { href: "/analytics",          label: "אנליטיקות",       description: "מגמות, ביצועים ודוחות",         icon: TrendingUp, gradient: "from-fuchsia-500 to-fuchsia-700", module: "analytics" },
            { href: "/analytics/business", label: "אנליטיקה עסקית", description: "תובנות עסקיות מתקדמות",         icon: BarChart3, gradient: "from-violet-600 to-fuchsia-700",   module: "analytics" },
        ],
    },
    {
        groupLabel: "שירות לקוחות",
        icon: Phone,
        items: [
            { href: "/calls", label: "שיחות", description: "לוג שיחות, שיוך ללקוחות ויצירת תורים", icon: Phone, gradient: "from-teal-600 to-cyan-700", feature: "voice" },
        ],
    },
    {
        groupLabel: "תקשורת ולידים",
        icon: Megaphone,
        items: [
            { href: "/message-log",       label: "יומן הודעות",   description: "כל ההודעות שנשלחו",                     icon: MessageSquare, gradient: "from-pink-500 to-pink-700" },
            { href: "/booking-requests",  label: "בקשות תורים",   description: "בקשות ממתינות לאישור",                  icon: Bell, gradient: "from-amber-500 to-amber-700" },
            { href: "/leads",             label: "לידים",         description: "מעקב פניות ולקוחות פוטנציאליים",        icon: Target, gradient: "from-rose-500 to-rose-700" },
            { href: "/message-templates", label: "תבניות הודעות", description: "תבניות לוואטסאפ ומייל",                 icon: Mail, gradient: "from-pink-600 to-rose-700" },
            { href: "/broadcasts",        label: "תפוצות",        description: "הודעות המוניות ומבצעים",                icon: Send, gradient: "from-amber-600 to-orange-700", module: "broadcasts" },
            { href: "/wait-list",         label: "רשימת המתנה",   description: "לקוחות הממתינים לתור פנוי",             icon: Clock, gradient: "from-rose-600 to-pink-700",    module: "wait_list" },
        ],
    },
    {
        groupLabel: "מוצרים ומועדון",
        icon: Gift,
        items: [
            { href: "/products",   label: "מוצרים ומלאי",     description: "קטלוג מוצרים, מחירים ומלאי",             icon: Package, gradient: "from-sky-500 to-sky-700", module: "products" },
            { href: "/services",   label: "שירותים",          description: "סוגי טיפול, מחירים ומשך זמן",            icon: ConciergeBell, gradient: "from-sky-600 to-cyan-700", module: "services" },
            { href: "/gift-cards", label: "כרטיסי מתנה",      description: "מכירה ומעקב כרטיסי מתנה",                icon: Gift, gradient: "from-purple-600 to-fuchsia-700", module: "pos" },
            { href: "/stamps",     label: "כרטיסי מועדון",    description: "כרטיסיות חותמות ותוכנית נאמנות",         icon: Stamp, gradient: "from-purple-500 to-purple-700" },
            { href: "/wallet",     label: "ארנק דיגיטלי",      description: "עיצוב כרטיס נאמנות ל-Apple/Google Wallet", icon: Smartphone, gradient: "from-teal-500 to-teal-700" },
        ],
    },
    {
        groupLabel: "הגדרות מערכת",
        icon: Settings,
        items: [
            { href: "/automation",     label: "הגדרות",          description: "מיתוג, אוטומציות, תשלומים, אינטגרציות והגדרות מייל", icon: Settings, gradient: "from-slate-500 to-slate-700" },
            { href: "/help",           label: "מרכז עזרה",       description: "מדריכים, תמיכה ויצירת קשר",                     icon: LifeBuoy, gradient: "from-gray-500 to-gray-700" },
        ],
    },
];

export default function BusinessPage() {
    const router = useRouter();
    const [unlocked, setUnlocked] = useState(false);
    const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinMode, setPinMode] = useState<"verify" | "set">("verify");
    const [showSetPin, setShowSetPin] = useState(false);
    const [enabledModules, setEnabledModules] = useState<Record<string, boolean> | null>(null);
    const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);

    const checkSession = useCallback(() => {
        if (isBusinessSessionValid()) setUnlocked(true);
    }, []);

    useEffect(() => {
        checkSession();
        apiFetch<PinStatus>("/api/security/pin/status")
            .then(setPinStatus)
            .catch(() => setPinStatus({ has_pin: false, is_locked: false, locked_until: null }));
        apiFetch<Record<string, boolean>>("/api/modules/me")
            .then(setEnabledModules)
            .catch(() => setEnabledModules(null));
        apiFetch<Record<string, boolean>>("/api/studio/features/me")
            .then(setEnabledFeatures)
            .catch(() => setEnabledFeatures({}));
    }, [checkSession]);

    const handleUnlockClick = () => {
        setPinMode(pinStatus?.has_pin ? "verify" : "set");
        setShowPinModal(true);
    };

    const handlePinSuccess = () => {
        setShowPinModal(false);
        if (pinMode === "set") { setPinMode("verify"); setShowPinModal(true); }
        else { setUnlocked(true); setPinStatus(s => s ? { ...s, has_pin: true } : s); }
    };

    const handleLock = () => { clearBusinessSession(); setUnlocked(false); };

    if (!pinStatus) {
        return (
            <RequireAuth><AppShell>
                <div className="flex items-center justify-center h-full">
                    <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
                </div>
            </AppShell></RequireAuth>
        );
    }

    return (
        <RequireAuth>
            <AppShell>
                <div className="min-h-full" dir="rtl">

                    {/* ── Premium Hero Header ── */}
                    <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-violet-950 to-indigo-950">
                        {/* Background pattern */}
                        <div className="absolute inset-0 opacity-10" style={{
                            backgroundImage: "radial-gradient(circle at 20% 80%, #7c3aed 0%, transparent 50%), radial-gradient(circle at 80% 20%, #4f46e5 0%, transparent 50%)",
                        }} />
                        <div className="relative px-6 py-8">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-12 h-12 bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl flex items-center justify-center shadow-lg">
                                            <Briefcase className="w-6 h-6 text-white" />
                                        </div>
                                        <div>
                                            <h1 className="text-2xl font-black text-white tracking-tight">ניהול עסק</h1>
                                            <p className="text-violet-300 text-sm mt-0.5">מרכז השליטה הפיננסי של העסק שלך</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 flex-wrap mt-4">
                                        {[
                                            { icon: Lock, label: "מאובטח ב-PIN" },
                                            { icon: Zap, label: "גישה מהירה" },
                                            { icon: BarChart3, label: "כל הנתונים" },
                                        ].map(tag => (
                                            <span key={tag.label} className="flex items-center gap-1.5 text-xs bg-white/10 border border-white/15 text-violet-200 px-3 py-1 rounded-full font-medium">
                                                <tag.icon className="w-3.5 h-3.5" />
                                                {tag.label}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                {unlocked && (
                                    <button onClick={handleLock}
                                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-rose-500/30 border border-white/15 text-white text-sm font-semibold transition-all">
                                        <Lock className="w-4 h-4" /> נעל
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Locked state ── */}
                    {!unlocked && (
                        <div className="flex flex-col items-center justify-center py-20 px-6 text-center bg-gradient-to-b from-slate-50 to-white">
                            <div className="relative mb-8">
                                <div className="w-24 h-24 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-violet-500/40">
                                    <Lock className="w-10 h-10 text-white" />
                                </div>
                                <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-violet-100 rounded-xl flex items-center justify-center shadow">
                                    <ShieldCheck className="w-4 h-4 text-violet-600" />
                                </div>
                            </div>

                            <h2 className="text-2xl font-black text-slate-900 mb-2">אזור מאובטח</h2>
                            <p className="text-slate-500 text-base mb-8 max-w-sm leading-relaxed">
                                {pinStatus.has_pin
                                    ? "הזן את ה-PIN שלך כדי לגשת לכל הנתונים הפיננסיים"
                                    : "הגדר PIN אישי כדי לאבטח את הנתונים הפיננסיים שלך"}
                            </p>

                            <button onClick={handleUnlockClick}
                                className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-black px-10 py-4 rounded-2xl text-base shadow-xl shadow-violet-500/35 active:scale-95 transition-all">
                                {pinStatus.has_pin ? <Unlock className="w-5 h-5" /> : <KeyRound className="w-5 h-5" />}
                                {pinStatus.has_pin ? "הזן PIN לכניסה" : "הגדר PIN"}
                            </button>

                            {pinStatus.is_locked && (
                                <div className="flex items-center gap-2 mt-4 bg-orange-50 border border-orange-200 rounded-xl px-5 py-3 text-orange-700 text-sm font-medium">
                                    <Lock className="w-4 h-4 shrink-0" /> חשבון נעול זמנית בשל ניסיונות כושלים
                                </div>
                            )}

                            <div className="flex gap-6 mt-12 text-xs text-slate-400">
                                <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> PIN מוצפן</span>
                                <span className="flex items-center gap-1.5"><Timer className="w-3.5 h-3.5" /> נעילה אוטומטית</span>
                                <span className="flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" /> לוג אבטחה</span>
                            </div>
                        </div>
                    )}

                    {/* ── Unlocked — premium section grid ── */}
                    {unlocked && (
                        <div className="bg-gradient-to-b from-slate-50 to-white min-h-screen p-6 space-y-8">

                            {SECTION_GROUPS.map(group => {
                                const visibleItems = group.items.filter(item => {
                                    const moduleOk = !item.module || !enabledModules || enabledModules[item.module] !== false;
                                    const featureOk = !item.feature || !!enabledFeatures?.[item.feature];
                                    return moduleOk && featureOk;
                                });
                                if (visibleItems.length === 0) return null;
                                return (
                                <div key={group.groupLabel}>
                                    {/* Group header */}
                                    <div className="flex items-center gap-2 mb-4">
                                        <group.icon className="w-5 h-5 text-slate-400" />
                                        <span className="text-base font-bold text-slate-400 uppercase tracking-widest">{group.groupLabel}</span>
                                        <div className="flex-1 h-px bg-slate-200 mr-1" />
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {visibleItems.map(section => (
                                            <button
                                                key={section.href}
                                                onClick={() => router.push(section.href)}
                                                className="group relative bg-white rounded-2xl border border-slate-100 p-5 text-right hover:shadow-xl hover:shadow-slate-200/80 hover:-translate-y-1 transition-all duration-200 overflow-hidden"
                                            >
                                                {/* Same monochrome treatment as the sidebar nav icons — no
                                                    per-tile rainbow badge. The icon color is var(--foreground),
                                                    which is the same "טקסט" token the superadmin's global design
                                                    card already controls, so it's editable from there today. */}
                                                <div
                                                    className="absolute inset-0 opacity-0 group-hover:opacity-[0.06] transition-opacity duration-200 rounded-2xl"
                                                    style={{ background: "var(--primary)" }}
                                                />

                                                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200">
                                                    <section.icon className="w-7 h-7" style={{ color: "var(--foreground)" }} />
                                                </div>
                                                <div className="font-bold text-slate-900 text-lg mb-1">{section.label}</div>
                                                <div className="text-base text-slate-400 leading-relaxed">{section.description}</div>

                                                {/* Arrow */}
                                                <div className="absolute top-4 left-4 text-slate-200 group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all duration-200 text-lg">
                                                    ←
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                );
                            })}

                            {/* Change PIN footer */}
                            <div className="pt-2 border-t border-slate-100">
                                <button onClick={() => { setPinMode("set"); setShowSetPin(true); }}
                                    className="flex items-center gap-2 text-sm text-slate-400 hover:text-violet-600 transition-colors font-medium">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="3" />
                                        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                                    </svg>
                                    שנה PIN
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {showPinModal && <PinModal key={pinMode} mode={pinMode} onSuccess={handlePinSuccess} onClose={() => setShowPinModal(false)} />}
                {showSetPin && <PinModal mode="change" onSuccess={() => setShowSetPin(false)} onClose={() => setShowSetPin(false)} />}
            </AppShell>
        </RequireAuth>
    );
}
