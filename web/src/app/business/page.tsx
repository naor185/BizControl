"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import PinModal from "@/components/PinModal";
import { isBusinessSessionValid, clearBusinessSession, refreshBusinessActivity } from "@/lib/businessSession";
import { apiFetch } from "@/lib/api";

type PinStatus = { has_pin: boolean; is_locked: boolean; locked_until: string | null };

type Section = {
    href: string;
    label: string;
    description: string;
    icon: string;
    color: string;
};

type SectionGroup = {
    groupLabel: string;
    items: Section[];
};

const SECTION_GROUPS: SectionGroup[] = [
    {
        groupLabel: "כספים",
        items: [
            { href: "/payments", label: "תשלומים", description: "היסטוריית תשלומים ואישורים", icon: "💳", color: "from-violet-500 to-violet-600" },
            { href: "/expenses", label: "הוצאות עסקיות", description: "הוצאות, קטגוריות ודוחות", icon: "📊", color: "from-orange-500 to-orange-600" },
            { href: "/billing", label: "מנוי וחיוב", description: "תוכנית מנוי ופרטי חיוב", icon: "🏦", color: "from-indigo-500 to-indigo-600" },
        ],
    },
    {
        groupLabel: "צוות",
        items: [
            { href: "/team", label: "ניהול צוות", description: "עובדים, הרשאות וגדרות אישיות", icon: "👥", color: "from-blue-500 to-blue-600" },
            { href: "/team/payroll", label: "דוחות שכר", description: "שכר שעתי, עמלות ותשלומים", icon: "💰", color: "from-emerald-500 to-emerald-600" },
        ],
    },
    {
        groupLabel: "תקשורת ולידים",
        items: [
            { href: "/inbox", label: "תיבת הודעות", description: "הודעות נכנסות מלקוחות", icon: "📬", color: "from-teal-500 to-teal-600" },
            { href: "/message-log", label: "יומן הודעות", description: "כל ההודעות שנשלחו", icon: "💬", color: "from-pink-500 to-pink-600" },
            { href: "/booking-requests", label: "בקשות תורים", description: "בקשות ממתינות לאישור", icon: "🔔", color: "from-amber-500 to-amber-600" },
            { href: "/leads", label: "לידים", description: "מעקב פניות ולקוחות פוטנציאליים", icon: "🎯", color: "from-rose-500 to-rose-600" },
        ],
    },
    {
        groupLabel: "מוצרים ומלאי",
        items: [
            { href: "/products", label: "מוצרים ומלאי", description: "קטלוג מוצרים, מחירים ומלאי", icon: "📦", color: "from-sky-500 to-sky-600" },
        ],
    },
    {
        groupLabel: "מועדון לקוחות",
        items: [
            { href: "/stamps", label: "כרטיסי מועדון", description: "כרטיסיות חותמות ותוכנית נאמנות", icon: "🎁", color: "from-purple-500 to-purple-600" },
        ],
    },
    {
        groupLabel: "הגדרות מערכת",
        items: [
            { href: "/automation", label: "הגדרות", description: "מיתוג, אוטומציות, תשלומים, אינטגרציות ועוד", icon: "⚙️", color: "from-slate-500 to-slate-600" },
            { href: "/help", label: "מרכז עזרה", description: "מדריכים, תמיכה ויצירת קשר", icon: "🆘", color: "from-gray-500 to-gray-600" },
        ],
    },
];

// Flat list for other uses
const SECTIONS: Section[] = SECTION_GROUPS.flatMap(g => g.items);

export default function BusinessPage() {
    const router = useRouter();
    const [unlocked, setUnlocked] = useState(false);
    const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinMode, setPinMode] = useState<"verify" | "set">("verify");
    const [showSetPin, setShowSetPin] = useState(false);

    const checkSession = useCallback(() => {
        if (isBusinessSessionValid()) {
            setUnlocked(true);
        }
    }, []);

    useEffect(() => {
        checkSession();
        apiFetch<PinStatus>("/api/security/pin/status")
            .then(setPinStatus)
            .catch(() => { });
    }, [checkSession]);

    // Activity refresh on interaction
    useEffect(() => {
        if (!unlocked) return;
        const refresh = () => {
            refreshBusinessActivity();
        };
        window.addEventListener("click", refresh);
        window.addEventListener("keydown", refresh);

        // Session expiry check every minute
        const timer = setInterval(() => {
            if (!isBusinessSessionValid()) {
                setUnlocked(false);
                setShowPinModal(true);
            }
        }, 60_000);

        return () => {
            window.removeEventListener("click", refresh);
            window.removeEventListener("keydown", refresh);
            clearInterval(timer);
        };
    }, [unlocked]);

    const handleUnlockClick = () => {
        if (!pinStatus) return;
        if (!pinStatus.has_pin) {
            setPinMode("set");
        } else {
            setPinMode("verify");
        }
        setShowPinModal(true);
    };

    const handlePinSuccess = () => {
        setShowPinModal(false);
        if (pinMode === "set") {
            // After setting PIN, ask to verify immediately to unlock
            setPinMode("verify");
            setShowPinModal(true);
        } else {
            setUnlocked(true);
            setPinStatus(s => s ? { ...s, has_pin: true } : s);
        }
    };

    const handleLock = () => {
        clearBusinessSession();
        setUnlocked(false);
    };

    // Loading state
    if (!pinStatus) {
        return (
            <RequireAuth>
                <AppShell>
                    <div className="flex items-center justify-center h-full">
                        <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
                    </div>
                </AppShell>
            </RequireAuth>
        );
    }

    return (
        <RequireAuth>
            <AppShell>
                <div className="min-h-full bg-linear-to-br from-slate-50 to-slate-100" dir="rtl">

                    {/* Header */}
                    <div className="bg-white border-b px-6 py-5 flex items-center gap-4">
                        <div className="w-10 h-10 bg-linear-to-br from-violet-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-500/30 shrink-0">
                            {unlocked ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white">
                                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                                    <path d="M8 11V7a4 4 0 0 1 8 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white">
                                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                                    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    <circle cx="12" cy="16" r="1.5" fill="currentColor" />
                                </svg>
                            )}
                        </div>
                        <div className="flex-1">
                            <h1 className="text-lg font-bold text-slate-900">ניהול עסק</h1>
                            <p className="text-sm text-slate-500">
                                {unlocked ? "גישה מאושרת — הפעלה אחרי 30 דקות של חוסר פעילות" : "אזור מאובטח — נדרש PIN"}
                            </p>
                        </div>
                        {unlocked && (
                            <button
                                onClick={handleLock}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 text-sm font-medium transition-all"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                                    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                                נעל
                            </button>
                        )}
                    </div>

                    {/* Locked state */}
                    {!unlocked && (
                        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
                            <div className="w-20 h-20 bg-linear-to-br from-violet-500 to-indigo-600 rounded-3xl flex items-center justify-center mb-6 shadow-xl shadow-violet-500/30">
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-white">
                                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                                    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    <circle cx="12" cy="16" r="1.5" fill="currentColor" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-2">אזור מאובטח</h2>
                            <p className="text-slate-500 text-base mb-8 max-w-sm">
                                {pinStatus.has_pin
                                    ? "הזן את ה-PIN שלך כדי לגשת לניהול העסק"
                                    : "כדי לגשת לניהול העסק, עליך להגדיר PIN אישי תחילה"}
                            </p>

                            <button
                                onClick={handleUnlockClick}
                                className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold px-8 py-4 rounded-2xl text-base shadow-lg shadow-violet-500/30 active:scale-95 transition-all"
                            >
                                {pinStatus.has_pin ? "🔓 הזן PIN לכניסה" : "🔑 הגדר PIN"}
                            </button>

                            {pinStatus.is_locked && (
                                <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-orange-700 text-sm">
                                    🔒 חשבון נעול זמנית בשל ניסיונות כושלים
                                </div>
                            )}

                            {/* Security badges */}
                            <div className="flex gap-4 mt-12 text-xs text-slate-400">
                                <span className="flex items-center gap-1">🔒 PIN מוצפן</span>
                                <span className="flex items-center gap-1">⏱️ נעילה אוטומטית</span>
                                <span className="flex items-center gap-1">📋 לוג אבטחה</span>
                            </div>
                        </div>
                    )}

                    {/* Unlocked — grouped sections */}
                    {unlocked && (
                        <div className="p-6 space-y-8">
                            {SECTION_GROUPS.map(group => (
                                <div key={group.groupLabel}>
                                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">
                                        {group.groupLabel}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                        {group.items.map(section => (
                                            <button
                                                key={section.href}
                                                onClick={() => router.push(section.href)}
                                                className="bg-white rounded-2xl border border-slate-200 p-4 text-right hover:shadow-lg hover:border-violet-200 hover:-translate-y-0.5 transition-all group"
                                            >
                                                <div className={`w-10 h-10 bg-linear-to-br ${section.color} rounded-xl flex items-center justify-center text-lg mb-3 shadow-sm group-hover:scale-110 transition-transform`}>
                                                    {section.icon}
                                                </div>
                                                <div className="font-bold text-slate-900 text-sm mb-0.5">{section.label}</div>
                                                <div className="text-xs text-slate-500 leading-relaxed">{section.description}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                            {/* Change PIN option */}
                            <div className="mt-6 border-t pt-6">
                                <button
                                    onClick={() => { setPinMode("set"); setShowSetPin(true); }}
                                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-violet-600 transition-colors"
                                >
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

                {/* PIN Modal */}
                {showPinModal && (
                    <PinModal
                        mode={pinMode}
                        onSuccess={handlePinSuccess}
                        onClose={() => setShowPinModal(false)}
                    />
                )}

                {showSetPin && (
                    <PinModal
                        mode="change"
                        onSuccess={() => { setShowSetPin(false); }}
                        onClose={() => setShowSetPin(false)}
                    />
                )}
            </AppShell>
        </RequireAuth>
    );
}
