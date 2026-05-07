"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch, clearToken, getToken, setToken } from "@/lib/api";
import ClockWidget from "./ClockWidget";
import BottomNav from "./BottomNav";

type Me = {
    id: string;
    studio_id: string;
    role: string;
    email?: string | null;
    display_name?: string | null;
};

type NavItem = { href: string; label: string; icon: string };

const MAIN_NAV: NavItem[] = [
    { href: "/calendar", label: "יומן תורים", icon: "📅" },
    { href: "/expenses", label: "ניהול עסק", icon: "💼" },
    { href: "/products", label: "מוצרים ומלאי", icon: "📦" },
    { href: "/dashboard", label: "לוח בקרה", icon: "📊" },
    { href: "/clients", label: "לקוחות", icon: "👥" },
];

const SETTINGS_NAV: NavItem[] = [
    { href: "/team", label: "צוות ומקעקעים", icon: "🎨" },
    { href: "/team/payroll", label: "דוחות שכר", icon: "💰" },
    { href: "/message-log", label: "יומן הודעות", icon: "💬" },
    { href: "/payments", label: "תשלומים", icon: "💳" },
    { href: "/billing", label: "מנוי ותשלום", icon: "💎" },
    { href: "/automation", label: "הגדרות", icon: "⚙️" },
    { href: "/help", label: "מרכז עזרה", icon: "🆘" },
];

const ALL_NAV = [...MAIN_NAV, ...SETTINGS_NAV];

export default function AppShell({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();

    const [me, setMe] = useState<Me | null>(null);
    const [meErr, setMeErr] = useState<string | null>(null);
    const [isImpersonating, setIsImpersonating] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            setIsImpersonating(!!sessionStorage.getItem("admin_return"));
        }
    }, []);

    const handleReturnToAdmin = () => {
        const adminToken = sessionStorage.getItem("admin_token");
        if (adminToken) {
            setToken(adminToken);
        }
        sessionStorage.removeItem("admin_token");
        sessionStorage.removeItem("admin_return");
        router.replace("/admin");
    };
    const [settingsOpen, setSettingsOpen] = useState(() =>
        SETTINGS_NAV.some(n => pathname === n.href || pathname?.startsWith(n.href + "/"))
    );

    const activeHref = useMemo(() => {
        const found = ALL_NAV.find((n) => pathname === n.href);
        if (found) return found.href;
        const prefix = ALL_NAV.find((n) => pathname?.startsWith(n.href + "/"));
        return prefix?.href || "";
    }, [pathname]);

    useEffect(() => {
        (async () => {
            try {
                setMeErr(null);
                const token = getToken();
                if (!token) return;
                const data = await apiFetch<Me>("/api/auth/me", { method: "GET" });
                setMe(data);
            } catch (e: any) {
                setMeErr(e?.message || "שגיאה בטעינת משתמש");
            }
        })();
    }, []);

    function logout() {
        clearToken();
        router.replace("/login");
    }

    const isInSettings = SETTINGS_NAV.some(n => n.href === activeHref);

    return (
        <div className="min-h-screen bg-gray-50" dir="rtl">
            {/* Impersonation banner */}
            {isImpersonating && (
                <div className="bg-amber-500 text-amber-950 text-sm font-bold px-4 py-2 flex items-center justify-between z-50 relative">
                    <span>👁️ מצב צפייה — אתה רואה את המערכת כבעל הסטודיו</span>
                    <button
                        onClick={handleReturnToAdmin}
                        className="bg-amber-950 text-amber-100 px-4 py-1 rounded-lg text-xs hover:bg-amber-900 transition-colors"
                    >
                        חזור לפאנל אדמין ←
                    </button>
                </div>
            )}
            <div className="flex">
                {/* Sidebar */}
                <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-l">
                    <div className="h-16 px-5 flex items-center justify-between border-b">
                        <div className="font-semibold tracking-tight" dir="ltr">BizControl</div>
                        <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-600" dir="ltr">
                            V1
                        </span>
                    </div>

                    <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
                        {MAIN_NAV.map((item) => {
                            const active = item.href === activeHref;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={[
                                        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition font-medium",
                                        active
                                            ? "bg-black text-white"
                                            : "text-gray-700 hover:bg-gray-100",
                                    ].join(" ")}
                                >
                                    <span>{item.icon}</span>
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}

                        {/* Settings group */}
                        <div className="pt-2">
                            <button
                                onClick={() => setSettingsOpen(o => !o)}
                                className={[
                                    "w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition",
                                    isInSettings ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-50",
                                ].join(" ")}
                            >
                                <div className="flex items-center gap-2">
                                    <span>⚙️</span>
                                    <span>הגדרות</span>
                                </div>
                                <span className="text-xs text-gray-400">{settingsOpen ? "▲" : "▼"}</span>
                            </button>

                            {settingsOpen && (
                                <div className="mr-3 mt-1 border-r-2 border-gray-100 pr-2 space-y-0.5">
                                    {SETTINGS_NAV.map((item) => {
                                        const active = item.href === activeHref;
                                        return (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                className={[
                                                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                                                    active
                                                        ? "bg-black text-white font-semibold"
                                                        : "text-gray-600 hover:bg-gray-100",
                                                ].join(" ")}
                                            >
                                                <span>{item.icon}</span>
                                                <span>{item.label}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </nav>

                    <div className="mt-auto p-4 border-t">
                        <div className="text-xs text-gray-500">מחובר בתור</div>
                        <div className="text-sm font-medium text-gray-800 truncate" dir="ltr">
                            {me?.display_name || me?.email || "מנהל מערכת"}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                            הרשאה: {me?.role || "owner"}
                        </div>

                        {meErr && (
                            <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                                {meErr}
                            </div>
                        )}

                        <button
                            onClick={logout}
                            className="mt-3 w-full rounded-lg border bg-white hover:bg-gray-50 text-sm py-2 font-medium text-red-600"
                        >
                            התנתקות
                        </button>
                    </div>
                </aside>

                {/* Main */}
                <div className="flex-1 md:pr-64">
                    {/* Topbar */}
                    <header className="sticky top-0 z-10 h-16 bg-white border-b">
                        <div className="h-full px-5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="text-2xl font-bold">{title}</div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="hidden sm:flex items-center gap-2">
                                    <div className="text-xs text-gray-500">שלום,</div>
                                    <div className="text-sm font-medium" dir="ltr">
                                        {me?.display_name || me?.email || "מנהל מערכת"}
                                    </div>
                                </div>
                                <button
                                    onClick={logout}
                                    className="hidden md:inline-flex rounded-lg bg-black text-white text-sm px-3 py-2"
                                >
                                    התנתקות
                                </button>
                            </div>
                        </div>
                    </header>

                    <main className="p-5 pb-24 md:pb-5">{children}</main>
                </div>
            </div>
            <ClockWidget />
            <BottomNav />
        </div>
    );
}
