"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, apiFetch, getCurrentUserRole } from "@/lib/api";
import { useLang } from "./LanguageProvider";
import { TranslationKey } from "@/lib/i18n";

const PRIMARY_NAV: { href: string; labelKey: TranslationKey; icon: string; badge?: boolean }[] = [
    { href: "/calendar",  labelKey: "nav_calendar",  icon: "📅" },
    { href: "/clients",   labelKey: "nav_clients",   icon: "👥" },
    { href: "/inbox",     labelKey: "nav_inbox",     icon: "💬", badge: true },
    { href: "/payments",  labelKey: "nav_payments",  icon: "💳" },
];

const MORE_NAV: { href: string; labelKey: TranslationKey; icon: string }[] = [
    { href: "/dashboard",    labelKey: "nav_dashboard", icon: "📊" },
    { href: "/leads",        labelKey: "nav_leads",     icon: "🎯" },
    { href: "/expenses",     labelKey: "nav_expenses",  icon: "💼" },
    { href: "/products",     labelKey: "nav_products",  icon: "📦" },
    { href: "/team",         labelKey: "nav_team",      icon: "🎨" },
    { href: "/team/payroll", labelKey: "nav_payroll",   icon: "💰" },
    { href: "/message-log",  labelKey: "nav_messages",  icon: "📋" },
    { href: "/billing",      labelKey: "nav_billing",   icon: "💎" },
    { href: "/automation",   labelKey: "nav_settings",  icon: "⚙️" },
    { href: "/help",         labelKey: "nav_help",      icon: "🆘" },
];

export default function BottomNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [userRole] = useState(() => getCurrentUserRole());
    const isArtist = userRole === "artist" || userRole === "staff";
    const { t } = useLang();

    const isActive = (href: string) =>
        pathname === href || pathname?.startsWith(href + "/");

    const moreActive = MORE_NAV.some(n => isActive(n.href));

    useEffect(() => {
        const load = async () => {
            try {
                const data = await apiFetch<{ unread: number }>("/api/inbox/unread-count");
                setUnreadCount(data.unread);
            } catch { /* not logged in yet */ }
        };
        load();
        const tid = setInterval(load, 30_000);
        return () => clearInterval(tid);
    }, []);

    // Close sheet on navigation
    useEffect(() => { setSheetOpen(false); }, [pathname]);

    function logout() {
        clearToken();
        router.replace("/login");
    }

    const navItems = isArtist
        ? PRIMARY_NAV.filter(i => i.href === "/calendar")
        : PRIMARY_NAV;

    return (
        <>
            {/* Backdrop */}
            {sheetOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
                    onClick={() => setSheetOpen(false)}
                />
            )}

            {/* More sheet — slides up */}
            <div
                dir="rtl"
                className={[
                    "fixed right-0 left-0 z-50 md:hidden bg-white rounded-t-3xl shadow-2xl transition-all duration-300 ease-out",
                    sheetOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none",
                ].join(" ")}
                style={{ bottom: "64px" }}
            >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 bg-gray-200 rounded-full" />
                </div>

                <div className="px-4 pt-2 pb-5 grid grid-cols-3 gap-2.5">
                    {MORE_NAV.map(item => {
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={[
                                    "flex flex-col items-center gap-1.5 py-3 rounded-2xl text-center transition-all active:scale-95",
                                    active
                                        ? "bg-sky-600 text-white shadow-md"
                                        : "bg-gray-50 text-gray-700 hover:bg-sky-50",
                                ].join(" ")}
                            >
                                <span className="text-2xl leading-none">{item.icon}</span>
                                <span className="text-[11px] font-semibold leading-tight">{t(item.labelKey)}</span>
                            </Link>
                        );
                    })}

                    {/* Logout */}
                    <button
                        onClick={logout}
                        className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-red-50 text-red-600 active:scale-95 transition-all"
                    >
                        <span className="text-2xl leading-none">🚪</span>
                        <span className="text-[11px] font-semibold">{t("logout")}</span>
                    </button>
                </div>
            </div>

            {/* Bottom bar */}
            <nav
                dir="rtl"
                className="fixed bottom-0 right-0 left-0 z-50 md:hidden bg-white/95 backdrop-blur-md border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
                <div className="flex items-stretch h-16">
                    {navItems.map(item => {
                        const active = isActive(item.href);
                        const showBadge = item.badge && unreadCount > 0;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="flex-1 relative flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90"
                            >
                                {active && (
                                    <span className="absolute top-1.5 inset-x-1.5 h-9 bg-sky-500/10 rounded-2xl" />
                                )}

                                <div className="relative z-10">
                                    <span className={[
                                        "text-[22px] leading-none transition-transform duration-200",
                                        active ? "scale-110 block" : "block",
                                    ].join(" ")}>
                                        {item.icon}
                                    </span>
                                    {showBadge && (
                                        <span className="absolute -top-1.5 -left-1.5 bg-green-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 shadow-sm">
                                            {unreadCount > 99 ? "99+" : unreadCount}
                                        </span>
                                    )}
                                </div>

                                <span className={[
                                    "text-[10px] font-semibold z-10 transition-colors",
                                    active ? "text-sky-600" : "text-gray-400",
                                ].join(" ")}>
                                    {t(item.labelKey)}
                                </span>

                                {active && (
                                    <span className="absolute bottom-0 inset-x-4 h-[3px] bg-sky-500 rounded-t-full" />
                                )}
                            </Link>
                        );
                    })}

                    {/* Center "+" quick-create — calendar only, hidden for artists */}
                    {!isArtist && (
                        <Link
                            href="/calendar"
                            className="flex-none w-14 flex items-center justify-center self-center mx-1"
                            aria-label="קבע תור חדש"
                        >
                            <span className="w-11 h-11 bg-sky-600 rounded-full flex items-center justify-center shadow-lg shadow-sky-500/30 active:scale-90 transition-transform">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                            </span>
                        </Link>
                    )}

                    {/* More button */}
                    {!isArtist && (
                        <button
                            onClick={() => setSheetOpen(o => !o)}
                            className="flex-1 relative flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90"
                        >
                            {(moreActive || sheetOpen) && (
                                <span className="absolute top-1.5 inset-x-1.5 h-9 bg-sky-500/10 rounded-2xl" />
                            )}

                            <span className={[
                                "text-[22px] leading-none z-10 transition-all duration-200",
                                sheetOpen ? "rotate-45 scale-110" : "",
                            ].join(" ")}>
                                {sheetOpen ? "✕" : "☰"}
                            </span>

                            <span className={[
                                "text-[10px] font-semibold z-10",
                                moreActive || sheetOpen ? "text-sky-600" : "text-gray-400",
                            ].join(" ")}>
                                עוד
                            </span>

                            {moreActive && !sheetOpen && (
                                <span className="absolute bottom-0 inset-x-4 h-[3px] bg-sky-500 rounded-t-full" />
                            )}
                        </button>
                    )}
                </div>
            </nav>
        </>
    );
}
