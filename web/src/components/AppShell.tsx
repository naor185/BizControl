"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Calendar, ShoppingCart, LayoutDashboard, Users, Gauge, Building2, Mail, Eye, X, Nfc, type LucideIcon } from "lucide-react";
import { apiFetch, clearToken, getCurrentUserRole, getToken, setToken } from "@/lib/api";
import ClockWidget from "./ClockWidget";
import BottomNav from "./BottomNav";
import NotificationBell from "./NotificationBell";
import ToastContainer from "./ToastContainer";
import GlobalToast from "./GlobalToast";
import PullToRefresh from "./PullToRefresh";
import QuickWhatsAppModal from "./QuickWhatsAppModal";
import { useLang } from "./LanguageProvider";
import { LOCALES } from "@/lib/i18n";
import { useNewLeadsCount } from "@/lib/useNewLeadsCount";
import PlanBar, { PLAN_BAR_HEIGHT, type PlanInfo } from "./PlanBar";
import { registerForPushNotifications } from "@/lib/push";
import { recordVisit } from "@/lib/navHistory";

type Me = {
    id: string;
    studio_id: string;
    role: string;
    email?: string | null;
    display_name?: string | null;
    email_verified?: boolean;
};

const MAIN_NAV: { href: string; label: string; icon: LucideIcon; module?: string }[] = [
    { href: "/overview",  label: "דשבורד",       icon: Gauge },
    { href: "/calendar",  label: "יומן תורים",  icon: Calendar, module: "calendar" },
    { href: "/pos",       label: "קופה",         icon: ShoppingCart, module: "pos" },
    { href: "/dashboard", label: "לוח בקרה",    icon: LayoutDashboard },
    { href: "/clients",   label: "לקוחות",       icon: Users, module: "crm" },
];

const TOP_BAR = "2.75rem";   // the height of each bar at the top of the header (h-11)

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
    const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
    const [locations, setLocations] = useState<{ id: string; name: string; location_name: string; logo_url?: string; primary_color: string }[]>([]);
    const [switchingLocation, setSwitchingLocation] = useState(false);
    const [isImpersonating, setIsImpersonating] = useState(false);
    // a worker (artist/staff) reaches the calendar only (RequireAuth, and the server) — the menu shows them just that;
    // "ניהול עסק" is the owner's and the managers' (the owner, 2026-10-15)
    const [isWorker] = useState(() => ["artist", "staff"].includes(getCurrentUserRole() ?? ""));
    const [pendingDepositsCount, setPendingDepositsCount] = useState(0);
    const newLeadsCount = useNewLeadsCount();
    const [enabledModules, setEnabledModules] = useState<Record<string, boolean> | null>(null);
    const [showWaModal, setShowWaModal] = useState(false);
    const [verifyState, setVerifyState] = useState<"idle" | "sending" | "sent" | "error">("idle");
    // With the NFC clock: a worker with appointments today who hasn't clocked in is asked to touch the sticker
    // (owner, 2026-10-13) — checked on opening and whenever the app comes back to the front (after touching it)
    const [clockInNeeded, setClockInNeeded] = useState(false);
    useEffect(() => {
        const check = () => apiFetch<{ clock_in_needed?: boolean }>("/api/staff/clock-status")
            .then(r => setClockInNeeded(!!r.clock_in_needed)).catch(() => {});
        check();
        const onShow = () => { if (document.visibilityState === "visible") check(); };
        document.addEventListener("visibilitychange", onShow);
        return () => document.removeEventListener("visibilitychange", onShow);
    }, []);
    // The e-mail banner can be put away until the next visit — it sits in the header now, always on screen
    const [verifyHidden, setVerifyHidden] = useState(false);
    useEffect(() => {
        try { setVerifyHidden(sessionStorage.getItem("biz_verify_hidden") === "1"); } catch { /* shown */ }
    }, []);
    const hideVerify = () => {
        setVerifyHidden(true);
        try { sessionStorage.setItem("biz_verify_hidden", "1"); } catch { /* hidden for this page only */ }
    };

    const resendVerification = async () => {
        setVerifyState("sending");
        try {
            await apiFetch("/api/auth/resend-verification", { method: "POST" });
            setVerifyState("sent");
        } catch {
            setVerifyState("error");
        }
    };

    useEffect(() => {
        if (typeof window !== "undefined") {
            setIsImpersonating(!!sessionStorage.getItem("admin_return"));
        }
    }, []);

    // The plan bar appears only on the "דשבורד" page (/overview), whatever the plan — nowhere else.
    // The room it takes at the bottom is reserved only while it is shown.
    const showPlanBar = !!planInfo && pathname === "/overview";

    // "Back" appears on every screen that was reached from another screen of the app (desktop and
    // phone), and takes you to exactly where you were. It is hidden on the first screen of a session.
    const [canGoBack, setCanGoBack] = useState(false);
    useEffect(() => {
        setCanGoBack(recordVisit(pathname || ""));
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
                registerForPushNotifications(router);
                const [data, deposits, locs, mods, studioInfo] = await Promise.all([
                    apiFetch<Me>("/api/auth/me"),
                    apiFetch<any[]>("/api/appointments/pending-deposits").catch(() => []),
                    apiFetch<any[]>("/api/locations").catch(() => []),
                    apiFetch<Record<string, boolean>>("/api/modules/me").catch(() => null),
                    apiFetch<PlanInfo>("/api/auth/studio-info").catch(() => null),
                ]);
                setMe(data);
                setPendingDepositsCount(deposits.length);
                if (locs.length > 1) setLocations(locs);
                setEnabledModules(mods);
                if (studioInfo) setPlanInfo(studioInfo);
            } catch { /* silent */ }
        })();
    }, []);


    function logout() {
        clearToken();
        router.replace("/login");
    }

    const avatarLetter = (me?.display_name || me?.email || "?")[0].toUpperCase();
    const showVerifyBar = me?.email_verified === false && !verifyHidden;
    const topBars = (showVerifyBar ? 1 : 0) + (isImpersonating ? 1 : 0) + (clockInNeeded ? 1 : 0);

    return (
        <div className="app-shell min-h-screen bg-slate-50" dir={dir}>
            <div className="flex">
                {/* Sidebar */}
                <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-white border-l border-slate-100 shadow-sm z-20">
                    {/* Logo */}
                    <div className="px-4 py-4 flex items-center justify-center border-b border-slate-100">
                        <img src="/logo.png" alt="BizControl" className="w-full max-w-40 h-auto object-contain" />
                    </div>

                    {/* Nav */}
                    <nav className="flex-1 p-2.5 space-y-0.5 overflow-y-auto">
                        {MAIN_NAV.filter(item => (!isWorker || item.href === "/calendar")
                            && (!item.module || !enabledModules || enabledModules[item.module] !== false)).map(item => {
                            const active = pathname === item.href || pathname.startsWith(item.href + "/")
                                || (item.href === "/clients" && pathname === "/wallet");
                            const badge = item.href === "/dashboard" ? pendingDepositsCount
                                : item.href === "/overview" ? newLeadsCount
                                : 0;
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={[
                                        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-base font-medium transition-all",
                                        active
                                            ? "text-white shadow-sm"
                                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                                    ].join(" ")}
                                    style={active ? { background: "var(--primary)" } : undefined}
                                >
                                    <Icon className="h-5 w-5 shrink-0" />
                                    <span className="flex-1">{item.label}</span>
                                    {badge > 0 && (
                                        <span className="text-white text-xs font-bold rounded-full min-w-5 h-5 flex items-center justify-center px-1" style={{ background: "var(--accent)" }}>
                                            {badge}
                                        </span>
                                    )}
                                </Link>
                            );
                        })}

                        {/* Business Management — the owner's and the managers' tools, all in one place */}
                        {!isWorker && (<>
                            <div className="pt-2 pb-1">
                                <div className="px-3 pb-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">עסק</span>
                                </div>
                            </div>
                            <Link
                                href="/business"
                                className={[
                                    "w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-base font-medium transition-all",
                                    pathname.startsWith("/business")
                                        ? "text-white shadow-sm"
                                        : "text-slate-600 hover:bg-slate-100",
                                ].join(" ")}
                                style={pathname.startsWith("/business") ? { background: "var(--secondary)" } : undefined}
                            >
                                <Building2 className="h-5 w-5 shrink-0" />
                                <span className="flex-1 text-right">ניהול עסק</span>
                            </Link>
                        </>)}
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
                    <header
                        className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100"
                        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
                    >
                        {/* The bars at the top live in the header, below the phone's clock and battery — at the top of the
                            page they sat under them and their button couldn't be tapped (the owner, 2026-10-12). One line
                            each, TOP_BAR high, so a full-screen page (the calendar) still fits. */}
                        {showVerifyBar && me && (
                            <div className="bg-amber-500 text-white text-xs sm:text-sm font-semibold px-3 sm:px-4 h-11 flex items-center gap-2">
                                <Mail className="w-4 h-4 shrink-0" aria-hidden />
                                <span className="flex-1 min-w-0 truncate">
                                    <span className="sm:hidden">המייל שלך עוד לא אומת</span>
                                    <span className="hidden sm:inline">אמת את כתובת המייל שלך ({me.email}) כדי לקבל עדכונים ותזכורות.</span>
                                </span>
                                {verifyState === "sent" ? (
                                    <span className="bg-white/20 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0">נשלח מייל אימות</span>
                                ) : (
                                    <button
                                        onClick={resendVerification}
                                        disabled={verifyState === "sending"}
                                        className="bg-white text-amber-700 px-3 min-h-8 rounded-lg text-xs font-bold hover:bg-amber-50 transition-colors shrink-0 disabled:opacity-60"
                                    >
                                        {verifyState === "sending" ? "שולח…" : verifyState === "error" ? "נסה שוב" : "שלח אימות"}
                                    </button>
                                )}
                                <button type="button" onClick={hideVerify} aria-label="הסתר עד הכניסה הבאה"
                                    className="w-8 h-8 -me-1 flex items-center justify-center rounded-lg hover:bg-white/15 shrink-0">
                                    <X className="w-4 h-4" aria-hidden />
                                </button>
                            </div>
                        )}
                        {clockInNeeded && (
                            <div role="alert" className="bg-sky-600 text-white text-xs sm:text-sm font-semibold px-3 sm:px-4 h-11 flex items-center gap-2">
                                <Nfc className="w-4 h-4 shrink-0" aria-hidden />
                                <span className="flex-1 min-w-0 truncate">
                                    <span className="sm:hidden">יש לך תורים היום — החתם/י כניסה במדבקה</span>
                                    <span className="hidden sm:inline">יש לך תורים היום ועוד לא החתמת כניסה — הצמד/י את הטלפון למדבקה שבכניסה.</span>
                                </span>
                            </div>
                        )}
                        {isImpersonating && (
                            <div className="bg-amber-400 text-amber-950 text-xs sm:text-sm font-bold px-3 sm:px-4 h-11 flex items-center gap-2">
                                <Eye className="w-4 h-4 shrink-0" aria-hidden />
                                <span className="flex-1 min-w-0 truncate">מצב צפייה — אתה רואה את המערכת כבעל העסק</span>
                                <button
                                    onClick={handleReturnToAdmin}
                                    className="bg-amber-950 text-amber-100 px-3 min-h-8 rounded-lg text-xs font-semibold hover:bg-amber-900 transition-colors shrink-0"
                                >
                                    חזור לאדמין
                                </button>
                            </div>
                        )}
                        <div className="h-14 px-5 flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                                {canGoBack && (
                                    <button
                                        type="button"
                                        onClick={() => router.back()}
                                        aria-label={t("login_2fa_back")}
                                        className="shrink-0 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:scale-95 transition-all"
                                    >
                                        {dir === "rtl" ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
                                        {t("login_2fa_back")}
                                    </button>
                                )}
                                {title && <h1 className="text-lg font-bold text-slate-900 truncate">{title}</h1>}
                                {titleAction}
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setShowWaModal(true)}
                                    aria-label="שלח וואטסאפ"
                                    title="שלח וואטסאפ"
                                    className="flex items-center justify-center w-8 h-8 rounded-full text-emerald-700 hover:bg-emerald-50 border border-emerald-100 transition-colors"
                                >
                                    <span className="text-base leading-none">📱</span>
                                </button>
                                <ClockWidget />
                                {/* the business's bell — the owner's and the managers' (api/notification_routes) */}
                                {!isWorker && <NotificationBell />}
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

                    {/* A full-screen page (the calendar, the till) is the screen less the header, its bars and — on a
                        phone — the bottom bar with the home bar under it; it used to run on under the bottom bar */}
                    <main
                        className={fullBleed
                            ? "overflow-hidden flex flex-col h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px)-var(--top-bars)-var(--plan-bar)-4rem-env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px)-var(--top-bars)-var(--plan-bar))]"
                            : showPlanBar ? "p-5 pb-40 md:pb-16" : "p-5 pb-28 md:pb-6"}
                        style={fullBleed ? { "--top-bars": `calc(${topBars} * ${TOP_BAR})`, "--plan-bar": showPlanBar ? PLAN_BAR_HEIGHT : "0px" } as React.CSSProperties : undefined}
                    >{children}</main>
                </div>
            </div>

            {planInfo && showPlanBar && <PlanBar info={planInfo} />}
            <BottomNav />
            <PullToRefresh />
            <ToastContainer />
            <GlobalToast />

            {showWaModal && (
                <QuickWhatsAppModal onClose={() => setShowWaModal(false)} />
            )}
        </div>
    );
}
