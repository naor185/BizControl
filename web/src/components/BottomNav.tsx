"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Building2, CalendarDays, ShoppingCart, Users, type LucideIcon } from "lucide-react";
import { getCurrentUserRole } from "@/lib/api";
import { useLang } from "./LanguageProvider";
import { TranslationKey } from "@/lib/i18n";
import { useNewLeadsCount } from "@/lib/useNewLeadsCount";

const PRIMARY_NAV: { href: string; labelKey: TranslationKey; icon: LucideIcon }[] = [
    { href: "/calendar",  labelKey: "nav_calendar",  icon: CalendarDays },
    { href: "/pos",       labelKey: "nav_pos",       icon: ShoppingCart },
    { href: "/clients",   labelKey: "nav_clients",   icon: Users },
];

export default function BottomNav() {
    const pathname = usePathname();
    const [userRole] = useState(() => getCurrentUserRole());
    const isArtist = userRole === "artist" || userRole === "staff";
    const { t } = useLang();
    const newLeadsCount = useNewLeadsCount();

    const isActive = (href: string) =>
        pathname === href || pathname?.startsWith(href + "/");

    // "ניהול עסק" — the business page itself, the owner's and the managers' (a worker's bar is the calendar only).
    // It was "עוד", a sheet that repeated the hub's pages beside a "ניהול עסק" button (the owner, 2026-10-15: "they're
    // the same thing"). Every page that isn't on the bar is reached through it, so it lights up there.
    const businessActive = !PRIMARY_NAV.some(n => isActive(n.href));

    const navItems = isArtist
        ? PRIMARY_NAV.filter(i => i.href === "/calendar")
        : PRIMARY_NAV;

    return (
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

                {/* ניהול עסק — the owner's and the managers' */}
                {!isArtist && (
                    <Link
                        href="/business"
                        className="flex-1 relative flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90"
                    >
                        {businessActive && (
                            <span className="absolute top-1.5 inset-x-1.5 h-9 bg-sky-500/10 rounded-2xl" />
                        )}

                        <Building2 aria-hidden className={`w-[22px] h-[22px] z-10 ${businessActive ? "scale-110 text-sky-600" : "text-gray-500"}`} />
                        {newLeadsCount > 0 && (
                            <span className="absolute top-2.5 right-[calc(50%-18px)] w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white z-10" />
                        )}

                        <span className={[
                            "text-[10px] font-semibold z-10",
                            businessActive ? "text-sky-600" : "text-gray-400",
                        ].join(" ")}>
                            {t("nav_business")}
                        </span>

                        {businessActive && (
                            <span className="absolute bottom-0 inset-x-4 h-[3px] bg-sky-500 rounded-t-full" />
                        )}
                    </Link>
                )}
            </div>
        </nav>
    );
}
