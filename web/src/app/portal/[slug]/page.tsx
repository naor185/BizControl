"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";

export default function PortalLoginPage() {
    const { slug } = useParams<{ slug: string }>();
    const router = useRouter();
    const [phone, setPhone] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/portal/auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ studio_slug: slug, phone: phone.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.detail || "שגיאה בכניסה");
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
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4" dir="rtl">
            <div className="w-full max-w-sm">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                    <div className="text-center mb-8">
                        <div className="text-4xl mb-3">🪪</div>
                        <h1 className="text-xl font-bold">אזור לקוחות</h1>
                        <p className="text-sm text-gray-500 mt-1">הכנס את מספר הטלפון שלך</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                מספר טלפון
                            </label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="050-0000000"
                                dir="ltr"
                                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-black/20 focus:border-black transition"
                                required
                            />
                        </div>

                        {error && (
                            <div className="bg-red-50 text-red-600 rounded-xl px-4 py-3 text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !phone.trim()}
                            className="w-full bg-black text-white py-3 rounded-xl font-semibold text-sm hover:bg-gray-800 disabled:opacity-40 transition"
                        >
                            {loading ? "מתחבר..." : "כניסה"}
                        </button>
                    </form>

                    <p className="text-center text-xs text-gray-400 mt-6">
                        הכניסה מאובטחת ומיועדת ללקוחות הסטודיו בלבד
                    </p>
                </div>
            </div>
        </div>
    );
}
