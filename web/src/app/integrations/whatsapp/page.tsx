"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Step = 1 | 2 | 3;

const STEPS: { id: Step; label: string }[] = [
    { id: 1, label: "ספק ופרטים" },
    { id: 2, label: "Webhook" },
    { id: 3, label: "סיום" },
];

function Stepper({ current }: { current: Step }) {
    return (
        <div className="flex items-center mb-8" dir="rtl">
            {STEPS.map((s, i) => (
                <div key={s.id} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${current > s.id ? "bg-emerald-500 text-white" : current === s.id ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-400"}`}>
                            {current > s.id ? "✓" : s.id}
                        </div>
                        <span className={`text-xs mt-1.5 whitespace-nowrap ${current === s.id ? "text-slate-800 font-semibold" : "text-slate-400"}`}>{s.label}</span>
                    </div>
                    {i < STEPS.length - 1 && (
                        <div className={`h-0.5 flex-1 mx-3 mb-5 ${current > s.id ? "bg-emerald-400" : "bg-slate-200"}`} />
                    )}
                </div>
            ))}
        </div>
    );
}

function WebhookBox({ provider, instanceId }: { provider: string; instanceId: string }) {
    const [copied, setCopied] = useState<string | null>(null);
    const domain = process.env.NEXT_PUBLIC_API_BASE || "";

    const copy = (text: string, key: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(key);
            setTimeout(() => setCopied(null), 2000);
        });
    };

    if (provider === "green_api") {
        const url = `${domain}/api/webhook/green/${instanceId || "{instance_id}"}`;
        return (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
                <h4 className="font-bold text-emerald-900">כתובת Webhook להגדרה ב-Green API</h4>
                <p className="text-sm text-emerald-700">ב-Instance שלך → Settings → Webhooks, הכנס את הכתובת הבאה:</p>
                <div className="flex items-center gap-2 bg-white rounded-xl border border-emerald-200 px-3 py-2">
                    <code className="flex-1 text-xs font-mono text-slate-700 break-all" dir="ltr">{url}</code>
                    <button type="button" onClick={() => copy(url, "url")} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">
                        {copied === "url" ? "✓ הועתק" : "העתק"}
                    </button>
                </div>
            </div>
        );
    }

    const webhookUrl = `${domain}/api/webhook/meta`;
    const verifyToken = "bizcontrol_verify";
    return (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-3">
            <h4 className="font-bold text-blue-900">הגדרת Webhook ב-Meta Developer Portal</h4>
            <p className="text-sm text-blue-700">Meta for Developers → WhatsApp → Configuration → Webhook:</p>
            <div className="space-y-2">
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
        </div>
    );
}

export default function WhatsAppWizardPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>(1);
    const [provider, setProvider] = useState<"green_api" | "meta">("green_api");
    const [apiKey, setApiKey] = useState("");
    const [phoneId, setPhoneId] = useState("");
    const [instanceId, setInstanceId] = useState("");
    const [showApiKey, setShowApiKey] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [testPhone, setTestPhone] = useState("");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

    useEffect(() => {
        apiFetch<Record<string, string>>("/api/studio/automation")
            .then(data => {
                setProvider((data.whatsapp_provider || "green_api") as "green_api" | "meta");
                setApiKey(data.whatsapp_api_key || "");
                setPhoneId(data.whatsapp_phone_id || "");
                setInstanceId(data.whatsapp_instance_id || "");
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const handleTestSend = async () => {
        if (!testPhone.trim()) return;
        setTesting(true);
        setTestResult(null);
        try {
            await apiFetch("/api/studio/automation/test-whatsapp", {
                method: "POST",
                body: JSON.stringify({ phone: testPhone.trim() }),
            });
            setTestResult({ ok: true, msg: "ההודעה נשלחה! בדוק את הוואטסאפ שלך." });
        } catch (e: unknown) {
            setTestResult({ ok: false, msg: (e as { message?: string })?.message || "שגיאה בשליחה" });
        } finally {
            setTesting(false);
        }
    };

    const handleSave = async () => {
        if (!apiKey) { setErr("יש להזין API Token"); return; }
        if (provider === "meta" && !phoneId) { setErr("יש להזין Phone Number ID"); return; }
        if (provider === "green_api" && !instanceId) { setErr("יש להזין Instance ID"); return; }

        setSaving(true);
        setErr(null);
        try {
            await apiFetch("/api/studio/automation", {
                method: "PATCH",
                body: JSON.stringify({
                    whatsapp_provider: provider,
                    whatsapp_api_key: apiKey,
                    whatsapp_phone_id: phoneId,
                    whatsapp_instance_id: instanceId,
                }),
            });
            setStep(2);
        } catch (e: unknown) {
            setErr((e as { message?: string })?.message || "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <RequireAuth>
            <AppShell title="חיבור WhatsApp">
                <div className="max-w-2xl mx-auto pb-16" dir="rtl">

                    <button onClick={() => router.push("/automation")} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-6 transition-colors text-sm font-medium">
                        <span>→</span> חזרה להגדרות
                    </button>

                    <div className="mb-8">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center text-3xl mb-4">💬</div>
                        <h1 className="text-2xl font-bold text-slate-800">אשף חיבור WhatsApp</h1>
                        <p className="text-slate-500 mt-1">שלח הודעות אוטומטיות ותזכורות ללקוחות שלך דרך WhatsApp</p>
                    </div>

                    <Stepper current={step} />

                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-900" />
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-8">

                            {step === 1 && (
                                <div className="space-y-6">
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-800 mb-1">בחר ספק והזן פרטי חיבור</h2>
                                        <p className="text-sm text-slate-500">בחר את הספק המתאים לך ומלא את הפרטים</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        {[
                                            { value: "green_api", label: "Green API", desc: "השתמש במספר WhatsApp הקיים שלך (סריקת QR)", badge: "מומלץ" },
                                            { value: "meta", label: "Meta Cloud API", desc: "מספר נפרד — 1,000 הודעות חינם לחודש", badge: "חינמי" },
                                        ].map(p => (
                                            <label key={p.value} className={`cursor-pointer flex flex-col p-4 rounded-2xl border-2 transition-all ${provider === p.value ? (p.value === "green_api" ? "border-emerald-500 bg-emerald-50" : "border-blue-500 bg-blue-50") : "border-slate-200 hover:border-slate-300"}`}>
                                                <input type="radio" name="provider" value={p.value} checked={provider === p.value} onChange={() => setProvider(p.value as "green_api" | "meta")} className="sr-only" />
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-bold text-slate-800 text-sm">{p.label}</span>
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.value === "green_api" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>{p.badge}</span>
                                                </div>
                                                <span className="text-xs text-slate-500">{p.desc}</span>
                                            </label>
                                        ))}
                                    </div>

                                    {provider === "green_api" && (
                                        <div className="space-y-4">
                                            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5">
                                                <h4 className="font-bold text-emerald-900 mb-3">איך מתחילים:</h4>
                                                <ol className="space-y-1.5 text-sm text-emerald-800 list-decimal list-inside">
                                                    <li>היכנס ל-<strong>green-api.com</strong> → הרשם חינם</li>
                                                    <li>לחץ על <strong>Create Instance</strong></li>
                                                    <li>סרוק QR עם הוואטסאפ שלך</li>
                                                    <li>העתק את ה-<strong>Instance ID</strong> וה-<strong>API Token</strong></li>
                                                </ol>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1.5">
                                                    <label className="block text-sm font-semibold text-slate-700">Instance ID</label>
                                                    <input type="text" dir="ltr" value={instanceId} onChange={e => setInstanceId(e.target.value)} placeholder="1234567890" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500" />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="block text-sm font-semibold text-slate-700">API Token</label>
                                                    <div className="relative">
                                                        <input type={showApiKey ? "text" : "password"} dir="ltr" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="••••••••" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500" />
                                                        <button type="button" onClick={() => setShowApiKey(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors" tabIndex={-1}>
                                                            {showApiKey ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {provider === "meta" && (
                                        <div className="space-y-4">
                                            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
                                                <h4 className="font-bold text-blue-900 mb-3">איך מתחילים:</h4>
                                                <ol className="space-y-1.5 text-sm text-blue-800 list-decimal list-inside">
                                                    <li>היכנס ל-<strong>developers.facebook.com</strong></li>
                                                    <li>צור App חדש מסוג <strong>Business</strong></li>
                                                    <li>הוסף את מוצר <strong>WhatsApp</strong> לאפליקציה</li>
                                                    <li>העתק את ה-<strong>Phone Number ID</strong> וה-<strong>Permanent Access Token</strong></li>
                                                </ol>
                                                <p className="text-xs text-blue-600 mt-3">שים לב: נדרש מספר טלפון שאינו מחובר לאפליקציית WhatsApp</p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1.5">
                                                    <label className="block text-sm font-semibold text-slate-700">Phone Number ID</label>
                                                    <input type="text" dir="ltr" value={phoneId} onChange={e => setPhoneId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500" />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="block text-sm font-semibold text-slate-700">Access Token (Permanent)</label>
                                                    <div className="relative">
                                                        <input type={showApiKey ? "text" : "password"} dir="ltr" value={apiKey} onChange={e => setApiKey(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500" />
                                                        <button type="button" onClick={() => setShowApiKey(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors" tabIndex={-1}>
                                                            {showApiKey ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {err && <p className="text-red-500 text-sm bg-red-50 border border-red-100 rounded-xl px-4 py-2">{err}</p>}

                                    <div className="flex justify-end pt-2">
                                        <button onClick={handleSave} disabled={saving} className="bg-slate-900 hover:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-2">
                                            {saving ? (
                                                <>
                                                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                                    שומר...
                                                </>
                                            ) : (
                                                <>שמור ועבור לשלב הבא <span>←</span></>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-6">
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-800 mb-1">הגדרת Webhook לקבלת הודעות</h2>
                                        <p className="text-sm text-slate-500">כדי לקבל הודעות נכנסות מלקוחות, יש להגדיר Webhook בלוח הבקרה של הספק</p>
                                    </div>

                                    <WebhookBox provider={provider} instanceId={instanceId} />

                                    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5">
                                        <h4 className="font-semibold text-slate-700 mb-2">אחרי ההגדרה תוכל:</h4>
                                        <ul className="space-y-1.5 text-sm text-slate-600">
                                            <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> לראות הודעות נכנסות ב-Inbox של BizControl</li>
                                            <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> לענות ללקוחות ישירות מהממשק</li>
                                            <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> לשלוח תזכורות ואישורי תור אוטומטיים</li>
                                        </ul>
                                    </div>

                                    <div className="flex justify-between pt-2">
                                        <button onClick={() => setStep(1)} className="text-slate-500 hover:text-slate-800 px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2">
                                            <span>→</span> חזרה
                                        </button>
                                        <button onClick={() => setStep(3)} className="bg-slate-900 hover:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2">
                                            הגדרתי את ה-Webhook <span>←</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div className="py-6 space-y-6">
                                    <div className="text-center space-y-3">
                                        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-4xl mx-auto">✅</div>
                                        <h2 className="text-2xl font-bold text-slate-800">WhatsApp מחובר!</h2>
                                        <p className="text-slate-500">שלח הודעת בדיקה כדי לוודא שהכל עובד</p>
                                    </div>

                                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3" dir="rtl">
                                        <h4 className="font-bold text-slate-700">שלח הודעת בדיקה</h4>
                                        <div className="flex gap-2">
                                            <input
                                                type="tel"
                                                dir="ltr"
                                                placeholder="0501234567"
                                                value={testPhone}
                                                onChange={e => setTestPhone(e.target.value)}
                                                className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500"
                                            />
                                            <button
                                                onClick={handleTestSend}
                                                disabled={testing || !testPhone.trim()}
                                                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all"
                                            >
                                                {testing ? "שולח..." : "שלח"}
                                            </button>
                                        </div>
                                        {testResult && (
                                            <div className={`text-sm font-medium px-4 py-2 rounded-xl ${testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                                                {testResult.ok ? "✅ " : "❌ "}{testResult.msg}
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 text-right">
                                        <h4 className="font-semibold text-slate-700 mb-3">המשך מכאן:</h4>
                                        <ul className="space-y-2 text-sm text-slate-600">
                                            <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> התאם תבניות הודעות בלשונית <strong>הודעות אוטומטיות</strong></li>
                                            <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> בדוק הודעות נכנסות ב-<strong>Inbox</strong></li>
                                        </ul>
                                    </div>
                                    <div className="text-center">
                                        <button onClick={() => router.push("/automation")} className="bg-slate-900 hover:bg-slate-700 text-white px-10 py-3 rounded-xl font-bold transition-all">
                                            חזור להגדרות
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
