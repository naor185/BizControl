"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
    BarChart3, Building2, CalendarDays, ChevronLeft, Compass, LogOut, Menu, ShoppingCart, Users, X, type LucideIcon,
} from "lucide-react";
import { clearToken, getCurrentUserRole } from "@/lib/api";
import { useLang } from "./LanguageProvider";
import { TranslationKey } from "@/lib/i18n";
import { useBackButtonClose } from "@/lib/backButtonStack";
import { useNewLeadsCount } from "@/lib/useNewLeadsCount";

const PRIMARY_NAV: { href: string; labelKey: TranslationKey; icon: LucideIcon }[] = [
    { href: "/calendar",  labelKey: "nav_calendar",  icon: CalendarDays },
    { href: "/pos",       labelKey: "nav_pos",       icon: ShoppingCart },
    { href: "/clients",   labelKey: "nav_clients",   icon: Users },
];

// "עוד" — like the computer's side menu: the two overview pages and "ניהול עסק", where everything else lives once
// (payments, expenses, team, settings… — each with its plan and a manager's permissions). Until 2026-10-15 the sheet
// repeated eight of the hub's pages beside the hub itself (the owner: "why are there two ניהול עסק?").
const MORE_NAV: { href: string; labelKey: TranslationKey; icon: LucideIcon }[] = [
    { href: "/overview",     labelKey: "nav_overview",  icon: Compass },
    { href: "/dashboard",    labelKey: "nav_dashboard", icon: BarChart3 },
];

export default function BottomNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [userRole] = useState(() => getCurrentUserRole());
    const isArtist = userRole === "artist" || userRole === "staff";
    const { t } = useLang();
    const newLeadsCount = useNewLeadsCount();

    const isActive = (href: string) =>
        pathname === href || pathname?.startsWith(href + "/");

    // every page that isn't on the bar itself is reached through "עוד"
    const moreActive = !PRIMARY_NAV.some(n => isActive(n.href));

    // Close sheet on navigation
    useEffect(() => { setSheetOpen(false); }, [pathname]);

    useBackButtonClose(sheetOpen, () => setSheetOpen(false));

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
                id="mobile-more-navigation"
                dir="rtl"
                className={[
                    "fixed right-0 left-0 z-50 md:hidden max-h-[calc(100dvh-4rem-env(safe-area-inset-bottom,0px)-env(safe-area-inset-top,0px))] overflow-y-auto bg-white rounded-t-3xl shadow-2xl transition-all duration-300 ease-out",
                    sheetOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none",
                ].join(" ")}
                style={{ bottom: "calc(64px + env(safe-area-inset-bottom, 0px))" }}
            >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 bg-gray-200 rounded-full" />
                </div>

                <div className="px-4 pt-2 pb-5 grid grid-cols-3 gap-2.5">
                    {/* the business's tools — all of them, in one place */}
                    <Link
                        href="/business"
                        className={[
                            "col-span-3 flex items-center gap-3 px-4 py-3.5 rounded-2xl text-right transition-all active:scale-[0.98]",
                            isActive("/business") ? "bg-sky-600 text-white shadow-md" : "bg-sky-50 text-gray-800 hover:bg-sky-100",
                        ].join(" ")}
                    >
                        <Building2 className="w-7 h-7 shrink-0" aria-hidden />
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm font-bold leading-tight">{t("nav_business")}</span>
                            <span className={`block text-[11px] mt-0.5 ${isActive("/business") ? "text-white/80" : "text-gray-500"}`}>{t("nav_business_hint")}</span>
                        </span>
                        <ChevronLeft className="w-5 h-5 shrink-0 opacity-60" aria-hidden />
                    </Link>

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
                                <span className="relative leading-none">
                                    <item.icon className="w-6 h-6" aria-hidden />
                                    {item.href === "/overview" && newLeadsCount > 0 && (
                                        <span className="absolute -top-1.5 -left-2.5 bg-rose-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 shadow-sm">
                                            {newLeadsCount > 99 ? "99+" : newLeadsCount}
                                        </span>
                                    )}
                                </span>
                                <span className="text-[11px] font-semibold leading-tight">{t(item.labelKey)}</span>
                            </Link>
                        );
                    })}

                    {/* Logout */}
                    <button
                        onClick={logout}
                        className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-red-50 text-red-600 active:scale-95 transition-all"
                    >
                        <LogOut className="w-6 h-6" aria-hidden />
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
                                    <item.icon aria-hidden className={[
                                        "w-[22px] h-[22px] transition-transform duration-200",
                                        active ? "scale-110 text-sky-600" : "text-gray-500",
                                    ].join(" ")} />
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
                            aria-expanded={sheetOpen}
                            aria-controls="mobile-more-navigation"
                            className="flex-1 relative flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90"
                        >
                            {(moreActive || sheetOpen) && (
                                <span className="absolute top-1.5 inset-x-1.5 h-9 bg-sky-500/10 rounded-2xl" />
                            )}

                            {sheetOpen
                                ? <X aria-hidden className="w-[22px] h-[22px] z-10 text-sky-600" />
                                : <Menu aria-hidden className={`w-[22px] h-[22px] z-10 ${moreActive ? "text-sky-600" : "text-gray-500"}`} />}
                            {!sheetOpen && newLeadsCount > 0 && (
                                <span className="absolute top-2.5 right-[calc(50%-18px)] w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white z-10" />
                            )}

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
