"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";

const mainItems = [
    { href: "/calendar", label: "יומן תורים", icon: "📅" },
    { href: "/booking-requests", label: "בקשות תורים", icon: "🔔" },
    { href: "/inbox", label: "תיבת הודעות", icon: "💬" },
    { href: "/expenses", label: "ניהול עסק", icon: "💼" },
    { href: "/products", label: "מוצרים ומלאי", icon: "📦" },
    { href: "/dashboard", label: "לוח בקרה", icon: "📊" },
    { href: "/clients", label: "לקוחות", icon: "👥" },
];

const settingsItems = [
    { href: "/team", label: "צוות ומקעקעים", icon: "🎨" },
    { href: "/team/payroll", label: "דוחות שכר", icon: "💰" },
    { href: "/message-log", label: "יומן הודעות", icon: "💬" },
    { href: "/payments", label: "תשלומים", icon: "💳" },
    { href: "/automation", label: "הגדרות", icon: "⚙️" },
    { href: "/help", label: "מרכז עזרה", icon: "🆘" },
];

export default function Sidebar() {
    const pathname = usePathname();
    const isInSettings = settingsItems.some(it => pathname === it.href);
    const [settingsOpen, setSettingsOpen] = useState(isInSettings);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        const load = async () => {
            try {
                const data = await apiFetch<{ unread: number }>("/api/inbox/unread-count");
                setUnreadCount(data.unread);
            } catch { /* not logged in yet */ }
        };
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, []);

    return (
        <aside className="w-72 border-l bg-white flex flex-col h-full">
            <div className="p-6">
                <div className="text-xl font-bold tracking-tight">BizControl</div>
                <div className="mt-1 text-sm text-zinc-500">מערכת ניהול סטודיו</div>
            </div>

            <nav className="px-3 pb-6 flex-1">
                {mainItems.map((it) => {
                    const active = pathname === it.href;
                    const isInbox = it.href === "/inbox";
                    return (
                        <Link
                            key={it.href}
                            href={it.href}
                            className={[
                                "mb-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium",
                                active ? "bg-zinc-900 text-white" : "hover:bg-zinc-100 text-zinc-700",
                            ].join(" ")}
                        >
                            <span>{it.icon}</span>
                            <span className="flex-1">{it.label}</span>
                            {isInbox && unreadCount > 0 && (
                                <span className="bg-green-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                                    {unreadCount > 99 ? "99+" : unreadCount}
                                </span>
                            )}
                        </Link>
                    );
                })}

                {/* Settings Group */}
                <div className="mt-4">
                    <button
                        onClick={() => setSettingsOpen(o => !o)}
                        className={[
                            "w-full mb-1 flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                            isInSettings ? "bg-zinc-100 text-zinc-900" : "hover:bg-zinc-50 text-zinc-500",
                        ].join(" ")}
                    >
                        <div className="flex items-center gap-2">
                            <span>⚙️</span>
                            <span>הגדרות</span>
                        </div>
                        <span className="text-xs text-zinc-400">{settingsOpen ? "▲" : "▼"}</span>
                    </button>

                    {settingsOpen && (
                        <div className="mr-4 border-r-2 border-zinc-100 pr-2 space-y-0.5">
                            {settingsItems.map((it) => {
                                const active = pathname === it.href;
                                return (
                                    <Link
                                        key={it.href}
                                        href={it.href}
                                        className={[
                                            "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
                                            active ? "bg-zinc-900 text-white font-semibold" : "hover:bg-zinc-100 text-zinc-600",
                                        ].join(" ")}
                                    >
                                        <span>{it.icon}</span>
                                        <span>{it.label}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            </nav>

            <div className="border-t p-4 text-xs text-zinc-500">
                <div>API: {process.env.NEXT_PUBLIC_API_BASE || "לא מוגדר"}</div>
            </div>
        </aside>
    );
}
