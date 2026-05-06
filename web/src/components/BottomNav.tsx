"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { clearToken } from "@/lib/api";

const PRIMARY_NAV = [
    { href: "/calendar",  label: "יומן",    icon: "📅" },
    { href: "/clients",   label: "לקוחות",  icon: "👥" },
    { href: "/dashboard", label: "בקרה",    icon: "📊" },
    { href: "/payments",  label: "תשלומים", icon: "💳" },
];

const MORE_NAV = [
    { href: "/expenses",     label: "ניהול עסק",    icon: "💼" },
    { href: "/products",     label: "מוצרים ומלאי", icon: "📦" },
    { href: "/team",         label: "צוות",         icon: "🎨" },
    { href: "/team/payroll", label: "דוחות שכר",    icon: "💰" },
    { href: "/message-log",  label: "הודעות",       icon: "💬" },
    { href: "/automation",   label: "הגדרות",       icon: "⚙️" },
    { href: "/help",         label: "עזרה",         icon: "🆘" },
];

export default function BottomNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [sheetOpen, setSheetOpen] = useState(false);

    const isActive = (href: string) =>
        pathname === href || pathname?.startsWith(href + "/");

    const moreActive = MORE_NAV.some(n => isActive(n.href));

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

            {/* More sheet — slides up */}
            <div
                dir="rtl"
                className={[
                    "fixed bottom-16 right-0 left-0 z-50 md:hidden bg-white rounded-t-3xl shadow-2xl transition-transform duration-300 ease-out",
                    sheetOpen ? "translate-y-0" : "translate-y-full",
                ].join(" ")}
            >
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
                                    "flex flex-col items-center gap-1 py-3 px-2 rounded-2xl text-center transition",
                                    active
                                        ? "bg-black text-white"
                                        : "bg-gray-50 text-gray-700 hover:bg-gray-100",
                                ].join(" ")}
                            >
                                <span className="text-xl">{item.icon}</span>
                                <span className="text-[11px] font-medium leading-tight">{item.label}</span>
                            </Link>
                        );
                    })}

                    {/* Logout tile */}
                    <button
                        onClick={logout}
                        className="flex flex-col items-center gap-1 py-3 px-2 rounded-2xl bg-red-50 text-red-600 hover:bg-red-100 transition"
                    >
                        <span className="text-xl">🚪</span>
                        <span className="text-[11px] font-medium">יציאה</span>
                    </button>
                </div>
            </div>

            {/* Bottom bar */}
            <nav
                dir="rtl"
                className="fixed bottom-0 right-0 left-0 z-50 md:hidden bg-white border-t border-gray-100 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
            >
                <div className="flex items-stretch h-16">
                    {PRIMARY_NAV.map(item => {
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="flex-1 flex flex-col items-center justify-center gap-0.5 transition"
                            >
                                <span
                                    className={[
                                        "text-xl transition-transform",
                                        active ? "scale-110" : "",
                                    ].join(" ")}
                                >
                                    {item.icon}
                                </span>
                                <span
                                    className={[
                                        "text-[10px] font-semibold",
                                        active ? "text-black" : "text-gray-400",
                                    ].join(" ")}
                                >
                                    {item.label}
                                </span>
                                {active && (
                                    <span className="absolute bottom-0 w-8 h-0.5 bg-black rounded-full" />
                                )}
                            </Link>
                        );
                    })}

                    {/* More button */}
                    <button
                        onClick={() => setSheetOpen(o => !o)}
                        className="flex-1 flex flex-col items-center justify-center gap-0.5 transition"
                    >
                        <span className={["text-xl transition-transform", moreActive || sheetOpen ? "scale-110" : ""].join(" ")}>
                            {sheetOpen ? "✕" : "☰"}
                        </span>
                        <span className={["text-[10px] font-semibold", moreActive || sheetOpen ? "text-black" : "text-gray-400"].join(" ")}>
                            עוד
                        </span>
                        {moreActive && !sheetOpen && (
                            <span className="absolute bottom-0 w-8 h-0.5 bg-black rounded-full" />
                        )}
                    </button>
                </div>
            </nav>
        </>
    );
}
