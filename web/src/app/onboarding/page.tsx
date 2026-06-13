"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, API_BASE } from "@/lib/api";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

type PlanFeature = { key: string; label: string; enabled: boolean; limit: number | null };
type Plan = {
    key: string; label: string; price_ils: number; days: number;
    scope_bizcontrol: boolean; is_trial: boolean; features: PlanFeature[];
};
type StudioMe = {
    name: string; subscription_plan: string; plan_expires_at?: string;
    city?: string; description?: string; phone?: string;
};

const CATEGORIES = [
    "קעקועים", "ספרות", "קוסמטיקה ויופי", "פדיקור ומניקור", "עיצוב שיער",
    "מכון כושר", "עיסוי ורפלקסולוגיה", "פילאטיס ויוגה", "קליניקה / בריאות",
    "שיניים", "אחר",
];

const PLAN_ICONS: Record<string, string> = {
    trial: "🚀", bizfind_basic: "📍", bizfind_pro: "📍",
    starter: "⚡", pro: "⚡", studio: "⚡",
};

// ── Progress bar ──────────────────────────────────────────────────────────────

function Progress({ step, total }: { step: number; total: number }) {
    return (
        <div className="flex gap-1.5 justify-center mb-8">
            {Array.from({ length: total }, (_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
                    i < step ? "bg-violet-600 w-8" : i === step - 1 ? "bg-violet-600 w-8" : "bg-slate-200 w-4"
                }`} />
            ))}
        </div>
    );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [me, setMe] = useState<StudioMe | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [saving, setSaving] = useState(false);

    // Form state
    const [businessName, setBusinessName] = useState("");
    const [category, setCategory] = useState("");
    const [city, setCity] = useState("");
    const [address, setAddress] = useState("");
    const [phone, setPhone] = useState("");
    const [description, setDescription] = useState("");
    const [selectedPlan, setSelectedPlan] = useState<string>("trial");

    const TOTAL_STEPS = 3;

    useEffect(() => {
        const load = async () => {
            try {
                const [meData, plansData] = await Promise.all([
                    apiFetch<StudioMe>("/api/me"),
                    fetch(`${API_BASE}/api/marketplace/plans`).then(r => r.json()).catch(() => []),
                ]);
                setMe(meData);
                setBusinessName(meData.name || "");
                setPlans(plansData || []);
                // Pre-select current plan or trial
                setSelectedPlan(meData.subscription_plan || "trial");
            } catch {
                router.replace("/login");
            }
        };
        load();
    }, [router]);

    const saveProfile = async () => {
        setSaving(true);
        try {
            await apiFetch("/api/marketplace/studio/me", {
                method: "PATCH",
                body: JSON.stringify({
                    business_name: businessName.trim() || undefined,
                    category: category || undefined,
                    city: city.trim() || undefined,
                    address: address.trim() || undefined,
                    phone: phone.trim() || undefined,
                    description: description.trim() || undefined,
                }),
            });
        } catch { /* non-blocking */ }
        finally { setSaving(false); }
    };

    const next = async () => {
        if (step === 1) await saveProfile();
        setStep(s => s + 1);
    };

    const finish = async () => {
        await saveProfile();
        router.replace("/calendar");
    };

    const trialDaysLeft = (() => {
        if (!me?.plan_expires_at) return null;
        const diff = Math.ceil((new Date(me.plan_expires_at).getTime() - Date.now()) / 86_400_000);
        return diff > 0 ? diff : 0;
    })();

    const inputCls = "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white";
    const labelCls = "block text-sm font-semibold text-slate-600 mb-1.5";

    if (!me) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-violet-600 animate-spin" />
            </div>
        );
    }

    return (
        <div dir="rtl" className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex items-center justify-center p-4">
            <div className="w-full max-w-lg">

                {/* Logo */}
                <div className="text-center mb-8">
                    <Link href="/" className="inline-flex items-center gap-2 text-slate-800 no-underline">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white font-black text-lg">B</div>
                        <span className="font-black text-xl">BizControl</span>
                    </Link>
                    {trialDaysLeft !== null && (
                        <div className="mt-2 inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full">
                            🔬 {trialDaysLeft} ימי ניסיון נותרו
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8">
                    <Progress step={step} total={TOTAL_STEPS} />

                    {/* ── Step 1: Business Details ── */}
                    {step === 1 && (
                        <div>
                            <h1 className="text-2xl font-black text-slate-800 mb-1">ברוכים הבאים! 👋</h1>
                            <p className="text-slate-400 text-sm mb-6">בואו נגדיר את פרטי העסק שלכם. זה ייקח פחות מדקה.</p>

                            <div className="space-y-4">
                                <div>
                                    <label className={labelCls}>שם העסק *</label>
                                    <input className={inputCls} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="סטודיו נעמי" maxLength={120} />
                                </div>
                                <div>
                                    <label className={labelCls}>קטגוריה *</label>
                                    <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
                                        <option value="">בחרו קטגוריה</option>
                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelCls}>עיר *</label>
                                        <input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="תל אביב" />
                                    </div>
                                    <div>
                                        <label className={labelCls}>טלפון</label>
                                        <input className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} placeholder="050-000000" dir="ltr" />
                                    </div>
                                </div>
                                <div>
                                    <label className={labelCls}>כתובת</label>
                                    <input className={inputCls} value={address} onChange={e => setAddress(e.target.value)} placeholder="רחוב הרצל 5, קומה 2" />
                                </div>
                                <div>
                                    <label className={labelCls}>תיאור קצר (יוצג בפרופיל)</label>
                                    <textarea
                                        className={`${inputCls} resize-none`} rows={3}
                                        value={description} onChange={e => setDescription(e.target.value)}
                                        placeholder="ספרו ללקוחות מה מיוחד אצלכם..."
                                        maxLength={400}
                                    />
                                </div>
                            </div>

                            <button
                                onClick={next}
                                disabled={!businessName.trim() || !city.trim() || saving}
                                className="mt-6 w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-black py-3.5 rounded-2xl text-base disabled:opacity-40 transition-opacity shadow-lg shadow-violet-200"
                            >
                                {saving ? "שומר..." : "המשיכו ←"}
                            </button>
                        </div>
                    )}

                    {/* ── Step 2: Choose Plan ── */}
                    {step === 2 && (
                        <div>
                            <h1 className="text-2xl font-black text-slate-800 mb-1">בחרו מסלול</h1>
                            <p className="text-slate-400 text-sm mb-6">
                                {trialDaysLeft !== null
                                    ? `יש לכם עוד ${trialDaysLeft} ימי ניסיון. תוכלו לשדרג בכל שלב.`
                                    : "בחרו את המסלול המתאים לכם."}
                            </p>

                            <div className="space-y-2.5 max-h-96 overflow-y-auto pb-1">
                                {plans.map(plan => {
                                    const sel = selectedPlan === plan.key;
                                    const isBizControl = plan.scope_bizcontrol;
                                    return (
                                        <button
                                            key={plan.key}
                                            onClick={() => setSelectedPlan(plan.key)}
                                            className={`w-full rounded-2xl p-4 text-right border-2 transition-all ${
                                                sel
                                                    ? isBizControl ? "border-violet-600 bg-violet-50" : "border-sky-500 bg-sky-50"
                                                    : "border-slate-100 bg-white hover:border-slate-200"
                                            }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <span className="text-xl mt-0.5">{PLAN_ICONS[plan.key] || "📦"}</span>
                                                <div className="flex-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-bold text-slate-800 text-sm">
                                                            {plan.label}
                                                            {plan.is_trial && (
                                                                <span className="mr-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                                                                    {plan.days} ימים חינם
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className={`font-black text-sm ${isBizControl ? "text-violet-600" : "text-sky-600"}`}>
                                                            {plan.is_trial ? "חינם" : `₪${plan.price_ils}/חודש`}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-slate-400 mt-0.5">
                                                        {isBizControl ? "BizFind + BizControl" : "BizFind בלבד"}
                                                    </div>
                                                    {sel && plan.features.length > 0 && (
                                                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                                                            {plan.features.filter(f => f.enabled).slice(0, 6).map(f => (
                                                                <div key={f.key} className="text-xs text-slate-500 flex items-center gap-1">
                                                                    <span className={isBizControl ? "text-violet-400" : "text-sky-400"}>✓</span>
                                                                    {f.label}{f.limit ? ` (עד ${f.limit})` : ""}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                {sel && <span className={isBizControl ? "text-violet-600 font-bold" : "text-sky-500 font-bold"}>✓</span>}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex gap-3 mt-6">
                                <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-500 font-semibold text-sm hover:bg-slate-50">
                                    חזרה
                                </button>
                                <button onClick={() => setStep(3)} className="flex-2 flex-[2] bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-black py-3 rounded-2xl text-sm shadow-lg shadow-violet-200">
                                    המשיכו ←
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Step 3: Ready! ── */}
                    {step === 3 && (
                        <div className="text-center">
                            <div className="text-6xl mb-4">🎉</div>
                            <h1 className="text-2xl font-black text-slate-800 mb-2">הכל מוכן!</h1>
                            <p className="text-slate-400 text-sm mb-6">
                                <strong className="text-slate-700">{businessName}</strong> מוכן לפעולה.
                                {trialDaysLeft !== null && ` יש לכם ${trialDaysLeft} ימי ניסיון מלאים.`}
                            </p>

                            {/* Quick actions */}
                            <div className="grid grid-cols-2 gap-3 mb-6 text-right">
                                {[
                                    { icon: "📅", title: "יומן", desc: "נהלו תורים ומפגשים", href: "/calendar" },
                                    { icon: "👥", title: "לקוחות", desc: "CRM מלא", href: "/clients" },
                                    { icon: "💳", title: "תשלומים", desc: "קבלות ודוחות", href: "/payments" },
                                    { icon: "🔔", title: "אוטומציות", desc: "WhatsApp + תזכורות", href: "/automation" },
                                ].map(item => (
                                    <Link key={item.href} href={item.href} className="bg-slate-50 hover:bg-violet-50 border border-slate-100 hover:border-violet-200 rounded-2xl p-3.5 no-underline transition-colors block">
                                        <div className="text-2xl mb-1">{item.icon}</div>
                                        <div className="font-bold text-slate-800 text-sm">{item.title}</div>
                                        <div className="text-xs text-slate-400">{item.desc}</div>
                                    </Link>
                                ))}
                            </div>

                            <button
                                onClick={finish}
                                disabled={saving}
                                className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-black py-4 rounded-2xl text-base shadow-lg shadow-violet-200 disabled:opacity-40"
                            >
                                {saving ? "שומר..." : "פתח את היומן שלי ←"}
                            </button>

                            <p className="text-xs text-slate-400 mt-3">
                                ניתן תמיד לחזור להגדרות מתפריט ההגדרות
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
