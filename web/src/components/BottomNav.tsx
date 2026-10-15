"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Building2, CalendarDays, LayoutDashboard, ShoppingCart, Users, X, type LucideIcon } from "lucide-react";
import { getCurrentUserRole } from "@/lib/api";
import { useLang } from "./LanguageProvider";
import { TranslationKey } from "@/lib/i18n";
import { useBackButtonClose } from "@/lib/backButtonStack";
import { useNewLeadsCount } from "@/lib/useNewLeadsCount";
import BusinessTiles from "./BusinessTiles";

// לוח בקרה took the "+" 's place (the owner, 2026-10-15) — a new appointment is the calendar's own +
const PRIMARY_NAV: { href: string; labelKey: TranslationKey; icon: LucideIcon }[] = [
    { href: "/calendar",  labelKey: "nav_calendar",  icon: CalendarDays },
    { href: "/pos",       labelKey: "nav_pos",       icon: ShoppingCart },
    { href: "/clients",   labelKey: "nav_clients",   icon: Users },
    { href: "/dashboard", labelKey: "nav_dashboard", icon: LayoutDashboard },
];

/** pendingDeposits: deposits waiting to be approved — לוח בקרה's number, as on the computer's side menu */
export default function BottomNav({ pendingDeposits = 0 }: { pendingDeposits?: number }) {
    const pathname = usePathname();
    const [userRole] = useState(() => getCurrentUserRole());
    const isArtist = userRole === "artist" || userRole === "staff";
    const { t } = useLang();
    const newLeadsCount = useNewLeadsCount();
    // "ניהול עסק" — the owner's and the managers' (a worker's bar is the calendar only). It opens the categories, a
    // search and each category's screens (components/BusinessTiles) — not a long page (the owner, 2026-10-15).
    // the page the sheet was opened on — moving to another page closes it
    const [openOn, setOpenOn] = useState<string | null>(null);
    const sheetOpen = openOn !== null && openOn === pathname;
    const close = () => setOpenOn(null);
    const [asked, setAsked] = useState(false);          // load the tools the first time the sheet opens

    const isActive = (href: string) =>
        pathname === href || pathname?.startsWith(href + "/");

    // every page that isn't on the bar is reached through "ניהול עסק", so it lights up there
    const businessActive = !PRIMARY_NAV.some(n => isActive(n.href));

    useBackButtonClose(sheetOpen, close);

    const navItems = isArtist
        ? PRIMARY_NAV.filter(i => i.href === "/calendar")
        : PRIMARY_NAV;

    return (
        <>
            {sheetOpen && (
                <div className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm" onClick={close} />
            )}

            {/* ניהול עסק — slides up */}
            {!isArtist && (
                <div
                    id="mobile-business-sheet"
                    dir="rtl"
                    className={[
                        "fixed right-0 left-0 z-50 md:hidden max-h-[calc(100dvh-4rem-env(safe-area-inset-bottom,0px)-env(safe-area-inset-top,0px))] overflow-y-auto bg-white rounded-t-3xl shadow-2xl transition-all duration-300 ease-out",
                        sheetOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none",
                    ].join(" ")}
                    style={{ bottom: "calc(64px + env(safe-area-inset-bottom, 0px))" }}
                >
                    <div className="flex justify-center pt-3 pb-1">
                        <div className="w-10 h-1 bg-gray-200 rounded-full" />
                    </div>
                    <div className="px-4 pt-2 pb-5">
                        <BusinessTiles key={openOn ?? "closed"} active={asked} onNavigate={close} />
                    </div>
                </div>
            )}

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
                                    {item.href === "/dashboard" && pendingDeposits > 0 && (
                                        <span className="absolute -top-1.5 -left-2.5 bg-amber-500 text-white text-[9px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1 ring-2 ring-white"
                                            aria-label={`${pendingDeposits} מקדמות ממתינות לאישור`}>
                                            {pendingDeposits > 99 ? "99+" : pendingDeposits}
                                        </span>
                                    )}
                                    {item.href === "/dashboard" && newLeadsCount > 0 && (
                                        <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white" aria-label="לידים חדשים" />
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

                    {/* ניהול עסק — the owner's and the managers' */}
                    {!isArtist && (
                        <button
                            type="button"
                            onClick={() => { setAsked(true); setOpenOn(sheetOpen ? null : pathname); }}
                            aria-expanded={sheetOpen}
                            aria-controls="mobile-business-sheet"
                            className="flex-1 relative flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90"
                        >
                            {(businessActive || sheetOpen) && (
                                <span className="absolute top-1.5 inset-x-1.5 h-9 bg-sky-500/10 rounded-2xl" />
                            )}

                            {sheetOpen
                                ? <X aria-hidden className="w-[22px] h-[22px] z-10 text-sky-600" />
                                : <Building2 aria-hidden className={`w-[22px] h-[22px] z-10 ${businessActive ? "scale-110 text-sky-600" : "text-gray-500"}`} />}

                            <span className={[
                                "text-[10px] font-semibold z-10",
                                businessActive || sheetOpen ? "text-sky-600" : "text-gray-400",
                            ].join(" ")}>
                                {t("nav_business")}
                            </span>

                            {businessActive && !sheetOpen && (
                                <span className="absolute bottom-0 inset-x-4 h-[3px] bg-sky-500 rounded-t-full" />
                            )}
                        </button>
                    )}
                </div>
            </nav>
        </>
    );
}
