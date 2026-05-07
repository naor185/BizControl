"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { apiFetch, setToken } from "@/lib/api";
import { useLang } from "@/components/LanguageProvider";
import { LOCALES } from "@/lib/i18n";

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
            const res = await apiFetch<{ access_token?: string; requires_2fa?: boolean; pending_token?: string; refresh_token?: string }>(
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

            setToken(res.access_token!);
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
            const res = await apiFetch<{ access_token: string }>(
                "/api/auth/2fa/verify",
                { method: "POST", auth: false, body: JSON.stringify({ pending_token: pendingToken, code: totpCode }) },
            );
            setToken(res.access_token);
            const me = await apiFetch<{ role: string }>("/api/auth/me");
            router.replace(me.role === "superadmin" ? "/admin" : nextUrl);
        } catch (e: unknown) {
            setErr((e as Error)?.message || "קוד שגוי");
        } finally {
            setLoading(false);
        }
    }

    if (step === "2fa") return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#f8fafc] to-[#e2e8f0]" dir={dir}>
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-8 border border-white/60">
                <div className="flex flex-col items-center mb-6">
                    <div className="text-4xl mb-3">🔐</div>
                    <h1 className="text-xl font-bold text-slate-800">{t("login_2fa_title")}</h1>
                    <p className="text-sm text-slate-500 mt-1 text-center">{t("login_2fa_sub")}</p>
                </div>
                <form onSubmit={onSubmit2FA} className="space-y-4">
                    <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={totpCode}
                        onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="000000"
                        dir="ltr"
                        className="w-full text-center text-2xl tracking-[0.5em] font-mono rounded-lg border px-3 py-3 outline-none focus:ring-2 focus:ring-black/20"
                        autoFocus
                    />
                    {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
                    <button disabled={loading || totpCode.length < 6} className="w-full rounded-lg bg-black text-white py-2 font-medium disabled:opacity-60">
                        {loading ? t("loading") : t("login_2fa_btn")}
                    </button>
                    <button type="button" onClick={() => { setStep("credentials"); setErr(null); setTotpCode(""); }}
                        className="w-full text-sm text-slate-400 hover:text-slate-600">
                        {t("login_2fa_back")}
                    </button>
                </form>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#f8fafc] to-[#e2e8f0]" dir={dir}>
            {/* Language switcher */}
            <div className="absolute top-4 left-4 flex gap-1">
                {LOCALES.map(l => (
                    <button
                        key={l.code}
                        onClick={() => setLocale(l.code)}
                        className={`px-2 py-1 rounded-lg text-sm transition ${locale === l.code ? "bg-black text-white" : "bg-white/60 hover:bg-white text-slate-600"}`}
                    >
                        {l.flag}
                    </button>
                ))}
            </div>

            <div className="mb-6 flex flex-col items-center">
                <Image src="/logo.png" alt="BizControl" width={180} height={180} className="object-contain drop-shadow-md" />
            </div>

            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-8 border border-white/60 backdrop-blur-sm">
                <div className="flex flex-col items-center justify-center mb-6">
                    <h1 className="text-2xl font-bold text-slate-800">{t("login_title")}</h1>
                    <span className="text-sm mt-1 text-slate-500">{t("login_subtitle")}</span>
                </div>

                <form onSubmit={onSubmit} className="space-y-5">
                    <div>
                        <label className="text-sm font-medium">{t("login_slug")}</label>
                        <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-left"
                            value={studioSlug}
                            onChange={(e) => setStudioSlug(e.target.value)}
                            autoComplete="organization"
                            dir="ltr"
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium">{t("login_email")}</label>
                        <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-left"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            type="email"
                            autoComplete="email"
                            dir="ltr"
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium">{t("login_password")}</label>
                        <div className="relative mt-1">
                            <input
                                className="w-full rounded-lg border px-3 py-2 text-left pl-10"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                type={showPass ? "text" : "password"}
                                autoComplete="current-password"
                                dir="ltr"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPass(!showPass)}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPass ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            id="remember"
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="w-4 h-4 rounded"
                        />
                        <label htmlFor="remember" className="text-sm text-slate-600 cursor-pointer">{t("login_remember")}</label>
                    </div>

                    {err && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                            {err}
                        </div>
                    )}

                    <button
                        disabled={loading}
                        className="w-full rounded-lg bg-black text-white py-2 font-medium disabled:opacity-60"
                    >
                        {loading ? t("login_loading") : t("login_btn")}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">טוען...</div>}>
            <LoginContent />
        </Suspense>
    );
}
