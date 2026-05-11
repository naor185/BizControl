"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

export default function ForgotPasswordPage() {
    const [studioSlug, setStudioSlug] = useState("");
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setLoading(true);
        try {
            await apiFetch("/api/auth/forgot-password", {
                method: "POST",
                auth: false,
                body: JSON.stringify({ studio_slug: studioSlug.trim(), email: email.trim() }),
            });
            setSent(true);
        } catch (e: any) {
            setErr(e?.message || "שגיאה בשליחה");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#0a0a1a] to-[#001a35]" dir="rtl">
            <div className="w-full max-w-sm">

                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-4xl shadow-2xl mb-3">
                        🔐
                    </div>
                    <div className="font-black text-2xl text-white tracking-tight">BizControl</div>
                    <div className="text-sm text-blue-200/60 mt-1">שחזור סיסמה</div>
                </div>

                <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8">
                    {sent ? (
                        <div className="text-center space-y-4">
                            <div className="text-4xl">📧</div>
                            <h2 className="text-lg font-bold text-white">נשלח!</h2>
                            <p className="text-sm text-blue-200/70 leading-relaxed">
                                אם האימייל קיים במערכת, קישור לאיפוס סיסמה נשלח אליו תוך דקה.
                            </p>
                            <p className="text-xs text-blue-200/40">בדוק גם את תיקיית הספאם.</p>
                            <Link
                                href="/login"
                                className="block mt-4 text-sm text-blue-300 hover:text-white transition-colors"
                            >
                                ← חזור להתחברות
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="mb-6">
                                <h1 className="text-xl font-bold text-white">שכחת סיסמה?</h1>
                                <p className="text-sm text-blue-200/60 mt-1">הזן את מזהה הסטודיו והאימייל שלך ונשלח קישור לאיפוס</p>
                            </div>

                            <form onSubmit={onSubmit} className="space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">מזהה סטודיו</label>
                                    <input
                                        type="text"
                                        value={studioSlug}
                                        onChange={e => setStudioSlug(e.target.value)}
                                        placeholder="my-studio"
                                        dir="ltr"
                                        required
                                        className="w-full rounded-xl border border-white/20 focus:border-white/50 px-3.5 py-2.5 text-sm outline-none bg-white/10 text-white placeholder-white/30 focus:bg-white/15 transition-all"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-semibold text-blue-100/80 block mb-1.5">אימייל</label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        dir="ltr"
                                        required
                                        className="w-full rounded-xl border border-white/20 focus:border-white/50 px-3.5 py-2.5 text-sm outline-none bg-white/10 text-white placeholder-white/30 focus:bg-white/15 transition-all"
                                    />
                                </div>

                                {err && (
                                    <div className="text-sm text-red-200 bg-red-500/20 border border-red-400/30 rounded-xl p-3">
                                        {err}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading || !studioSlug || !email}
                                    className="w-full rounded-2xl bg-white/20 hover:bg-white/30 border border-white/30 text-white py-3 font-semibold disabled:opacity-50 transition-all backdrop-blur shadow-lg"
                                >
                                    {loading ? "שולח..." : "שלח קישור לאיפוס"}
                                </button>

                                <Link
                                    href="/login"
                                    className="block text-center text-sm text-blue-200/50 hover:text-blue-200/80 transition-colors pt-1"
                                >
                                    ← חזור להתחברות
                                </Link>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
