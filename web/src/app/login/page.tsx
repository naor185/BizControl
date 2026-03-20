"use client";

import { useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { apiFetch, setToken } from "@/lib/api";

function LoginContent() {
    const router = useRouter();
    const sp = useSearchParams();
    const nextUrl = useMemo(() => sp.get("next") || "/dashboard", [sp]);

    const [studioSlug, setStudioSlug] = useState("teststudio");
    const [email, setEmail] = useState("owner@teststudio.com");
    const [password, setPassword] = useState("password123");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setLoading(true);
        try {
            const res = await apiFetch<{ access_token: string }>("/api/auth/login", {
                method: "POST",
                auth: false,
                body: JSON.stringify({
                    studio_slug: studioSlug,
                    email,
                    password,
                }),
            });

            setToken(res.access_token);
            router.replace(nextUrl);
        } catch (e: any) {
            const msg = String(e?.message || "");
            const hebrew =
                msg.includes("Failed to fetch") || msg.includes("NetworkError")
                    ? "לא ניתן להתחבר לשרת. בדוק שה-API רץ על 8000."
                    : msg || "שגיאה בהתחברות";
            setErr(hebrew);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#f8fafc] to-[#e2e8f0]" dir="rtl">

            {/* Logo Section */}
            <div className="mb-6 flex flex-col items-center">
                <Image
                    src="/logo.png"
                    alt="BizControl Whale Logo"
                    width={180}
                    height={180}
                    className="object-contain drop-shadow-md"
                />
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
                        <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-left"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            type="password"
                            autoComplete="current-password"
                            dir="ltr"
                        />
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

                <div className="mt-4 text-xs text-gray-500 text-left" dir="ltr">
                    API: {process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000"}
                </div>
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
