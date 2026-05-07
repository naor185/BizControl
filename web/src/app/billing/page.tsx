"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type BillingStatus = {
    plan: string;
    is_active: boolean;
    plan_expires_at: string | null;
    stripe_customer_id: string | null;
    has_active_subscription: boolean;
};

const PLANS = [
    {
        key: "starter",
        name: "Starter",
        price: "₪199",
        features: ["עד 2 אמנים", "יומן + לקוחות", "תשלומים", "דוחות בסיסיים"],
    },
    {
        key: "pro",
        name: "Pro",
        price: "₪349",
        features: ["עד 5 אמנים", "כל פיצ׳רים של Starter", "AI הודעות", "אנליטיקה מלאה", "תזכורות אוטומטיות"],
    },
    {
        key: "studio",
        name: "Studio",
        price: "₪499",
        features: ["אמנים ללא הגבלה", "כל פיצ׳רים של Pro", "דף הזמנה עצמית", "ייצוא Excel", "תמיכה מועדפת"],
    },
];

const PLAN_LABELS: Record<string, string> = {
    free: "חינם",
    starter: "Starter",
    pro: "Pro",
    studio: "Studio",
};

function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("he-IL");
}

export default function BillingPage() {
    const [status, setStatus] = useState<BillingStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [redirecting, setRedirecting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<BillingStatus>("/billing/status")
            .then(setStatus)
            .catch(() => setError("לא ניתן לטעון פרטי מנוי"))
            .finally(() => setLoading(false));
    }, []);

    async function handlePlan(plan: string) {
        setRedirecting(plan);
        setError(null);
        try {
            const { url } = await apiFetch<{ url: string }>("/billing/checkout", {
                method: "POST",
                body: JSON.stringify({ plan }),
            });
            window.location.href = url;
        } catch (e) {
            setError(e instanceof Error ? e.message : "שגיאה בחיבור לתשלום");
        } finally {
            setRedirecting(null);
        }
    }

    async function handlePortal() {
        setRedirecting("portal");
        setError(null);
        try {
            const { url } = await apiFetch<{ url: string }>("/billing/portal", { method: "POST" });
            window.location.href = url;
        } catch (e) {
            setError(e instanceof Error ? e.message : "שגיאה בחיבור לשרת");
        } finally {
            setRedirecting(null);
        }
    }

    return (
        <RequireAuth>
            <AppShell title="מנוי ותשלום">
                <div className="max-w-4xl mx-auto px-4 py-8" dir="rtl">
                    <h1 className="text-2xl font-bold mb-2">מנוי ותשלום</h1>
                    <p className="text-gray-500 mb-8">בחר תכנית שמתאימה לסטודיו שלך</p>

                    {/* Current plan banner */}
                    {!loading && status && (
                        <div className="bg-gray-50 border rounded-xl p-4 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <span className="text-sm text-gray-500">תכנית נוכחית: </span>
                                <span className="font-semibold">{PLAN_LABELS[status.plan] ?? status.plan}</span>
                                {status.plan_expires_at && (
                                    <span className="text-sm text-gray-400 mr-3">
                                        · בתוקף עד {fmtDate(status.plan_expires_at)}
                                    </span>
                                )}
                            </div>
                            {status.has_active_subscription && (
                                <button
                                    onClick={handlePortal}
                                    disabled={redirecting === "portal"}
                                    className="text-sm underline text-gray-600 hover:text-black disabled:opacity-50"
                                >
                                    {redirecting === "portal" ? "מעבר..." : "נהל מנוי / ביטול"}
                                </button>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">{error}</div>
                    )}

                    {/* Plan cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                        {PLANS.map((plan) => {
                            const isCurrent = status?.plan === plan.key;
                            const isPopular = plan.key === "pro";
                            return (
                                <div
                                    key={plan.key}
                                    className={`relative rounded-2xl border-2 p-6 flex flex-col ${
                                        isPopular
                                            ? "border-black shadow-lg"
                                            : "border-gray-200"
                                    }`}
                                >
                                    {isPopular && (
                                        <span className="absolute -top-3 right-4 bg-black text-white text-xs px-3 py-1 rounded-full">
                                            הכי פופולרי
                                        </span>
                                    )}
                                    <div className="mb-4">
                                        <p className="font-bold text-lg">{plan.name}</p>
                                        <p className="text-3xl font-extrabold mt-1">
                                            {plan.price}
                                            <span className="text-sm font-normal text-gray-500"> / חודש</span>
                                        </p>
                                    </div>
                                    <ul className="space-y-2 mb-6 flex-1">
                                        {plan.features.map((f) => (
                                            <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                                                <span className="mt-0.5 text-green-600">✓</span>
                                                {f}
                                            </li>
                                        ))}
                                    </ul>
                                    <button
                                        onClick={() => handlePlan(plan.key)}
                                        disabled={!!redirecting || isCurrent}
                                        className={`w-full py-2.5 rounded-xl font-semibold text-sm transition ${
                                            isCurrent
                                                ? "bg-gray-100 text-gray-400 cursor-default"
                                                : isPopular
                                                ? "bg-black text-white hover:bg-gray-800"
                                                : "border border-black text-black hover:bg-gray-50"
                                        } disabled:opacity-50`}
                                    >
                                        {redirecting === plan.key
                                            ? "מעבר לתשלום..."
                                            : isCurrent
                                            ? "תכנית נוכחית"
                                            : status?.has_active_subscription
                                            ? "שדרג / שנה תכנית"
                                            : "התחל עכשיו"}
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <p className="text-center text-xs text-gray-400 mt-8">
                        תשלומים מאובטחים דרך Stripe · ניתן לבטל בכל עת
                    </p>
                </div>
            </AppShell>
        </RequireAuth>
    );
}
