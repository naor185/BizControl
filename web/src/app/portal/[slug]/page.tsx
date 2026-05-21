"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";

type Step = "phone" | "otp";

export default function PortalLoginPage() {
    const { slug } = useParams<{ slug: string }>();
    const router = useRouter();

    const [step, setStep] = useState<Step>("phone");
    const [phone, setPhone] = useState("");
    const [otp, setOtp] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hint, setHint] = useState<string | null>(null);

    async function handleRequestOtp(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setHint(null);
        try {
            const res = await fetch(`${API_BASE}/portal/request-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ studio_slug: slug, phone: phone.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.detail || "שגיאה בשליחת הקוד");
                return;
            }
            setHint("קוד נשלח ל-WhatsApp ולמייל שלך — תקף ל-10 דקות");
            setStep("otp");
        } catch {
            setError("שגיאה בחיבור לשרת");
        } finally {
            setLoading(false);
        }
    }

    async function handleVerifyOtp(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/portal/verify-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ studio_slug: slug, phone: phone.trim(), code: otp.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.detail || "קוד שגוי");
                return;
            }
            sessionStorage.setItem(`portal_token_${slug}`, data.token);
            sessionStorage.setItem(`portal_client_name_${slug}`, data.client_name);
            router.push(`/portal/${slug}/dashboard`);
        } catch {
            setError("שגיאה בחיבור לשרת");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 flex items-center justify-center px-4" dir="rtl">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4 shadow-lg shadow-indigo-900/50">
                        <span className="text-3xl">💳</span>
                    </div>
                    <h1 className="text-2xl font-black text-white">כרטיס מועדון</h1>
                    <p className="text-sm text-slate-400 mt-1">הכנס לאזור האישי שלך</p>
                </div>

                <div className="bg-white/5 backdrop-blur-sm rounded-3xl border border-white/10 p-8 shadow-2xl">
                    {step === "phone" ? (
                        <form onSubmit={handleRequestOtp} className="space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-slate-300 mb-2">
                                    מספר טלפון
                                </label>
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    placeholder="050-0000000"
                                    dir="ltr"
                                    className="w-full bg-white/10 border border-white/20 text-white placeholder-slate-500 rounded-2xl px-4 py-3.5 text-base outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                                    required
                                />
                            </div>

                            {error && (
                                <div className="text-sm text-rose-400 bg-rose-950/50 rounded-xl px-4 py-3 border border-rose-800/50">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || !phone.trim()}
                                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/50"
                            >
                                {loading ? "שולח קוד..." : "שלח קוד אימות →"}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleVerifyOtp} className="space-y-5">
                            {hint && (
                                <div className="text-sm text-emerald-400 bg-emerald-950/50 rounded-xl px-4 py-3 border border-emerald-800/50 text-center">
                                    {hint}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-semibold text-slate-300 mb-2">
                                    קוד אימות (6 ספרות)
                                </label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]{6}"
                                    maxLength={6}
                                    value={otp}
                                    onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                                    placeholder="123456"
                                    dir="ltr"
                                    className="w-full bg-white/10 border border-white/20 text-white placeholder-slate-500 rounded-2xl px-4 py-3.5 text-2xl font-black text-center tracking-[0.4em] outline-none focus:ring-2 focus:ring-indigo-500 transition"
                                    autoFocus
                                    required
                                />
                            </div>

                            {error && (
                                <div className="text-sm text-rose-400 bg-rose-950/50 rounded-xl px-4 py-3 border border-rose-800/50">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || otp.length !== 6}
                                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl transition-all disabled:opacity-50 shadow-lg shadow-indigo-900/50"
                            >
                                {loading ? "מאמת..." : "כניסה לפורטל →"}
                            </button>

                            <button
                                type="button"
                                onClick={() => { setStep("phone"); setOtp(""); setError(null); }}
                                className="w-full text-sm text-slate-400 hover:text-white transition-colors"
                            >
                                ← חזור ושנה מספר טלפון
                            </button>
                        </form>
                    )}
                </div>

                <p className="text-center text-xs text-slate-600 mt-6">
                    נגישות מוגבלת לחברי מועדון בלבד
                </p>
            </div>
        </div>
    );
}
