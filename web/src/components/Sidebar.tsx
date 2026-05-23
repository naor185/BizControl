"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { isBusinessSessionValid } from "@/lib/businessSession";
import PinModal from "@/components/PinModal";

const mainItems = [
    { href: "/dashboard", label: "לוח בקרה", icon: "📊" },
    { href: "/calendar", label: "יומן תורים", icon: "📅" },
    { href: "/pos", label: "קופה", icon: "🛒" },
    { href: "/clients", label: "לקוחות", icon: "👥" },
];

type PinStatus = { has_pin: boolean; is_locked: boolean };

export default function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const [unreadCount, setUnreadCount] = useState(0);
    const [businessUnlocked, setBusinessUnlocked] = useState(false);
    const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
    const [showPin, setShowPin] = useState(false);
    const [pinMode, setPinMode] = useState<"verify" | "set">("verify");

    useEffect(() => {
        setBusinessUnlocked(isBusinessSessionValid());
    }, [pathname]);

    useEffect(() => {
        const load = async () => {
            try {
                const [inbox, pin] = await Promise.all([
                    apiFetch<{ unread: number }>("/api/inbox/unread-count"),
                    apiFetch<PinStatus>("/api/security/pin/status"),
                ]);
                setUnreadCount(inbox.unread);
                setPinStatus(pin);
            } catch { }
        };
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, []);

    const isBusinessArea = pathname.startsWith("/business");

    const handleBusinessClick = () => {
        if (isBusinessSessionValid()) {
            router.push("/business");
            return;
        }
        if (!pinStatus) return;
        setPinMode(pinStatus.has_pin ? "verify" : "set");
        setShowPin(true);
    };

    const handlePinSuccess = () => {
        setShowPin(false);
        if (!pinStatus?.has_pin) {
            // Just set PIN — now verify to enter
            setPinStatus(s => s ? { ...s, has_pin: true } : s);
            setPinMode("verify");
            setShowPin(true);
        } else {
            setBusinessUnlocked(true);
            router.push("/business");
        }
    };

    return (
        <aside className="w-64 border-l bg-white flex flex-col h-full shrink-0">
            {/* Logo */}
            <div className="px-5 py-6 border-b border-slate-100">
                <div className="text-lg font-bold tracking-tight text-slate-900">BizControl</div>
                <div className="mt-0.5 text-xs text-slate-400">מערכת ניהול סטודיו</div>
            </div>

            {/* Main nav */}
            <nav className="flex-1 px-3 py-4 space-y-0.5">
                {mainItems.map((it) => {
                    const active = pathname === it.href || pathname.startsWith(it.href + "/");
                    const isInbox = it.href === "/inbox";
                    return (
                        <Link
                            key={it.href}
                            href={it.href}
                            className={[
                                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                                active
                                    ? "bg-slate-900 text-white shadow-sm"
                                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                            ].join(" ")}
                        >
                            <span className="text-base">{it.icon}</span>
                            <span className="flex-1">{it.label}</span>
                            {isInbox && unreadCount > 0 && (
                                <span className="bg-emerald-500 text-white text-[10px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1">
                                    {unreadCount > 99 ? "99+" : unreadCount}
                                </span>
                            )}
                        </Link>
                    );
                })}

                {/* Divider */}
                <div className="pt-4 pb-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3">
                        ניהול
                    </div>
                </div>

                {/* Business Management — locked */}
                <button
                    onClick={handleBusinessClick}
                    className={[
                        "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                        isBusinessArea
                            ? "bg-violet-600 text-white shadow-sm shadow-violet-500/30"
                            : "text-slate-600 hover:bg-violet-50 hover:text-violet-700",
                    ].join(" ")}
                >
                    <span className="text-base">
                        {businessUnlocked ? "🏢" : "🔐"}
                    </span>
                    <span className="flex-1 text-right">ניהול עסק</span>
                    {!businessUnlocked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="opacity-50">
                            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2.5" fill="none" />
                            <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                    )}
                </button>
            </nav>

            {/* Footer */}
            <div className="border-t border-slate-100 px-5 py-3">
                <div className="text-[10px] text-slate-400">
                    {process.env.NEXT_PUBLIC_API_BASE ? `v2 · ${process.env.NEXT_PUBLIC_API_BASE.replace(/https?:\/\//, "").split("/")[0]}` : "BizControl v2"}
                </div>
            </div>

            {/* PIN Modal */}
            {showPin && (
                <PinModal
                    mode={pinMode}
                    onSuccess={handlePinSuccess}
                    onClose={() => setShowPin(false)}
                />
            )}
        </aside>
    );
}
