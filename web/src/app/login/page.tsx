"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { apiFetch, setToken } from "@/lib/api";

const LS_KEY = "biz_remember";

function LoginContent() {
    const router = useRouter();
    const sp = useSearchParams();
    const nextUrl = useMemo(() => sp.get("next") || "/dashboard", [sp]);

    const [studioSlug, setStudioSlug] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(false);
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

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
            const res = await apiFetch<{ access_token: string }>("/api/auth/login", {
                method: "POST",
                auth: false,
                body: JSON.stringify({ studio_slug: studioSlug, email, password }),
            });

            if (rememberMe) {
                localStorage.setItem(LS_KEY, JSON.stringify({ studioSlug, email, password }));
            } else {
                localStorage.removeItem(LS_KEY);
            }

            setToken(res.access_token);
            const me = await apiFetch<{ role: string }>("/api/auth/me", { method: "GET" });
            router.replace(me.role === "superadmin" ? "/admin" : nextUrl);
        } catch (e: any) {
            const msg = String(e?.message || "");
            const hebrew =
                msg.includes("Failed to fetch") || msg.includes("NetworkError")
                    ? "לא ניתן להתחבר לשרת."
                    : msg || "שגיאה בהתחברות";
            setErr(hebrew);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#f8fafc] to-[#e2e8f0]" dir="rtl">
            <div className="mb-6 flex flex-col items-center">
                <Image src="/logo.png" alt="BizControl" width={180} height={180} className="object-contain drop-shadow-md" />
            </div>

            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-8 border border-white/60 backdrop-blur-sm">
                <div className="flex flex-col items-center justify-center mb-6">
                    <h1 className="text-2xl font-bold text-slate-800">התחברות למערכת</h1>
                    <span className="text-sm mt-1 text-slate-500">הזן את פרטי הגישה שלך</span>
                </div>

                <form onSubmit={onSubmit} className="space-y-5">
                    <div>
                        <label className="text-sm font-medium">מזהה סטודיו (Slug)</label>
                        <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-left"
                            value={studioSlug}
                            onChange={(e) => setStudioSlug(e.target.value)}
                            autoComplete="organization"
                            dir="ltr"
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium">אימייל</label>
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
                        <label className="text-sm font-medium">סיסמה</label>
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
                        <label htmlFor="remember" className="text-sm text-slate-600 cursor-pointer">זכור אותי</label>
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
                        {loading ? "מתחבר..." : "התחבר"}
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
