"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

function SetPasswordContent() {
    const router = useRouter();
    const sp = useSearchParams();
    const token = sp.get("token") || "";

    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (password !== confirm) { setErr("הסיסמאות אינן תואמות"); return; }
        if (password.length < 6) { setErr("הסיסמה חייבת להכיל לפחות 6 תווים"); return; }
        setErr(null);
        setLoading(true);
        try {
            await apiFetch("/api/auth/set-password", {
                method: "POST",
                auth: false,
                body: JSON.stringify({ token, new_password: password }),
            });
            setSuccess(true);
            setTimeout(() => router.replace("/login"), 3000);
        } catch (e: any) {
            setErr(e?.message || "הקישור לא תקין או פג תוקף");
        } finally {
            setLoading(false);
        }
    }

    if (!token) {
        return (
            <div className="min-h-screen flex items-center justify-center" dir="rtl">
                <p className="text-red-600 text-lg">קישור לא תקין</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#f8fafc] to-[#e2e8f0]" dir="rtl">
            <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
                <h1 className="text-2xl font-bold text-center mb-2">הגדרת סיסמה חדשה</h1>
                <p className="text-center text-gray-500 mb-6">בחר סיסמה אישית לחשבון שלך</p>

                {success ? (
                    <div className="text-center">
                        <p className="text-green-600 font-semibold text-lg">✓ הסיסמה עודכנה בהצלחה!</p>
                        <p className="text-gray-500 mt-2">מועבר לדף ההתחברות...</p>
                    </div>
                ) : (
                    <form onSubmit={onSubmit} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium text-right">סיסמה חדשה</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    className="w-full border rounded-lg px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    placeholder="לפחות 6 תווים"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(v => !v)}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-sky-600 transition-colors"
                                    tabIndex={-1}
                                >
                                    {showPassword ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium text-right">אישור סיסמה</label>
                            <div className="relative">
                                <input
                                    type={showConfirm ? "text" : "password"}
                                    value={confirm}
                                    onChange={e => setConfirm(e.target.value)}
                                    className="w-full border rounded-lg px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    placeholder="הכנס שוב את הסיסמה"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm(v => !v)}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-sky-600 transition-colors"
                                    tabIndex={-1}
                                >
                                    {showConfirm ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>
                        {err && <p className="text-red-500 text-sm text-right">{err}</p>}
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-sky-600 text-white rounded-lg py-3 font-semibold hover:bg-sky-700 transition disabled:opacity-50"
                        >
                            {loading ? "מעדכן..." : "שמור סיסמה"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}

export default function SetPasswordPage() {
    return (
        <Suspense>
            <SetPasswordContent />
        </Suspense>
    );
}
