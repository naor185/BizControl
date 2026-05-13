"use client";

import { useEffect, useMemo, useState, Suspense, lazy } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, setToken } from "@/lib/api";
import { useLang } from "@/components/LanguageProvider";
import { LOCALES } from "@/lib/i18n";

const OceanBackground = lazy(() => import("@/components/OceanBackground"));

const LS_KEY = "biz_remember";

function LoginContent() {
    const router = useRouter();
    const sp = useSearchParams();
    const nextUrl = useMemo(() => sp.get("next") || "/dashboard", [sp]);

    const { t, locale, setLocale, dir } = useLang();
    const [studioSlug, setStudioSlug] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(false);
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [step, setStep] = useState<"credentials" | "2fa">("credentials");
    const [pendingToken, setPendingToken] = useState("");
    const [totpCode, setTotpCode] = useState("");

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
            if (saved) {
                setStudioSlug(saved.studioSlug || "");
                setEmail(saved.email || "");
                setPassword(saved.password || "");
                setRememberMe(true);
            }
        } catch {}
    }, []);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setLoading(true);
        try {
            const res = await apiFetch<{ access_token?: string; refresh_token?: string; requires_2fa?: boolean; pending_token?: string }>(
                "/api/auth/login",
                { method: "POST", auth: false, body: JSON.stringify({ studio_slug: studioSlug, email, password }) },
            );

            if (res.requires_2fa && res.pending_token) {
                setPendingToken(res.pending_token);
                setStep("2fa");
                return;
            }

            if (rememberMe) {
                localStorage.setItem(LS_KEY, JSON.stringify({ studioSlug, email, password }));
            } else {
                localStorage.removeItem(LS_KEY);
            }

            setToken(res.access_token!, res.refresh_token);
            const me = await apiFetch<{ role: string }>("/api/auth/me");
            router.replace(me.role === "superadmin" ? "/admin" : nextUrl);
        } catch (e: unknown) {
            const msg = String((e as Error)?.message || "");
            setErr(msg.includes("Failed to fetch") || msg.includes("NetworkError") ? "לא ניתן להתחבר לשרת." : msg || "שגיאה בהתחברות");
        } finally {
            setLoading(false);
        }
    }

    async function onSubmit2FA(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setLoading(true);
        try {
            const res = await apiFetch<{ access_token: string; refresh_token?: string }>(
                "/api/auth/2fa/verify",
                { method: "POST", auth: false, body: JSON.stringify({ pending_token: pendingToken, code: totpCode }) },
            );
            setToken(res.access_token, res.refresh_token);
            const me = await apiFetch<{ role: string }>("/api/auth/me");
            router.replace(me.role === "superadmin" ? "/admin" : nextUrl);
        } catch (e: unknown) {
            setErr((e as Error)?.message || "קוד שגוי");
        } finally {
            setLoading(false);
        }
    }

    /* ── 2FA step ── */
    if (step === "2fa") return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-50 to-slate-100" dir={dir}>
            <div className="w-full max-w-sm">
                <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8">
                    <div className="flex flex-col items-center mb-7">
                        <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-2xl mb-4">🔐</div>
                        <h1 className="text-xl font-bold text-slate-900">{t("login_2fa_title")}</h1>
                        <p className="text-sm text-slate-500 mt-1 text-center leading-relaxed">{t("login_2fa_sub")}</p>
                    </div>
                    <form onSubmit={onSubmit2FA} className="space-y-4">
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={totpCode}
                            onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                            placeholder="000 000"
                            dir="ltr"
                            className="w-full text-center text-2xl tracking-[0.4em] font-mono rounded-2xl border-2 border-slate-200 px-3 py-4 outline-none focus:border-black transition-colors bg-slate-50"
                            autoFocus
                        />
                        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{err}</div>}
                        <button
                            disabled={loading || totpCode.length < 6}
                            className="w-full rounded-2xl bg-black text-white py-3 font-semibold disabled:opacity-50 transition-opacity"
                        >
                            {loading ? t("loading") : t("login_2fa_btn")}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setStep("credentials"); setErr(null); setTotpCode(""); }}
                            className="w-full text-sm text-slate-400 hover:text-slate-600 transition-colors py-1"
                        >
                            {t("login_2fa_back")}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );

    /* ── Main login ── */
    return (
        <div className="min-h-screen relative overflow-hidden" dir={dir}>

            {/* 3D Ocean Background */}
            <Suspense fallback={<div className="absolute inset-0 bg-gradient-to-b from-[#001a2e] to-[#003055]" />}>
                <OceanBackground />
            </Suspense>

            {/* Overlay gradient for readability */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30 pointer-events-none" />

            {/* Language switcher */}
            <div className="fixed top-4 left-4 flex gap-1 z-20">
                {LOCALES.map(l => (
                    <button
                        key={l.code}
                        onClick={() => setLocale(l.code)}
                        className={`w-9 h-9 rounded-xl text-base transition-all ${
                            locale === l.code
                                ? "bg-white/20 backdrop-blur text-white shadow-sm border border-white/30"
                                : "bg-black/20 backdrop-blur hover:bg-white/20 text-white/70 border border-white/10"
                        }`}
                    >
                        {l.flag}
                    </button>
                ))}
            </div>

            {/* Centered content */}
            <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6">

            {/* Logo / Title */}
            <div className="mb-8 flex flex-col items-center">
                <div className="mb-3">
                    <img src="/logo.png" alt="BizControl" className="w-24 h-24 object-contain drop-shadow-2xl" />
                </div>
                <div className="font-black text-3xl text-white tracking-tight drop-shadow-lg">BizControl</div>
                <div className="text-sm text-blue-200/80 mt-1">ניהול העסק שלך, בפשטות</div>
            </div>

            {/* Card */}
            <div className="w-full max-w-sm">
                <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8">
                    <div className="mb-6">
                        <h1 className="text-xl font-bold text-white">{t("login_title")}</h1>
                        <p className="text-sm text-blue-200/70 mt-0.5">{t("login_subtitle")}</p>
                    </div>

                    <form onSubmit={onSubmit} className="space-y-4">
                        <div>
                            <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">{t("login_slug")}</label>
                            <input
                                className="w-full rounded-xl border border-white/20 focus:border-white/50 px-3.5 py-2.5 text-sm outline-none text-left bg-white/10 text-white placeholder-white/30 focus:bg-white/15 transition-all"
                                value={studioSlug}
                                onChange={e => setStudioSlug(e.target.value)}
                                autoComplete="organization"
                                dir="ltr"
                                placeholder="my-studio"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">{t("login_email")}</label>
                            <input
                                className="w-full rounded-xl border border-white/20 focus:border-white/50 px-3.5 py-2.5 text-sm outline-none text-left bg-white/10 text-white placeholder-white/30 focus:bg-white/15 transition-all"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                type="email"
                                autoComplete="email"
                                dir="ltr"
                                placeholder="you@example.com"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">{t("login_password")}</label>
                            <div className="relative">
                                <input
                                    className="w-full rounded-xl border border-white/20 focus:border-white/50 px-3.5 py-2.5 text-sm outline-none text-left bg-white/10 text-white placeholder-white/30 focus:bg-white/15 transition-all pl-11"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    type={showPass ? "text" : "password"}
                                    autoComplete="current-password"
                                    dir="ltr"
                                    placeholder="••••••••"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(!showPass)}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors"
                                >
                                    {showPass ? (
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                        </svg>
                                    ) : (
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>

                        <label className="flex items-center gap-2.5 cursor-pointer">
                            <input
                                id="remember"
                                type="checkbox"
                                checked={rememberMe}
                                onChange={e => setRememberMe(e.target.checked)}
                                className="w-4 h-4 rounded accent-blue-400"
                            />
                            <span className="text-sm text-blue-100/60">{t("login_remember")}</span>
                        </label>

                        {err && (
                            <div className="text-sm text-red-200 bg-red-500/20 border border-red-400/30 rounded-xl p-3 flex items-center gap-2">
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.997L13.732 4.997c-.77-1.33-2.694-1.33-3.464 0L3.34 16.003c-.77 1.33.192 2.997 1.732 2.997z" />
                                </svg>
                                {err}
                            </div>
                        )}

                        <button
                            disabled={loading}
                            className="w-full rounded-2xl bg-white/20 hover:bg-white/30 border border-white/30 text-white py-3 font-semibold disabled:opacity-50 transition-all backdrop-blur mt-1 shadow-lg"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    {t("login_loading")}
                                </span>
                            ) : t("login_btn")}
                        </button>

                        <div className="text-center pt-1">
                            <a href="/forgot-password" className="text-xs text-blue-200/50 hover:text-blue-200/80 transition-colors">
                                שכחתי סיסמה
                            </a>
                        </div>
                    </form>
                </div>

                <p className="text-center text-xs text-blue-200/40 mt-4">
                    BizControl © {new Date().getFullYear()}
                </p>
            </div>

            </div>{/* end centered */}
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
            </div>
        }>
            <LoginContent />
        </Suspense>
    );
}
