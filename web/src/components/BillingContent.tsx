"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { isNativeApp } from "@/lib/platform";
import { IF_NOT_RENEWED } from "@/lib/planConsequences";

type BillingStatus = {
    plan: string;
    is_active: boolean;
    plan_expires_at: string | null;
    has_active_subscription: boolean;
};

type Plan = {
    key: string;
    label: string;
    price_ils: number;
    period_days: number;
    purchasable_now: boolean;
    modules: { name: string; limit: string | null }[];
};

type StudioInfo = { subscription_plan: string; plan_label: string; plan_expires_at: string | null };

const COLLAPSED_MODULES = 8;
const EXPIRY_WARNING_DAYS = 14;

function fmtDate(iso: string | null) {
    return iso ? new Date(iso).toLocaleDateString("he-IL") : "—";
}

function readBillingNotice(): string | null {
    try {
        return new URLSearchParams(window.location.search).get("billing");
    } catch {
        return null;
    }
}

// Subscription & billing: the current plan (with time left), what every plan we sell includes
// (read from the real plan/module tables), and the purchase / manage-subscription actions.
export default function BillingContent() {
    const [status, setStatus] = useState<BillingStatus | null>(null);
    const [studio, setStudio] = useState<StudioInfo | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [redirecting, setRedirecting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [notice] = useState(readBillingNotice);
    // Apple/Google require in-app digital purchases to go through their own payment systems unless the
    // app never offers purchasing itself — so inside the native shell there is no working purchase or
    // portal action, only text pointing at the website. Determined client-side only (starts false) to
    // avoid an SSR/hydration mismatch (this component only renders after RequireAuth on the client).
    const [isNative] = useState(() => isNativeApp());
    const [now] = useState(() => Date.now());

    useEffect(() => {
        Promise.all([
            apiFetch<BillingStatus>("/api/billing/status"),
            apiFetch<StudioInfo>("/api/auth/studio-info"),
            apiFetch<Plan[]>("/api/billing/plans"),
        ])
            .then(([s, info, p]) => { setStatus(s); setStudio(info); setPlans(p); })
            .catch(() => setError("לא ניתן לטעון את פרטי המנוי"))
            .finally(() => setLoading(false));
    }, []);

    async function go(path: string, key: string, body?: object) {
        setRedirecting(key);
        setError(null);
        try {
            const { url } = await apiFetch<{ url: string }>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
            window.location.href = url;
        } catch (e) {
            setError(e instanceof Error ? e.message : "שגיאה בחיבור לתשלום");
            setRedirecting(null);
        }
    }

    if (loading) return <div className="h-40 bg-slate-50 animate-pulse rounded-2xl" />;

    const isTrial = status?.plan === "trial";
    const days = status?.plan_expires_at ? Math.ceil((new Date(status.plan_expires_at).getTime() - now) / 86_400_000) : null;

    return (
        <div className="space-y-5" dir="rtl">
            {notice === "success" && (
                <div className="bg-emerald-50 text-emerald-700 rounded-xl px-4 py-3 text-sm">התשלום התקבל — המנוי מתעדכן ויופיע כאן בעוד רגע.</div>
            )}
            {notice === "canceled" && (
                <div className="bg-slate-100 text-slate-600 rounded-xl px-4 py-3 text-sm">הרכישה בוטלה. אפשר לנסות שוב בכל עת.</div>
            )}
            {error && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

            {/* Current plan */}
            {status && (
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <div className="text-xs text-slate-400 mb-0.5">המנוי שלך</div>
                        <div className="font-bold text-slate-800">{studio?.plan_label ?? status.plan}</div>
                        <div className="text-sm text-slate-500 mt-0.5">
                            {status.plan_expires_at ? (
                                days !== null && days < 0
                                    ? `פג תוקף ב-${fmtDate(status.plan_expires_at)}`
                                    : `${isTrial ? "תקופת הניסיון מסתיימת" : "בתוקף"} עד ${fmtDate(status.plan_expires_at)} · ${days === 0 ? "היום" : `נשארו ${days} ימים`}`
                            ) : "ללא תאריך תפוגה"}
                        </div>
                    </div>
                    {status.has_active_subscription && (
                        isNative ? (
                            <span className="text-sm text-slate-500">לניהול המנוי או ביטולו, בקרו ב-biz-control.com בדפדפן</span>
                        ) : (
                            <button
                                onClick={() => go("/api/billing/portal", "portal")}
                                disabled={redirecting === "portal"}
                                className="text-sm underline text-slate-600 hover:text-black disabled:opacity-50"
                            >
                                {redirecting === "portal" ? "מעבר..." : "נהל מנוי / ביטול"}
                            </button>
                        )
                    )}
                </div>
            )}

            {isTrial && (
                <p className="text-sm text-slate-600">
                    אתה בתקופת ניסיון. כדי להמשיך להשתמש במערכת אחריה, בחר מנוי מהרשימה למטה.
                </p>
            )}

            {/* Close to the end and not renewing by itself: say plainly what happens if it lapses */}
            {status && !status.has_active_subscription && days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 font-bold text-amber-900 text-sm mb-2">
                        <TriangleAlert className="h-4 w-4 shrink-0" />
                        אם המנוי לא יחודש עד {fmtDate(status.plan_expires_at)}
                    </div>
                    <ul className="list-disc list-inside space-y-1.5 text-sm text-amber-900/90 leading-relaxed marker:text-amber-400">
                        {IF_NOT_RENEWED.map(line => <li key={line}>{line}</li>)}
                    </ul>
                    <p className="text-sm text-amber-900 mt-3">
                        {isNative ? "לחידוש המנוי בקרו ב-biz-control.com בדפדפן" : "לחידוש: WhatsApp 052-8518805 או ncbilutattoo@gmail.com"}
                    </p>
                </div>
            )}

            {/* What every plan includes */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {plans.map(plan => {
                    const isCurrent = status?.plan === plan.key;
                    const open = !!expanded[plan.key];
                    const shown = open ? plan.modules : plan.modules.slice(0, COLLAPSED_MODULES);
                    return (
                        <div key={plan.key} className={`rounded-2xl border p-5 flex flex-col ${isCurrent ? "border-slate-900" : "border-slate-200"}`}>
                            <div className="mb-3">
                                <p className="font-bold text-slate-800">{plan.label}</p>
                                <p className="text-3xl font-extrabold mt-1 text-slate-900">
                                    ₪{plan.price_ils}
                                    <span className="text-sm font-normal text-slate-500"> / {plan.period_days === 30 || plan.period_days === 31 ? "חודש" : `${plan.period_days} ימים`}</span>
                                </p>
                            </div>
                            <ul className="space-y-1.5 mb-3 flex-1">
                                {shown.map(m => (
                                    <li key={m.name} className="flex items-start gap-2 text-sm text-slate-700">
                                        <Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                                        <span>{m.name}{m.limit ? <span className="text-slate-400"> · {m.limit}</span> : null}</span>
                                    </li>
                                ))}
                            </ul>
                            {plan.modules.length > COLLAPSED_MODULES && (
                                <button
                                    onClick={() => setExpanded(e => ({ ...e, [plan.key]: !open }))}
                                    className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4 w-fit"
                                >
                                    <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                                    {open ? "הצג פחות" : `הצג הכול (${plan.modules.length})`}
                                </button>
                            )}
                            {isNative && !isCurrent ? (
                                <div className="w-full py-2.5 rounded-xl text-sm text-center text-slate-500 bg-slate-50">
                                    להרשמה או שינוי מנוי, בקרו ב-biz-control.com בדפדפן
                                </div>
                            ) : isCurrent ? (
                                <div className="w-full py-2.5 rounded-xl text-sm text-center text-slate-400 bg-slate-100">המנוי הנוכחי</div>
                            ) : !plan.purchasable_now ? (
                                <div className="w-full py-2.5 rounded-xl text-sm text-center text-slate-400 bg-slate-100">הרכישה טרם הופעלה</div>
                            ) : (
                                <button
                                    onClick={() => go("/api/billing/checkout", plan.key, { plan: plan.key })}
                                    disabled={!!redirecting}
                                    className="w-full py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                                    style={{ background: "var(--primary)" }}
                                >
                                    {redirecting === plan.key ? "מעבר לתשלום..." : status?.has_active_subscription ? "שדרג / שנה מנוי" : "רכישת המנוי"}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <p className="text-center text-xs text-slate-400">תשלומים מאובטחים דרך Stripe · ניתן לבטל בכל עת</p>
        </div>
    );
}
