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
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                className="border rounded-lg px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="לפחות 6 תווים"
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium text-right">אישור סיסמה</label>
                            <input
                                type="password"
                                value={confirm}
                                onChange={e => setConfirm(e.target.value)}
                                className="border rounded-lg px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="הכנס שוב את הסיסמה"
                                required
                            />
                        </div>
                        {err && <p className="text-red-500 text-sm text-right">{err}</p>}
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-[#1a1a2e] text-white rounded-lg py-3 font-semibold hover:bg-[#16213e] transition disabled:opacity-50"
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
