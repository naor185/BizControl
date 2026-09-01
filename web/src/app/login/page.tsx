"use client";

import { useEffect, useMemo, useState, Suspense, lazy } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, setToken } from "@/lib/api";
import { useLang } from "@/components/LanguageProvider";
import { LOCALES } from "@/lib/i18n";
import { BIZFIND_URL } from "@/lib/config";
import PasswordInput from "@/components/PasswordInput";

const OceanBackground = lazy(() => import("@/components/OceanBackground"));

const LS_KEY = "biz_remember";

type FieldErr = "email" | "password" | null;
type Lang = "he" | "en";

interface StudioOption { studio_id: string; studio_name: string | null; role: string; }

const ERR_TEXT: Record<string, Record<Lang, string>> = {
    invalid_credentials: { he: "אחד מהפרטים שהזנת שגוי",       en: "One of the details you entered is incorrect" },
    string_too_short:    { he: "יש למלא את כל השדות",          en: "Please fill in all fields" },
    network:             { he: "לא ניתן להתחבר לשרת",          en: "Cannot connect to server" },
    default_err:         { he: "שגיאה בהתחברות",               en: "Login failed" },
};
// Deliberately not field-specific for invalid_credentials — telling the user
// whether it was the email or password that's wrong lets an attacker
// enumerate registered accounts one field at a time. Both failure reasons
// return this exact same generic code from the backend, on purpose.
const ERR_FIELD: Record<string, FieldErr> = {
    invalid_credentials: null,
    string_too_short:    null,
};

function parseErr(msg: string, locale: string): { text: string; field: FieldErr } {
    const l: Lang = locale.startsWith("en") ? "en" : "he";
    const lockMatch = msg.match(/account_locked:(\d+)/);
    if (lockMatch) {
        const mins = lockMatch[1];
        return {
            text: l === "en"
                ? `Too many failed attempts. Try again in ${mins} minute(s).`
                : `יותר מדי ניסיונות כושלים. נסה שוב בעוד ${mins} דקות.`,
            field: null,
        };
    }
    for (const [code, field] of Object.entries(ERR_FIELD)) {
        if (msg.includes(code)) return { text: ERR_TEXT[code][l], field };
    }
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
        return { text: ERR_TEXT.network[l], field: null };
    // Raw Pydantic/JSON validation error — never show JSON to user
    if (msg.includes('"type"') || msg.includes("validation") || msg.startsWith("[{"))
        return { text: ERR_TEXT.default_err[l], field: null };
    return { text: msg || ERR_TEXT.default_err[l], field: null };
}

function LoginContent() {
    const router = useRouter();
    const sp = useSearchParams();
    const nextUrl = useMemo(() => sp.get("next") || "/calendar", [sp]);

    const { t, locale, setLocale, dir } = useLang();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [fieldErr, setFieldErr] = useState<FieldErr>(null);
    const [step, setStep] = useState<"credentials" | "2fa" | "select-studio">("credentials");
    const [pendingToken, setPendingToken] = useState("");
    const [totpCode, setTotpCode] = useState("");
    const [supportsBiometric, setSupportsBiometric] = useState(false);
    const [selectionToken, setSelectionToken] = useState("");
    const [studioOptions, setStudioOptions] = useState<StudioOption[]>([]);

    useEffect(() => {
        if (typeof window !== "undefined" && "credentials" in navigator && "PasswordCredential" in window) {
            setSupportsBiometric(true);
        }
        const emailFromUrl = sp.get("email");
        if (emailFromUrl) {
            setEmail(emailFromUrl);
            return;
        }
        try {
            const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
            if (saved) {
                setEmail(saved.email || "");
                setRememberMe(true);
            }
        } catch {}
    }, [sp]);

    type LoginResponse = {
        access_token?: string;
        refresh_token?: string;
        requires_2fa?: boolean;
        pending_token?: string;
        requires_studio_selection?: boolean;
        selection_token?: string;
        studios?: StudioOption[];
    };

    async function finishLogin(res: LoginResponse, emailVal: string) {
        if (res.requires_2fa && res.pending_token) {
            setPendingToken(res.pending_token);
            setStep("2fa");
            return;
        }
        if (res.requires_studio_selection && res.selection_token) {
            setSelectionToken(res.selection_token);
            setStudioOptions(res.studios || []);
            setStep("select-studio");
            return;
        }

        if (rememberMe) {
            localStorage.setItem(LS_KEY, JSON.stringify({ email: emailVal }));
        } else {
            localStorage.removeItem(LS_KEY);
        }

        setToken(res.access_token!, res.refresh_token);
        const me = await apiFetch<{ role: string }>("/api/auth/me");
        router.replace(me.role === "superadmin" ? "/admin" : nextUrl);
    }

    async function performLogin(emailVal: string, pwd: string) {
        setErr(null);
        setFieldErr(null);
        const l: Lang = locale.startsWith("en") ? "en" : "he";
        if (!emailVal.trim()) { setErr(l === "he" ? "יש להזין אימייל" : "Email is required"); setFieldErr("email"); return; }
        if (pwd.length < 6) { setErr(l === "he" ? "הסיסמה חייבת להכיל לפחות 6 תווים" : "Password must be at least 6 characters"); setFieldErr("password"); return; }
        setLoading(true);
        try {
            const res = await apiFetch<LoginResponse>(
                "/api/auth/login-by-email",
                { method: "POST", auth: false, body: JSON.stringify({ email: emailVal.toLowerCase().trim(), password: pwd }) },
            );

            // Store credentials for biometric auto-fill (Chrome / Android) —
            // only once we know this wasn't a dead-end (2FA/studio-picker
            // still pending), same as before.
            if (!res.requires_2fa && !res.requires_studio_selection) {
                try {
                    if ("PasswordCredential" in window) {
                        const cred = new (window as any).PasswordCredential({
                            id: emailVal.toLowerCase().trim(),
                            password: pwd,
                        });
                        await navigator.credentials.store(cred);
                    }
                } catch {}
            }

            await finishLogin(res, emailVal);
        } catch (e: unknown) {
            const msg = String((e as Error)?.message || "");
            const { text, field } = parseErr(msg, locale);
            setErr(text);
            setFieldErr(field);
        } finally {
            setLoading(false);
        }
    }

    async function onSelectStudio(studioId: string) {
        setErr(null);
        setLoading(true);
        try {
            const res = await apiFetch<LoginResponse>(
                "/api/auth/select-studio",
                { method: "POST", auth: false, body: JSON.stringify({ selection_token: selectionToken, studio_id: studioId }) },
            );
            await finishLogin(res, email);
        } catch (e: unknown) {
            const { text } = parseErr(String((e as Error)?.message || ""), locale);
            setErr(text);
        } finally {
            setLoading(false);
        }
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        await performLogin(email, password);
    }

    async function loginWithBiometrics() {
        try {
            const cred = await (navigator.credentials as any).get({ password: true, mediation: "optional" });
            if (!cred) return;
            const emailVal = cred.id as string;
            const pwd      = (cred as any).password as string;
            if (!emailVal || !pwd) return;
            setEmail(emailVal);
            await performLogin(emailVal, pwd);
        } catch {
            // cancelled or not supported — silent
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

    const emailBorder = fieldErr === "email"    ? "border-red-400/70 bg-red-500/10"  : "border-white/20 focus:border-white/50 bg-white/10 focus:bg-white/15";
    const passBorder  = fieldErr === "password" ? "border-red-400/70 bg-red-500/10"  : "border-white/20 focus:border-white/50 bg-white/10 focus:bg-white/15";

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

    /* ── Studio selection step (same email+password matched >1 business) ── */
    if (step === "select-studio") return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-50 to-slate-100" dir={dir}>
            <div className="w-full max-w-sm">
                <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8">
                    <div className="flex flex-col items-center mb-6">
                        <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-2xl mb-4">🏢</div>
                        <h1 className="text-xl font-bold text-slate-900">
                            {locale.startsWith("en") ? "Choose a business" : "לאיזה עסק להיכנס?"}
                        </h1>
                        <p className="text-sm text-slate-500 mt-1 text-center leading-relaxed">
                            {locale.startsWith("en") ? "This account is linked to more than one business" : "החשבון הזה משויך ליותר מעסק אחד"}
                        </p>
                    </div>
                    {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 mb-4">{err}</div>}
                    <div className="space-y-2">
                        {studioOptions.map(s => (
                            <button
                                key={s.studio_id}
                                type="button"
                                disabled={loading}
                                onClick={() => onSelectStudio(s.studio_id)}
                                className="w-full text-right rounded-2xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 px-4 py-3 transition-colors disabled:opacity-50"
                            >
                                <div className="font-semibold text-slate-900">{s.studio_name || s.studio_id}</div>
                                <div className="text-xs text-slate-400 mt-0.5">{s.role}</div>
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => { setStep("credentials"); setErr(null); }}
                        className="w-full text-sm text-slate-400 hover:text-slate-600 transition-colors py-1 mt-4"
                    >
                        {t("login_2fa_back")}
                    </button>
                </div>
            </div>
        </div>
    );

    /* ── Main login ── */
    return (
        <div className="min-h-screen relative overflow-x-hidden overflow-y-auto" dir={dir}>

            <Suspense fallback={<div className="absolute inset-0 bg-gradient-to-b from-[#001a2e] to-[#003055]" />}>
                <OceanBackground />
            </Suspense>

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

            <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6">

                <div className="mb-8 flex flex-col items-center">
                    <div className="mb-3">
                        <img src="/logo.png" alt="BizControl" className="w-40 h-40 object-contain drop-shadow-2xl" />
                    </div>
                    <div className="font-black text-3xl text-white tracking-tight drop-shadow-lg">BizControl</div>
                    <div className="text-sm text-blue-200/80 mt-1">ניהול העסק שלך, בפשטות</div>
                </div>

                <div className="w-full max-w-sm">
                    <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8">
                        <div className="mb-6">
                            <h1 className="text-xl font-bold text-white">{t("login_title")}</h1>
                            <p className="text-sm text-blue-200/70 mt-0.5">{t("login_subtitle")}</p>
                        </div>

                        <form onSubmit={onSubmit} className="space-y-4" autoComplete="on">
                            <div>
                                <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">{t("login_email")}</label>
                                <input
                                    name="email"
                                    className={`w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none text-left text-white placeholder-white/30 transition-all ${emailBorder}`}
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
                                <PasswordInput
                                    name="password"
                                    iconClassName="text-white/70 hover:text-white"
                                    className={`w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none text-left text-white placeholder-white/30 transition-all ${passBorder}`}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    autoComplete="current-password"
                                    dir="ltr"
                                    placeholder="••••••••"
                                />
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

                            {supportsBiometric && (
                                <button
                                    type="button"
                                    onClick={loginWithBiometrics}
                                    disabled={loading}
                                    className="w-full rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white/80 py-2.5 text-sm font-medium disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
                                    </svg>
                                    {locale.startsWith("en") ? "Use Face ID / Fingerprint" : "התחבר עם Face ID / טביעת אצבע"}
                                </button>
                            )}

                            <div className="text-center pt-1 flex items-center justify-center gap-3">
                                <a href="/forgot-password" className="text-xs text-blue-200/50 hover:text-blue-200/80 transition-colors">
                                    {locale.startsWith("en") ? "Forgot password?" : "שכחתי סיסמה"}
                                </a>
                                <span className="text-blue-200/30 text-xs">•</span>
                                <a href={`${BIZFIND_URL}/for-business/register`} className="text-xs text-blue-200/50 hover:text-blue-200/80 transition-colors">
                                    {locale.startsWith("en") ? "No account? Sign up" : "אין לך חשבון? הירשם"}
                                </a>
                            </div>
                        </form>
                    </div>

                    <p className="text-center text-xs text-blue-200/40 mt-4">
                        BizControl © {new Date().getFullYear()}
                    </p>
                </div>

            </div>
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
