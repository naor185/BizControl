"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch, clearToken, getToken, setToken } from "@/lib/api";
import ClockWidget from "./ClockWidget";
import BottomNav from "./BottomNav";
import NotificationBell from "./NotificationBell";
import { useLang } from "./LanguageProvider";
import { LOCALES, TranslationKey } from "@/lib/i18n";

type Me = {
    id: string;
    studio_id: string;
    role: string;
    email?: string | null;
    display_name?: string | null;
};

type NavItem = { href: string; labelKey: TranslationKey; icon: string };

const MAIN_NAV: NavItem[] = [
    { href: "/calendar",  labelKey: "nav_calendar",  icon: "📅" },
    { href: "/expenses",  labelKey: "nav_expenses",  icon: "💼" },
    { href: "/products",  labelKey: "nav_products",  icon: "📦" },
    { href: "/dashboard", labelKey: "nav_dashboard", icon: "📊" },
    { href: "/clients",   labelKey: "nav_clients",   icon: "👥" },
];

const SETTINGS_NAV: NavItem[] = [
    { href: "/team",         labelKey: "nav_team",     icon: "🎨" },
    { href: "/team/payroll", labelKey: "nav_payroll",  icon: "💰" },
    { href: "/message-log",  labelKey: "nav_messages", icon: "💬" },
    { href: "/payments",     labelKey: "nav_payments", icon: "💳" },
    { href: "/leads",        labelKey: "nav_leads",    icon: "🎯" },
    { href: "/billing",      labelKey: "nav_billing",  icon: "💎" },
    { href: "/automation",   labelKey: "nav_settings", icon: "⚙️" },
    { href: "/help",         labelKey: "nav_help",     icon: "🆘" },
];

const ALL_NAV = [...MAIN_NAV, ...SETTINGS_NAV];

export default function AppShell({
    title,
    titleAction,
    children,
}: {
    title: string;
    titleAction?: React.ReactNode;
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { t, locale, setLocale, dir } = useLang();
    const [langOpen, setLangOpen] = useState(false);

    const [me, setMe] = useState<Me | null>(null);
    const [isImpersonating, setIsImpersonating] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            setIsImpersonating(!!sessionStorage.getItem("admin_return"));
        }
    }, []);

    const handleReturnToAdmin = () => {
        const adminToken = sessionStorage.getItem("admin_token");
        if (adminToken) setToken(adminToken);
        sessionStorage.removeItem("admin_token");
        sessionStorage.removeItem("admin_return");
        router.replace("/admin");
    };

    const [settingsOpen, setSettingsOpen] = useState(() =>
        SETTINGS_NAV.some(n => pathname === n.href || pathname?.startsWith(n.href + "/"))
    );

    const activeHref = useMemo(() => {
        const found = ALL_NAV.find(n => pathname === n.href);
        if (found) return found.href;
        const prefix = ALL_NAV.find(n => pathname?.startsWith(n.href + "/"));
        return prefix?.href || "";
    }, [pathname]);

    useEffect(() => {
        (async () => {
            try {
                const token = getToken();
                if (!token) return;
                const data = await apiFetch<Me>("/api/auth/me");
                setMe(data);
            } catch { /* silent */ }
        })();
    }, []);

    function logout() {
        clearToken();
        router.replace("/login");
    }

    const isInSettings = SETTINGS_NAV.some(n => n.href === activeHref);

    const avatarLetter = (me?.display_name || me?.email || "?")[0].toUpperCase();

    return (
        <div className="min-h-screen bg-slate-50" dir={dir}>
            {/* Impersonation banner */}
            {isImpersonating && (
                <div className="bg-amber-400 text-amber-950 text-sm font-bold px-4 py-2.5 flex items-center justify-between z-50 relative">
                    <span className="flex items-center gap-2">
                        <span>👁️</span>
                        <span>מצב צפייה — אתה רואה את המערכת כבעל הסטודיו</span>
                    </span>
                    <button
                        onClick={handleReturnToAdmin}
                        className="bg-amber-950 text-amber-100 px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-900 transition-colors"
                    >
                        חזור לאדמין ←
                    </button>
                </div>
            )}

            <div className="flex">
                {/* Sidebar */}
                <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-white border-l border-slate-100 shadow-sm">
                    {/* Logo */}
                    <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100">
                        <div className="font-black text-slate-900 tracking-tight text-lg" dir="ltr">BizControl</div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-semibold" dir="ltr">v1</span>
                    </div>

                    {/* Nav */}
                    <nav className="flex-1 p-2.5 space-y-0.5 overflow-y-auto">
                        {MAIN_NAV.map(item => {
                            const active = item.href === activeHref;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={[
                                        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                                        active
                                            ? "bg-sky-600 text-white shadow-sm shadow-sky-200"
                                            : "text-slate-600 hover:bg-sky-50 hover:text-sky-700",
                                    ].join(" ")}
                                >
                                    <span className="text-base leading-none">{item.icon}</span>
                                    <span>{t(item.labelKey)}</span>
                                </Link>
                            );
                        })}

                        {/* Settings group */}
                        <div className="pt-3">
                            <div className="px-3 mb-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">הגדרות</span>
                            </div>
                            <button
                                onClick={() => setSettingsOpen(o => !o)}
                                className={[
                                    "w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                                    isInSettings ? "bg-sky-50 text-sky-800" : "text-slate-500 hover:bg-sky-50 hover:text-sky-700",
                                ].join(" ")}
                            >
                                <div className="flex items-center gap-2.5">
                                    <span className="text-base leading-none">⚙️</span>
                                    <span>{t("nav_settings")}</span>
                                </div>
                                <span className={`text-[10px] transition-transform duration-200 ${settingsOpen ? "rotate-180" : ""}`}>▼</span>
                            </button>

                            {settingsOpen && (
                                <div className="mt-0.5 pr-2 space-y-0.5 border-r-2 border-slate-100 mr-3">
                                    {SETTINGS_NAV.map(item => {
                                        const active = item.href === activeHref;
                                        return (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                className={[
                                                    "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all",
                                                    active
                                                        ? "bg-sky-600 text-white font-medium shadow-sm shadow-sky-200"
                                                        : "text-slate-500 hover:bg-sky-50 hover:text-sky-700",
                                                ].join(" ")}
                                            >
                                                <span className="text-base leading-none">{item.icon}</span>
                                                <span>{t(item.labelKey)}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </nav>

                    {/* Bottom: user + lang + logout */}
                    <div className="p-3 border-t border-slate-100 space-y-2">
                        {/* Language */}
                        <div className="relative">
                            <button
                                onClick={() => setLangOpen(o => !o)}
                                className="w-full flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 transition"
                            >
                                <span className="flex items-center gap-2">
                                    <span>{LOCALES.find(l => l.code === locale)?.flag}</span>
                                    <span className="text-slate-700">{LOCALES.find(l => l.code === locale)?.label}</span>
                                </span>
                                <span className="text-slate-400 text-[10px]">▼</span>
                            </button>
                            {langOpen && (
                                <div className="absolute bottom-full mb-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
                                    {LOCALES.map(l => (
                                        <button
                                            key={l.code}
                                            onClick={() => { setLocale(l.code); setLangOpen(false); }}
                                            className={`w-full text-right px-4 py-2.5 text-sm hover:bg-slate-50 transition flex items-center gap-2 ${locale === l.code ? "font-bold bg-slate-50" : ""}`}
                                        >
                                            <span>{l.flag}</span><span>{l.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* User row */}
                        <div className="flex items-center gap-2.5 px-1">
                            <div className="w-8 h-8 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {avatarLetter}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-slate-800 truncate" dir="ltr">
                                    {me?.display_name || me?.email || "—"}
                                </div>
                                <div className="text-[10px] text-slate-400">{me?.role || "owner"}</div>
                            </div>
                        </div>

                        {me?.role === "superadmin" && (
                            <Link
                                href="/admin"
                                className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm py-2 font-semibold transition-colors"
                            >
                                <span>🛡️</span>
                                <span>פאנל ניהול</span>
                            </Link>
                        )}
                        <button
                            onClick={logout}
                            className="w-full rounded-xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-sm py-2 font-medium text-slate-600 transition-colors"
                        >
                            {t("logout")}
                        </button>
                    </div>
                </aside>

                {/* Main content */}
                <div className="flex-1 md:pr-60">
                    {/* Topbar */}
                    <header className="sticky top-0 z-10 h-14 bg-white/95 backdrop-blur-sm border-b border-slate-100">
                        <div className="h-full px-5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <h1 className="text-lg font-bold text-slate-900">{title}</h1>
                                {titleAction}
                            </div>

                            <div className="flex items-center gap-3">
                                <NotificationBell />
                                {/* User greeting — desktop */}
                                <div className="hidden sm:flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs font-bold">
                                        {avatarLetter}
                                    </div>
                                    <div className="text-sm text-slate-600">
                                        <span className="text-slate-400">שלום, </span>
                                        <span className="font-semibold text-slate-800" dir="ltr">
                                            {me?.display_name || me?.email || "מנהל"}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={logout}
                                    className="hidden md:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 text-slate-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 text-sm px-3 py-1.5 transition-colors font-medium"
                                >
                                    {t("logout")}
                                </button>
                            </div>
                        </div>
                    </header>

                    <main className="p-5 pb-28 md:pb-6">{children}</main>
                </div>
            </div>

            <ClockWidget />
            <BottomNav />
        </div>
    );
}
