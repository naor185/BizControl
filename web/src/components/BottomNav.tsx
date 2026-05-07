"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, apiFetch, getCurrentUserRole } from "@/lib/api";

const PRIMARY_NAV = [
    { href: "/calendar",  label: "יומן",    icon: "📅" },
    { href: "/clients",   label: "לקוחות",  icon: "👥" },
    { href: "/inbox",     label: "הודעות",  icon: "💬", badge: true },
    { href: "/payments",  label: "תשלומים", icon: "💳" },
];

const MORE_NAV = [
    { href: "/dashboard",    label: "לוח בקרה",    icon: "📊" },
    { href: "/leads",        label: "לידים",        icon: "🎯" },
    { href: "/expenses",     label: "ניהול עסק",    icon: "💼" },
    { href: "/products",     label: "מוצרים",       icon: "📦" },
    { href: "/team",         label: "צוות",         icon: "🎨" },
    { href: "/team/payroll", label: "דוחות שכר",   icon: "💰" },
    { href: "/message-log",  label: "יומן הודעות", icon: "📋" },
    { href: "/automation",   label: "הגדרות",      icon: "⚙️" },
    { href: "/help",         label: "עזרה",        icon: "🆘" },
];

export default function BottomNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [userRole] = useState(() => getCurrentUserRole());
    const isArtist = userRole === "artist" || userRole === "staff";

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
        const t = setInterval(load, 30_000);
        return () => clearInterval(t);
    }, []);

    function logout() {
        clearToken();
        router.replace("/login");
    }

    return (
        <>
            {/* Backdrop */}
            {sheetOpen && (
                <div
                    className="fixed inset-0 bg-black/40 z-40 md:hidden"
                    onClick={() => setSheetOpen(false)}
                />
            )}

            {/* More sheet — slides up from bottom */}
            <div
                dir="rtl"
                className={[
                    "fixed right-0 left-0 z-50 md:hidden bg-white rounded-t-3xl shadow-2xl transition-transform duration-300 ease-out",
                    sheetOpen ? "translate-y-0" : "translate-y-full",
                ].join(" ")}
                style={{ bottom: "64px" }}
            >
                {/* Drag handle */}
                <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mt-3 mb-4" />

                <div className="px-4 pb-6 grid grid-cols-4 gap-3">
                    {MORE_NAV.map(item => {
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setSheetOpen(false)}
                                className={[
                                    "flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl text-center transition-all",
                                    active
                                        ? "bg-black text-white shadow-lg"
                                        : "bg-gray-50 text-gray-700 hover:bg-gray-100 active:scale-95",
                                ].join(" ")}
                            >
                                <span className="text-2xl leading-none">{item.icon}</span>
                                <span className="text-[11px] font-semibold leading-tight">{item.label}</span>
                            </Link>
                        );
                    })}

                    {/* Logout tile */}
                    <button
                        onClick={logout}
                        className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl bg-red-50 text-red-600 hover:bg-red-100 active:scale-95 transition-all"
                    >
                        <span className="text-2xl leading-none">🚪</span>
                        <span className="text-[11px] font-semibold">יציאה</span>
                    </button>
                </div>
            </div>

            {/* Bottom bar */}
            <nav
                dir="rtl"
                className="fixed bottom-0 right-0 left-0 z-50 md:hidden bg-white border-t border-gray-100 shadow-[0_-2px_16px_rgba(0,0,0,0.07)]"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
                <div className="flex items-stretch h-16">
                    {(isArtist ? PRIMARY_NAV.filter(i => i.href === "/calendar") : PRIMARY_NAV).map(item => {
                        const active = isActive(item.href);
                        const showBadge = item.badge && unreadCount > 0;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="flex-1 relative flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95"
                            >
                                {/* Active pill background */}
                                {active && (
                                    <span className="absolute top-2 inset-x-2 h-9 bg-black/5 rounded-2xl" />
                                )}

                                {/* Icon with optional badge */}
                                <div className="relative z-10">
                                    <span className={[
                                        "text-xl transition-all",
                                        active ? "scale-110 inline-block" : "",
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
                                    "text-[10px] font-semibold z-10",
                                    active ? "text-black" : "text-gray-400",
                                ].join(" ")}>
                                    {item.label}
                                </span>

                                {/* Active indicator line */}
                                {active && (
                                    <span className="absolute bottom-0 inset-x-3 h-0.5 bg-black rounded-full" />
                                )}
                            </Link>
                        );
                    })}

                    {/* More button — hidden for artists */}
                    {!isArtist && <button
                        onClick={() => setSheetOpen(o => !o)}
                        className="flex-1 relative flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95"
                    >
                        {(moreActive || sheetOpen) && (
                            <span className="absolute top-2 inset-x-2 h-9 bg-black/5 rounded-2xl" />
                        )}

                        <span className={[
                            "text-xl transition-all z-10",
                            sheetOpen ? "rotate-90 scale-110 inline-block" : "",
                        ].join(" ")}>
                            {sheetOpen ? "✕" : "☰"}
                        </span>

                        <span className={[
                            "text-[10px] font-semibold z-10",
                            moreActive || sheetOpen ? "text-black" : "text-gray-400",
                        ].join(" ")}>
                            עוד
                        </span>

                        {moreActive && !sheetOpen && (
                            <span className="absolute bottom-0 inset-x-3 h-0.5 bg-black rounded-full" />
                        )}
                    </button>}
                </div>
            </nav>
        </>
    );
}
