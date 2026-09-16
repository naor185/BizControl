"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

type Lang = "he" | "en";
type Method = "email" | "phone";
type PhoneStep = "request" | "verify";

const T: Record<string, Record<Lang, string>> = {
    title:          { he: "שכחת סיסמה?",                       en: "Forgot Password?" },
    subtitleEmail:  { he: "הזן את האימייל שלך ונשלח לך קישור לאיפוס", en: "Enter your email and we'll send a reset link" },
    subtitlePhone:  { he: "הזן את האימייל שלך ונשלח קוד אימות בוואטסאפ לטלפון הרשום", en: "Enter your email and we'll WhatsApp a code to your phone on file" },
    tabEmail:       { he: "אימייל",                              en: "Email" },
    tabPhone:       { he: "וואטסאפ",                             en: "WhatsApp" },
    emailLabel:     { he: "אימייל",                              en: "Email" },
    codeLabel:      { he: "קוד אימות",                           en: "Verification code" },
    sendLink:       { he: "שלח קישור לאיפוס",                    en: "Send Reset Link" },
    sendCode:       { he: "שלח קוד בוואטסאפ",                    en: "Send WhatsApp Code" },
    verify:         { he: "אמת קוד",                             en: "Verify Code" },
    sending:        { he: "שולח...",                             en: "Sending..." },
    verifying:      { he: "מאמת...",                             en: "Verifying..." },
    sentTitle:      { he: "נשלח!",                                en: "Sent!" },
    sentBodyEmail:  { he: "קישור לאיפוס סיסמה נשלח לאימייל שלך.", en: "A password reset link has been sent to your email." },
    spamNote:       { he: "בדוק גם את תיקיית הספאם.",             en: "Check your spam folder too." },
    codeSentNote:   { he: "אם קיים טלפון רשום לחשבון הזה, נשלח אליו קוד בוואטסאפ. הקוד תקף ל-10 דקות.", en: "If a phone is on file for this account, a WhatsApp code was sent. It's valid for 10 minutes." },
    resend:         { he: "לא קיבלת? שלח קוד חדש",                en: "Didn't get it? Send a new code" },
    changeEmail:    { he: "← אימייל אחר",                        en: "← Different email" },
    back:           { he: "← חזור להתחברות",                     en: "← Back to login" },
    network:        { he: "לא ניתן להתחבר לשרת",                 en: "Cannot connect to server" },
    invalidCode:    { he: "קוד שגוי או פג תוקף",                  en: "Invalid or expired code" },
    defaultErr:     { he: "שגיאה בשליחה",                        en: "Error sending" },
};

export default function ForgotPasswordPage() {
    const [method, setMethod] = useState<Method>("email");
    const [phoneStep, setPhoneStep] = useState<PhoneStep>("request");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [lang, setLang] = useState<Lang>("he");

    useEffect(() => {
        if (typeof navigator !== "undefined") {
            setLang(navigator.language.startsWith("en") ? "en" : "he");
        }
    }, []);

    const dir = lang === "he" ? "rtl" : "ltr";
    const t = (key: keyof typeof T) => T[key][lang];

    function friendlyError(msg: string): string {
        if (msg.includes("קוד שגוי") || msg.includes("Invalid or expired code")) return t("invalidCode");
        if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed")) return t("network");
        return msg || t("defaultErr");
    }

    function switchMethod(m: Method) {
        setMethod(m);
        setPhoneStep("request");
        setCode("");
        setErr(null);
        setSent(false);
    }

    function errMessage(e: unknown): string {
        return friendlyError(e instanceof Error ? e.message : String(e));
    }

    async function submitEmail(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setLoading(true);
        try {
            await apiFetch("/api/auth/forgot-password", {
                method: "POST",
                auth: false,
                body: JSON.stringify({ email: email.toLowerCase().trim() }),
            });
            setSent(true);
        } catch (e) {
            setErr(errMessage(e));
        } finally {
            setLoading(false);
        }
    }

    async function sendPhoneCode() {
        setErr(null);
        setLoading(true);
        try {
            await apiFetch("/api/auth/forgot-password/phone", {
                method: "POST",
                auth: false,
                body: JSON.stringify({ email: email.toLowerCase().trim() }),
            });
            setPhoneStep("verify");
        } catch (e) {
            setErr(errMessage(e));
        } finally {
            setLoading(false);
        }
    }

    async function requestPhoneCode(e: React.FormEvent) {
        e.preventDefault();
        await sendPhoneCode();
    }

    async function verifyPhoneCode(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setLoading(true);
        try {
            const { token } = await apiFetch<{ token: string }>("/api/auth/forgot-password/verify-phone", {
                method: "POST",
                auth: false,
                body: JSON.stringify({ email: email.toLowerCase().trim(), code: code.trim() }),
            });
            window.location.href = `/set-password?token=${encodeURIComponent(token)}`;
        } catch (e) {
            setErr(errMessage(e));
        } finally {
            setLoading(false);
        }
    }

    const inputCls = "w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none text-white placeholder-white/30 transition-all border-white/20 focus:border-white/50 bg-white/10 focus:bg-white/15";

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#0a0a1a] to-[#001a35]" dir={dir}>
            <div className="w-full max-w-sm">

                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-4xl shadow-2xl mb-3">
                        🔐
                    </div>
                    <div className="font-black text-2xl text-white tracking-tight">BizControl</div>
                    <div className="text-sm text-blue-200/60 mt-1">
                        {lang === "he" ? "שחזור סיסמה" : "Password Recovery"}
                    </div>
                </div>

                <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8">
                    {sent ? (
                        <div className="text-center space-y-4">
                            <div className="text-4xl">📧</div>
                            <h2 className="text-lg font-bold text-white">{t("sentTitle")}</h2>
                            <p className="text-sm text-blue-200/70 leading-relaxed">{t("sentBodyEmail")}</p>
                            <p className="text-xs text-blue-200/40">{t("spamNote")}</p>
                            <Link href="/login" className="block mt-4 text-sm text-blue-300 hover:text-white transition-colors">
                                {t("back")}
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="mb-6">
                                <h1 className="text-xl font-bold text-white">{t("title")}</h1>
                                <p className="text-sm text-blue-200/60 mt-1">
                                    {method === "email" ? t("subtitleEmail") : t("subtitlePhone")}
                                </p>
                            </div>

                            {/* Method tabs */}
                            <div className="grid grid-cols-2 gap-1.5 mb-5 p-1 rounded-xl bg-white/5 border border-white/10">
                                <button
                                    type="button"
                                    onClick={() => switchMethod("email")}
                                    className={`rounded-lg py-2 text-sm font-semibold transition-all ${method === "email" ? "bg-white/20 text-white" : "text-blue-200/60 hover:text-blue-100"}`}
                                >
                                    {t("tabEmail")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => switchMethod("phone")}
                                    className={`rounded-lg py-2 text-sm font-semibold transition-all ${method === "phone" ? "bg-white/20 text-white" : "text-blue-200/60 hover:text-blue-100"}`}
                                >
                                    {t("tabPhone")}
                                </button>
                            </div>

                            {method === "email" && (
                                <form onSubmit={submitEmail} className="space-y-4">
                                    <div>
                                        <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">{t("emailLabel")}</label>
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                            placeholder="you@example.com"
                                            dir="ltr"
                                            required
                                            className={inputCls}
                                        />
                                    </div>

                                    {err && <ErrorBox text={err} />}

                                    <button
                                        type="submit"
                                        disabled={loading || !email}
                                        className="w-full rounded-2xl bg-white/20 hover:bg-white/30 border border-white/30 text-white py-3 font-semibold disabled:opacity-50 transition-all backdrop-blur shadow-lg"
                                    >
                                        {loading ? t("sending") : t("sendLink")}
                                    </button>

                                    <Link href="/login" className="block text-center text-sm text-blue-200/50 hover:text-blue-200/80 transition-colors pt-1">
                                        {t("back")}
                                    </Link>
                                </form>
                            )}

                            {method === "phone" && phoneStep === "request" && (
                                <form onSubmit={requestPhoneCode} className="space-y-4">
                                    <div>
                                        <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">{t("emailLabel")}</label>
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                            placeholder="you@example.com"
                                            dir="ltr"
                                            required
                                            className={inputCls}
                                        />
                                    </div>

                                    {err && <ErrorBox text={err} />}

                                    <button
                                        type="submit"
                                        disabled={loading || !email}
                                        className="w-full rounded-2xl bg-white/20 hover:bg-white/30 border border-white/30 text-white py-3 font-semibold disabled:opacity-50 transition-all backdrop-blur shadow-lg"
                                    >
                                        {loading ? t("sending") : t("sendCode")}
                                    </button>

                                    <Link href="/login" className="block text-center text-sm text-blue-200/50 hover:text-blue-200/80 transition-colors pt-1">
                                        {t("back")}
                                    </Link>
                                </form>
                            )}

                            {method === "phone" && phoneStep === "verify" && (
                                <form onSubmit={verifyPhoneCode} className="space-y-4">
                                    <p className="text-xs text-blue-200/60 leading-relaxed -mt-1">{t("codeSentNote")}</p>

                                    <div>
                                        <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">{t("codeLabel")}</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={code}
                                            onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                            placeholder="123456"
                                            dir="ltr"
                                            required
                                            autoFocus
                                            className={`${inputCls} text-center tracking-[0.4em] text-lg`}
                                        />
                                    </div>

                                    {err && <ErrorBox text={err} />}

                                    <button
                                        type="submit"
                                        disabled={loading || code.length < 6}
                                        className="w-full rounded-2xl bg-white/20 hover:bg-white/30 border border-white/30 text-white py-3 font-semibold disabled:opacity-50 transition-all backdrop-blur shadow-lg"
                                    >
                                        {loading ? t("verifying") : t("verify")}
                                    </button>

                                    <div className="flex items-center justify-between pt-1">
                                        <button
                                            type="button"
                                            onClick={() => { setPhoneStep("request"); setCode(""); setErr(null); }}
                                            className="text-sm text-blue-200/50 hover:text-blue-200/80 transition-colors"
                                        >
                                            {t("changeEmail")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setCode(""); void sendPhoneCode(); }}
                                            className="text-sm text-blue-200/50 hover:text-blue-200/80 transition-colors"
                                        >
                                            {t("resend")}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function ErrorBox({ text }: { text: string }) {
    return (
        <div className="text-sm text-red-200 bg-red-500/20 border border-red-400/30 rounded-xl p-3 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.997L13.732 4.997c-.77-1.33-2.694-1.33-3.464 0L3.34 16.003c-.77 1.33.192 2.997 1.732 2.997z" />
            </svg>
            {text}
        </div>
    );
}
