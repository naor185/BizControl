"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

type Lang = "he" | "en";
type FieldErr = "slug" | "email" | null;

const FP_TEXT: Record<string, Record<Lang, string>> = {
    studio_not_found: { he: "מזהה הסטודיו לא קיים במערכת", en: "Studio not found" },
    email_not_found:  { he: "האימייל לא רשום במערכת",      en: "Email not registered" },
    network:          { he: "לא ניתן להתחבר לשרת",          en: "Cannot connect to server" },
    default_err:      { he: "שגיאה בשליחה",                  en: "Error sending" },
};
const FP_FIELD: Record<string, FieldErr> = {
    studio_not_found: "slug",
    email_not_found:  "email",
};

export default function ForgotPasswordPage() {
    const [studioSlug, setStudioSlug] = useState("");
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [fieldErr, setFieldErr] = useState<FieldErr>(null);
    const [lang, setLang] = useState<Lang>("he");

    useEffect(() => {
        if (typeof navigator !== "undefined") {
            setLang(navigator.language.startsWith("en") ? "en" : "he");
        }
    }, []);

    const dir = lang === "he" ? "rtl" : "ltr";

    function parseFPErr(msg: string): { text: string; field: FieldErr } {
        const l = lang;
        for (const [code, field] of Object.entries(FP_FIELD)) {
            if (msg.includes(code)) return { text: FP_TEXT[code][l], field };
        }
        if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed"))
            return { text: FP_TEXT.network[l], field: null };
        return { text: msg || FP_TEXT.default_err[l], field: null };
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setFieldErr(null);
        setLoading(true);
        try {
            await apiFetch("/api/auth/forgot-password", {
                method: "POST",
                auth: false,
                body: JSON.stringify({
                    studio_slug: studioSlug.toLowerCase().trim(),
                    email: email.toLowerCase().trim(),
                }),
            });
            setSent(true);
        } catch (e: any) {
            const msg = String(e?.message || "");
            const { text, field } = parseFPErr(msg);
            setErr(text);
            setFieldErr(field);
        } finally {
            setLoading(false);
        }
    }

    const slugBorder  = fieldErr === "slug"  ? "border-red-400/70 bg-red-500/10" : "border-white/20 focus:border-white/50 bg-white/10 focus:bg-white/15";
    const emailBorder = fieldErr === "email" ? "border-red-400/70 bg-red-500/10" : "border-white/20 focus:border-white/50 bg-white/10 focus:bg-white/15";

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
                            <h2 className="text-lg font-bold text-white">
                                {lang === "he" ? "נשלח!" : "Sent!"}
                            </h2>
                            <p className="text-sm text-blue-200/70 leading-relaxed">
                                {lang === "he"
                                    ? "קישור לאיפוס סיסמה נשלח לאימייל שלך."
                                    : "A password reset link has been sent to your email."}
                            </p>
                            <p className="text-xs text-blue-200/40">
                                {lang === "he" ? "בדוק גם את תיקיית הספאם." : "Check your spam folder too."}
                            </p>
                            <Link
                                href="/login"
                                className="block mt-4 text-sm text-blue-300 hover:text-white transition-colors"
                            >
                                {lang === "he" ? "← חזור להתחברות" : "← Back to login"}
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="mb-6">
                                <h1 className="text-xl font-bold text-white">
                                    {lang === "he" ? "שכחת סיסמה?" : "Forgot Password?"}
                                </h1>
                                <p className="text-sm text-blue-200/60 mt-1">
                                    {lang === "he"
                                        ? "הזן את מזהה הסטודיו והאימייל שלך"
                                        : "Enter your studio ID and email"}
                                </p>
                            </div>

                            <form onSubmit={onSubmit} className="space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">
                                        {lang === "he" ? "מזהה סטודיו" : "Studio ID"}
                                    </label>
                                    <input
                                        type="text"
                                        value={studioSlug}
                                        onChange={e => setStudioSlug(e.target.value)}
                                        placeholder="my-studio"
                                        dir="ltr"
                                        required
                                        className={`w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none text-white placeholder-white/30 transition-all ${slugBorder}`}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">
                                        {lang === "he" ? "אימייל" : "Email"}
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        dir="ltr"
                                        required
                                        className={`w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none text-white placeholder-white/30 transition-all ${emailBorder}`}
                                    />
                                </div>

                                {err && (
                                    <div className="text-sm text-red-200 bg-red-500/20 border border-red-400/30 rounded-xl p-3 flex items-center gap-2">
                                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.997L13.732 4.997c-.77-1.33-2.694-1.33-3.464 0L3.34 16.003c-.77 1.33.192 2.997 1.732 2.997z" />
                                        </svg>
                                        {err}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading || !studioSlug || !email}
                                    className="w-full rounded-2xl bg-white/20 hover:bg-white/30 border border-white/30 text-white py-3 font-semibold disabled:opacity-50 transition-all backdrop-blur shadow-lg"
                                >
                                    {loading
                                        ? (lang === "he" ? "שולח..." : "Sending...")
                                        : (lang === "he" ? "שלח קישור לאיפוס" : "Send Reset Link")}
                                </button>

                                <Link
                                    href="/login"
                                    className="block text-center text-sm text-blue-200/50 hover:text-blue-200/80 transition-colors pt-1"
                                >
                                    {lang === "he" ? "← חזור להתחברות" : "← Back to login"}
                                </Link>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
