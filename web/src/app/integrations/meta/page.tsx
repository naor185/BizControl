"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Step = 1 | 2 | 3;

const STEPS = [
    { id: 1 as Step, label: "פרטי חיבור" },
    { id: 2 as Step, label: "Webhook" },
    { id: 3 as Step, label: "סיום" },
];

function Stepper({ current }: { current: Step }) {
    return (
        <div className="flex items-center mb-8" dir="rtl">
            {STEPS.map((s, i) => (
                <div key={s.id} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${current > s.id ? "bg-blue-500 text-white" : current === s.id ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-400"}`}>
                            {current > s.id ? "✓" : s.id}
                        </div>
                        <span className={`text-xs mt-1.5 whitespace-nowrap ${current === s.id ? "text-slate-800 font-semibold" : "text-slate-400"}`}>{s.label}</span>
                    </div>
                    {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 mx-3 mb-5 ${current > s.id ? "bg-blue-400" : "bg-slate-200"}`} />}
                </div>
            ))}
        </div>
    );
}

export default function MetaWizardPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>(1);
    const [pageId, setPageId] = useState("");
    const [igAccountId, setIgAccountId] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [showToken, setShowToken] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const domain = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_API_BASE || window.location.origin) : "";
    const webhookUrl = `${domain}/api/webhook/meta`;
    const verifyToken = "bizcontrol_verify";

    useEffect(() => {
        apiFetch<Record<string, string>>("/api/studio/automation")
            .then(data => {
                setPageId(data.facebook_page_id || "");
                setIgAccountId(data.instagram_account_id || "");
                setAccessToken(data.meta_page_access_token || "");
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const copy = (text: string, key: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(key);
            setTimeout(() => setCopied(null), 2000);
        });
    };

    const handleSave = async () => {
        setSaving(true);
        setErr(null);
        try {
            await apiFetch("/api/studio/automation", {
                method: "PATCH",
                body: JSON.stringify({
                    facebook_page_id: pageId || null,
                    instagram_account_id: igAccountId || null,
                    meta_page_access_token: accessToken || null,
                }),
            });
            setStep(2);
        } catch (e: unknown) {
            setErr((e as { message?: string })?.message || "שגיאה בשמירה");
        } finally { setSaving(false); }
    };

    const EyeIcon = ({ open }: { open: boolean }) => open ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
        </svg>
    ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
    );

    return (
        <RequireAuth>
            <AppShell title="חיבור Meta (Instagram & Facebook)">
                <div className="max-w-2xl mx-auto pb-16" dir="rtl">
                    <button onClick={() => router.push("/automation")} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-6 transition-colors text-sm font-medium">
                        <span>→</span> חזרה להגדרות
                    </button>

                    <div className="mb-8">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center text-3xl mb-4">📱</div>
                        <h1 className="text-2xl font-bold text-slate-800">אשף חיבור Meta</h1>
                        <p className="text-slate-500 mt-1">קבל לידים אוטומטית מ-Instagram DMs, Facebook Messenger ו-Lead Ads</p>
                    </div>

                    <Stepper current={step} />

                    {loading ? (
                        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-600" /></div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-8">

                            {step === 1 && (
                                <div className="space-y-6">
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-800 mb-1">פרטי חיבור Meta</h2>
                                        <p className="text-sm text-slate-500">הזן את פרטי הדף והחשבון שלך</p>
                                    </div>

                                    {/* Guide */}
                                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 space-y-2">
                                        <h4 className="font-bold text-blue-900 flex items-center gap-2">📋 איך מתחילים:</h4>
                                        <ol className="space-y-1.5 text-sm text-blue-800 list-decimal list-inside">
                                            <li>היכנס ל-<strong>developers.facebook.com</strong></li>
                                            <li>צור App חדש → Business → הוסף WhatsApp + Instagram + Messenger</li>
                                            <li>תחת Settings → Basic העתק את <strong>App ID</strong></li>
                                            <li>צור <strong>System User Token</strong> עם הרשאות: <code className="text-xs bg-blue-100 px-1 rounded">pages_read_engagement, instagram_basic, leads_retrieval</code></li>
                                            <li>מצא את ה-<strong>Page ID</strong> — בדף הפייסבוק → About</li>
                                            <li>מצא את ה-<strong>Instagram Account ID</strong> — ב-Graph API Explorer</li>
                                        </ol>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">Facebook Page ID</label>
                                            <input type="text" dir="ltr" value={pageId} onChange={e => setPageId(e.target.value)} placeholder="123456789012345" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-400" />
                                            <p className="text-xs text-slate-400">נמצא בדף הפייסבוק → About → Page Transparency</p>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">Instagram Account ID</label>
                                            <input type="text" dir="ltr" value={igAccountId} onChange={e => setIgAccountId(e.target.value)} placeholder="987654321098765" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-pink-400" />
                                            <p className="text-xs text-slate-400">ניתן למצוא דרך Graph API Explorer עם token</p>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">Access Token (System User)</label>
                                            <div className="relative">
                                                <input type={showToken ? "text" : "password"} dir="ltr" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAAxxxxxxxx..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-400" />
                                                <button type="button" onClick={() => setShowToken(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" tabIndex={-1}>
                                                    <EyeIcon open={showToken} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {err && <p className="text-red-500 text-sm bg-red-50 border border-red-100 rounded-xl px-4 py-2">{err}</p>}

                                    <div className="flex justify-end pt-2">
                                        <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-700 text-white px-8 py-3 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-2">
                                            {saving ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />שומר...</> : <>שמור ועבור לשלב הבא ←</>}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-6">
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-800 mb-1">הגדרת Webhook</h2>
                                        <p className="text-sm text-slate-500">חבר את Meta לשרת BizControl כדי לקבל לידים בזמן אמת</p>
                                    </div>

                                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-4">
                                        <h4 className="font-bold text-blue-900">ב-Meta for Developers → App → Webhooks:</h4>

                                        <div className="space-y-3">
                                            <div>
                                                <p className="text-xs font-bold text-slate-500 mb-1">Callback URL</p>
                                                <div className="flex items-center gap-2 bg-white rounded-xl border border-blue-200 px-3 py-2">
                                                    <code className="flex-1 text-xs font-mono text-slate-700 break-all" dir="ltr">{webhookUrl}</code>
                                                    <button type="button" onClick={() => copy(webhookUrl, "url")} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">
                                                        {copied === "url" ? "✓ הועתק" : "העתק"}
                                                    </button>
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-xs font-bold text-slate-500 mb-1">Verify Token</p>
                                                <div className="flex items-center gap-2 bg-white rounded-xl border border-blue-200 px-3 py-2">
                                                    <code className="flex-1 text-xs font-mono text-slate-700" dir="ltr">{verifyToken}</code>
                                                    <button type="button" onClick={() => copy(verifyToken, "token")} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">
                                                        {copied === "token" ? "✓ הועתק" : "העתק"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-white rounded-xl border border-blue-100 p-3">
                                            <p className="text-xs font-bold text-slate-600 mb-2">Subscribe לאירועים הבאים:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {["messages", "messaging_postbacks", "leadgen", "feed"].map(e => (
                                                    <span key={e} className="text-[11px] font-mono bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">{e}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-between pt-2">
                                        <button onClick={() => setStep(1)} className="text-slate-500 hover:text-slate-800 px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2">
                                            <span>→</span> חזרה
                                        </button>
                                        <button onClick={() => setStep(3)} className="bg-sky-600 hover:bg-sky-700 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2">
                                            הגדרתי את ה-Webhook ←
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div className="text-center py-8 space-y-6">
                                    <div className="w-20 h-20 bg-gradient-to-br from-purple-100 to-blue-100 rounded-full flex items-center justify-center text-4xl mx-auto">✅</div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-slate-800 mb-2">Meta מחובר!</h2>
                                        <p className="text-slate-500">המערכת תקבל לידים אוטומטית מ-Instagram ו-Facebook</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 text-right space-y-2">
                                        <p className="text-sm text-slate-600 flex items-center gap-2"><span className="text-emerald-500">✓</span> הודעות DM באינסטגרם → ליד אוטומטי</p>
                                        <p className="text-sm text-slate-600 flex items-center gap-2"><span className="text-emerald-500">✓</span> הודעות Messenger בפייסבוק → ליד אוטומטי</p>
                                        <p className="text-sm text-slate-600 flex items-center gap-2"><span className="text-emerald-500">✓</span> טופס Lead Ads → ליד מיידי עם כל הפרטים</p>
                                    </div>
                                    <button onClick={() => router.push("/leads")} className="bg-sky-600 hover:bg-sky-700 text-white px-10 py-3 rounded-xl font-bold transition-all">
                                        עבור לאינבוקס לידים →
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
