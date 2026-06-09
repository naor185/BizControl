"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, clearToken, getToken, setToken } from "@/lib/api";
import ClockWidget from "./ClockWidget";
import BottomNav from "./BottomNav";
import NotificationBell from "./NotificationBell";
import ToastContainer from "./ToastContainer";
import GlobalToast from "./GlobalToast";
import AIAssistant from "./AIAssistant";
import PinModal from "./PinModal";
import QuickWhatsAppModal from "./QuickWhatsAppModal";
import { useLang } from "./LanguageProvider";
import { LOCALES } from "@/lib/i18n";
import { isBusinessSessionValid } from "@/lib/businessSession";

type Me = {
    id: string;
    studio_id: string;
    role: string;
    email?: string | null;
    display_name?: string | null;
};

type PinStatus = { has_pin: boolean; is_locked: boolean };

const MAIN_NAV: { href: string; label: string; icon: string; module?: string }[] = [
    { href: "/calendar",  label: "יומן תורים",  icon: "📅" },
    { href: "/pos",       label: "קופה",         icon: "🛒" },
    { href: "/dashboard", label: "לוח בקרה",   icon: "📊" },
    { href: "/clients",   label: "לקוחות",       icon: "👥" },
    { href: "/inbox",     label: "הודעות",       icon: "💬" },
    { href: "/leads",     label: "לידים CRM",   icon: "🎯" },
    { href: "/analytics", label: "אנליטיקות",   icon: "📈", module: "analytics" },
];

const MANAGE_NAV: { href: string; label: string; icon: string; module?: string }[] = [
    { href: "/services",     label: "שירותים",        icon: "🛎️" },
    { href: "/automations",  label: "אוטומציות",      icon: "⚡" },
    { href: "/wait-list",    label: "רשימת המתנה",   icon: "⏳", module: "wait_list" },
    { href: "/products",     label: "מוצרים",         icon: "📦" },
    { href: "/expenses",     label: "הוצאות",          icon: "💼" },
    { href: "/team",         label: "צוות",            icon: "🎨" },
    { href: "/stamps",       label: "כרטיסי חותמות",  icon: "🎁", module: "customer_club" },
    { href: "/tiers",        label: "רמות VIP",        icon: "👑", module: "customer_club" },
];

export default function AppShell({
    title,
    titleAction,
    children,
    fullBleed = false,
}: {
    title?: string;
    titleAction?: React.ReactNode;
    children: React.ReactNode;
    fullBleed?: boolean;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { t, locale, setLocale, dir } = useLang();
    const [langOpen, setLangOpen] = useState(false);

    const [me, setMe] = useState<Me | null>(null);
    const [locations, setLocations] = useState<{ id: string; name: string; location_name: string; logo_url?: string; primary_color: string }[]>([]);
    const [switchingLocation, setSwitchingLocation] = useState(false);
    const [isImpersonating, setIsImpersonating] = useState(false);
    const [businessUnlocked, setBusinessUnlocked] = useState(false);
    const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
    const [showPin, setShowPin] = useState(false);
    const [pinMode, setPinMode] = useState<"verify" | "set">("verify");
    const [pendingDepositsCount, setPendingDepositsCount] = useState(0);
    const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
    const [enabledModules, setEnabledModules] = useState<Record<string, boolean> | null>(null);
    const [showWaModal, setShowWaModal] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            setIsImpersonating(!!sessionStorage.getItem("admin_return"));
        }
    }, []);

    useEffect(() => {
        setBusinessUnlocked(isBusinessSessionValid());
    }, [pathname]);

    const handleReturnToAdmin = () => {
        const adminToken = sessionStorage.getItem("admin_token");
        if (adminToken) setToken(adminToken);
        sessionStorage.removeItem("admin_token");
        sessionStorage.removeItem("admin_return");
        router.replace("/admin");
    };

    useEffect(() => {
        (async () => {
            try {
                const token = getToken();
                if (!token) return;
                const [data, pin, deposits, inbox, locs, mods] = await Promise.all([
                    apiFetch<Me>("/api/auth/me"),
                    apiFetch<PinStatus>("/api/security/pin/status"),
                    apiFetch<any[]>("/api/appointments/pending-deposits").catch(() => []),
                    apiFetch<{ unread: number }>("/api/inbox/unread-count").catch(() => ({ unread: 0 })),
                    apiFetch<any[]>("/api/locations").catch(() => []),
                    apiFetch<Record<string, boolean>>("/api/modules/me").catch(() => null),
                ]);
                setMe(data);
                setPinStatus(pin);
                setPendingDepositsCount(deposits.length);
                setInboxUnreadCount(inbox.unread);
                if (locs.length > 1) setLocations(locs);
                setEnabledModules(mods);
            } catch { /* silent */ }
        })();
    }, []);

    // SSE — live unread count (replaces polling)
    useEffect(() => {
        const token = getToken();
        if (!token || typeof EventSource === "undefined") return;
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
        const url = `${apiBase}/api/inbox/stream?token=${encodeURIComponent(token)}`;
        const es = new EventSource(url);
        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (typeof data.unread === "number") setInboxUnreadCount(data.unread);
            } catch { /* ignore */ }
        };
        return () => es.close();
    }, []);

    function logout() {
        clearToken();
        router.replace("/login");
    }

    const handleBusinessClick = () => {
        if (isBusinessSessionValid()) {
            router.push("/business");
            return;
        }
        if (!pinStatus) {
            router.push("/business");
            return;
        }
        setPinMode(pinStatus.has_pin ? "verify" : "set");
        setShowPin(true);
    };

    const handlePinSuccess = () => {
        setShowPin(false);
        if (!pinStatus?.has_pin) {
            setPinStatus(s => s ? { ...s, has_pin: true } : s);
            setPinMode("verify");
            setShowPin(true);
        } else {
            setBusinessUnlocked(true);
            router.push("/business");
        }
    };

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
                <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-white border-l border-slate-100 shadow-sm z-20">
                    {/* Logo */}
                    <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100">
                        <div className="font-black text-slate-900 tracking-tight text-lg" dir="ltr">BizControl</div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-semibold" dir="ltr">v2</span>
                    </div>

                    {/* Nav */}
                    <nav className="flex-1 p-2.5 space-y-0.5 overflow-y-auto">
                        {MAIN_NAV.filter(item => !item.module || !enabledModules || enabledModules[item.module] !== false).map(item => {
                            const active = pathname === item.href || pathname.startsWith(item.href + "/");
                            const badge = item.href === "/dashboard" && pendingDepositsCount > 0
                                ? pendingDepositsCount
                                : item.href === "/inbox" && inboxUnreadCount > 0
                                ? inboxUnreadCount
                                : 0;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={[
                                        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                                        active
                                            ? "bg-slate-900 text-white shadow-sm"
                                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                                    ].join(" ")}
                                >
                                    <span className="text-base leading-none">{item.icon}</span>
                                    <span className="flex-1">{item.label}</span>
                                    {badge > 0 && (
                                        <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-4.5 h-4.5 flex items-center justify-center px-1">
                                            {badge}
                                        </span>
                                    )}
                                </Link>
                            );
                        })}

                        {/* Quick WhatsApp send */}
                        <button
                            type="button"
                            onClick={() => setShowWaModal(true)}
                            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all text-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 border border-emerald-100 mt-1"
                        >
                            <span className="text-base leading-none">📱</span>
                            <span className="flex-1">שלח וואטסאפ</span>
                        </button>

                        <div className="pt-2 pb-1 px-3">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ניהול</span>
                        </div>

                        {MANAGE_NAV.filter(item => !item.module || !enabledModules || enabledModules[item.module] !== false).map(item => {
                            const active = pathname === item.href || pathname.startsWith(item.href + "/");
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={[
                                        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                                        active
                                            ? "bg-slate-900 text-white shadow-sm"
                                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                                    ].join(" ")}
                                >
                                    <span className="text-base leading-none">{item.icon}</span>
                                    <span className="flex-1">{item.label}</span>
                                </Link>
                            );
                        })}

                        <div className="pt-2 pb-1">
                            <div className="px-3 pb-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">עסק</span>
                            </div>
                        </div>

                        {/* Business Management — PIN locked */}
                        <button
                            onClick={handleBusinessClick}
                            className={[
                                "w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                                pathname.startsWith("/business")
                                    ? "bg-violet-600 text-white shadow-sm"
                                    : "text-slate-600 hover:bg-violet-50 hover:text-violet-700",
                            ].join(" ")}
                        >
                            <span className="text-base leading-none">{businessUnlocked ? "🏢" : "🔐"}</span>
                            <span className="flex-1 text-right">ניהול עסק</span>
                            {!businessUnlocked && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="opacity-50">
                                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2.5" fill="none" />
                                    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                                </svg>
                            )}
                        </button>
                    </nav>

                    {/* Bottom: lang + user + logout */}
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
                            <div className="w-8 h-8 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                                {avatarLetter}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-slate-800 truncate" dir="ltr">
                                    {me?.display_name || me?.email || "—"}
                                </div>
                                <div className="text-[10px] text-slate-400">{me?.role || "owner"}</div>
                            </div>
                        </div>

                        {/* Location switcher — shown when studio has multiple branches */}
                        {locations.length > 1 && (
                            <div className="w-full">
                                <div className="text-[10px] text-slate-400 mb-1 px-1">🏢 החלף סניף</div>
                                <div className="flex flex-col gap-1">
                                    {locations.map(loc => (
                                        <button
                                            key={loc.id}
                                            disabled={switchingLocation}
                                            onClick={async () => {
                                                setSwitchingLocation(true);
                                                try {
                                                    const res = await apiFetch<{ access_token: string }>(`/api/locations/switch/${loc.id}`, { method: "POST" });
                                                    setToken(res.access_token);
                                                    window.location.href = "/dashboard";
                                                } catch { }
                                                finally { setSwitchingLocation(false); }
                                            }}
                                            className="w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-violet-50 hover:border-violet-300 text-xs py-1.5 px-2 font-medium text-slate-600 transition-colors text-right"
                                        >
                                            {loc.logo_url ? (
                                                <img src={loc.logo_url} alt="" className="w-5 h-5 rounded-md object-cover" />
                                            ) : (
                                                <span className="w-5 h-5 rounded-md flex items-center justify-center text-xs" style={{ background: loc.primary_color + "33" }}>🏢</span>
                                            )}
                                            <span className="truncate">{loc.location_name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

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
                                {title && <h1 className="text-lg font-bold text-slate-900">{title}</h1>}
                                {titleAction}
                            </div>

                            <div className="flex items-center gap-3">
                                <NotificationBell />
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

                    <main className={fullBleed ? "h-[calc(100vh-3.5rem)] overflow-hidden" : "p-5 pb-28 md:pb-6"}>{children}</main>
                </div>
            </div>

            <AIAssistant />
            <ClockWidget />
            <BottomNav />
            <ToastContainer />
            <GlobalToast />

            {showPin && (
                <PinModal
                    mode={pinMode}
                    onSuccess={handlePinSuccess}
                    onClose={() => setShowPin(false)}
                />
            )}

            {showWaModal && (
                <QuickWhatsAppModal onClose={() => setShowWaModal(false)} />
            )}
        </div>
    );
}
