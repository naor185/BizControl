"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Step = 1 | 2 | 3;

const STEPS: { id: Step; label: string }[] = [
    { id: 1, label: "פרטי שרת" },
    { id: 2, label: "בדיקת חיבור" },
    { id: 3, label: "סיום" },
];

function Stepper({ current }: { current: Step }) {
    return (
        <div className="flex items-center mb-8" dir="rtl">
            {STEPS.map((s, i) => (
                <div key={s.id} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${current > s.id ? "bg-indigo-500 text-white" : current === s.id ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-400"}`}>
                            {current > s.id ? "✓" : s.id}
                        </div>
                        <span className={`text-xs mt-1.5 whitespace-nowrap ${current === s.id ? "text-slate-800 font-semibold" : "text-slate-400"}`}>{s.label}</span>
                    </div>
                    {i < STEPS.length - 1 && (
                        <div className={`h-0.5 flex-1 mx-3 mb-5 ${current > s.id ? "bg-indigo-400" : "bg-slate-200"}`} />
                    )}
                </div>
            ))}
        </div>
    );
}

export default function EmailWizardPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>(1);
    const [host, setHost] = useState("");
    const [port, setPort] = useState(587);
    const [user, setUser] = useState("");
    const [pass, setPass] = useState("");
    const [fromEmail, setFromEmail] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [testLoading, setTestLoading] = useState(false);
    const [testMsg, setTestMsg] = useState<{ type: "success" | "err"; text: string } | null>(null);

    useEffect(() => {
        apiFetch<Record<string, string | number>>("/api/studio/automation")
            .then(data => {
                setHost((data.smtp_host as string) || "");
                setPort((data.smtp_port as number) || 587);
                setUser((data.smtp_user as string) || "");
                setPass((data.smtp_pass as string) || "");
                setFromEmail((data.smtp_from_email as string) || "");
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        if (!host || !user || !pass || !fromEmail) { setErr("יש למלא את כל השדות"); return; }

        setSaving(true);
        setErr(null);
        try {
            await apiFetch("/api/studio/automation", {
                method: "PATCH",
                body: JSON.stringify({ smtp_host: host, smtp_port: port, smtp_user: user, smtp_pass: pass, smtp_from_email: fromEmail }),
            });
            setStep(2);
        } catch (e: unknown) {
            setErr((e as { message?: string })?.message || "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        const toEmail = prompt("לאיזה כתובת לשלוח מייל בדיקה?");
        if (!toEmail) return;
        setTestLoading(true);
        setTestMsg(null);
        try {
            await apiFetch("/api/studio/email/test", {
                method: "POST",
                body: JSON.stringify({ to_email: toEmail }),
            });
            setTestMsg({ type: "success", text: "מייל בדיקה נשלח בהצלחה! בדוק את תיבת הדואר שלך." });
        } catch (e: unknown) {
            setTestMsg({ type: "err", text: (e as { message?: string })?.message || "שגיאה בשליחה — בדוק שהפרטים נכונים" });
        } finally {
            setTestLoading(false);
        }
    };

    return (
        <RequireAuth>
            <AppShell title="חיבור אימייל">
                <div className="max-w-2xl mx-auto pb-16" dir="rtl">

                    <button onClick={() => router.push("/automation")} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-6 transition-colors text-sm font-medium">
                        <span>→</span> חזרה להגדרות
                    </button>

                    <div className="mb-8">
                        <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center text-3xl mb-4">✉️</div>
                        <h1 className="text-2xl font-bold text-slate-800">אשף חיבור אימייל</h1>
                        <p className="text-slate-500 mt-1">שלח אישורי תור, תזכורות ועדכונים ללקוחות שלך באימייל</p>
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
                                        <h2 className="text-xl font-bold text-slate-800 mb-1">פרטי שרת האימייל (SMTP)</h2>
                                        <p className="text-sm text-slate-500">הזן את פרטי שרת האימייל שדרכו יישלחו ההודעות</p>
                                    </div>

                                    {/* Gmail guide */}
                                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                                        <h4 className="font-bold text-amber-900 mb-3 flex items-center gap-2">
                                            <span>📧</span> שימוש עם Gmail (מומלץ)
                                        </h4>
                                        <ol className="space-y-1.5 text-sm text-amber-800 list-decimal list-inside">
                                            <li>היכנס לחשבון Google שלך → <strong>myaccount.google.com</strong></li>
                                            <li>אבטחה → כניסה ל-Google → <strong>אימות דו-שלבי</strong> (הפעל אם לא פעיל)</li>
                                            <li>חפש <strong>"App Passwords"</strong> (סיסמאות אפליקציה)</li>
                                            <li>צור סיסמת אפליקציה חדשה — העתק אותה לשדה הסיסמה למטה</li>
                                        </ol>
                                        <div className="mt-3 bg-white rounded-xl border border-amber-200 px-4 py-2">
                                            <p className="text-xs font-mono text-slate-600" dir="ltr">Host: smtp.gmail.com | Port: 587</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">SMTP Server</label>
                                            <input type="text" dir="ltr" value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.gmail.com" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">Port</label>
                                            <input type="number" dir="ltr" value={port} onChange={e => setPort(parseInt(e.target.value) || 587)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="block text-sm font-semibold text-slate-700">כתובת אימייל / שם משתמש</label>
                                        <input type="email" dir="ltr" value={user} onChange={e => setUser(e.target.value)} placeholder="you@gmail.com" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="block text-sm font-semibold text-slate-700">סיסמה / App Password</label>
                                        <div className="relative">
                                            <input type={showPass ? "text" : "password"} dir="ltr" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••••••••••" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                                            <button type="button" onClick={() => setShowPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors" tabIndex={-1}>
                                                {showPass ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="block text-sm font-semibold text-slate-700">כתובת שולח (From)</label>
                                        <input type="email" dir="ltr" value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="studio@gmail.com" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                                        <p className="text-xs text-slate-400">בדרך כלל זהה לכתובת האימייל שלמעלה</p>
                                    </div>

                                    {err && <p className="text-red-500 text-sm bg-red-50 border border-red-100 rounded-xl px-4 py-2">{err}</p>}

                                    <div className="flex justify-end pt-2">
                                        <button onClick={handleSave} disabled={saving} className="bg-slate-900 hover:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-2">
                                            {saving ? (
                                                <>
                                                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                                    שומר...
                                                </>
                                            ) : (
                                                <>שמור ועבור לבדיקה <span>←</span></>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-6">
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-800 mb-1">בדיקת החיבור</h2>
                                        <p className="text-sm text-slate-500">שלח מייל בדיקה כדי לוודא שהכל עובד כמו שצריך</p>
                                    </div>

                                    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-6 space-y-2">
                                        <p className="text-sm text-slate-600"><span className="font-semibold">שרת:</span> <span dir="ltr">{host}:{port}</span></p>
                                        <p className="text-sm text-slate-600"><span className="font-semibold">משתמש:</span> <span dir="ltr">{user}</span></p>
                                        <p className="text-sm text-slate-600"><span className="font-semibold">שולח:</span> <span dir="ltr">{fromEmail}</span></p>
                                    </div>

                                    {testMsg && (
                                        <div className={`p-4 rounded-xl text-sm font-medium ${testMsg.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                                            {testMsg.type === "success" ? "✅ " : "❌ "}{testMsg.text}
                                        </div>
                                    )}

                                    <button onClick={handleTest} disabled={testLoading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                                        {testLoading ? (
                                            <>
                                                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                                שולח...
                                            </>
                                        ) : (
                                            "שלח מייל בדיקה →"
                                        )}
                                    </button>

                                    <div className="flex justify-between pt-2">
                                        <button onClick={() => setStep(1)} className="text-slate-500 hover:text-slate-800 px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2">
                                            <span>→</span> חזרה
                                        </button>
                                        <button onClick={() => setStep(3)} className="bg-slate-900 hover:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2">
                                            סיים <span>←</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div className="text-center py-8 space-y-6">
                                    <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center text-4xl mx-auto">✅</div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-slate-800 mb-2">האימייל מחובר בהצלחה!</h2>
                                        <p className="text-slate-500">המערכת תשלח אימיילים אוטומטיים ללקוחות שלך</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 text-right">
                                        <h4 className="font-semibold text-slate-700 mb-3">המשך מכאן:</h4>
                                        <ul className="space-y-2 text-sm text-slate-600">
                                            <li className="flex items-center gap-2"><span className="text-indigo-500">✓</span> התאם תבניות אימייל בלשונית <strong>הודעות אוטומטיות</strong></li>
                                            <li className="flex items-center gap-2"><span className="text-indigo-500">✓</span> לקוחות יקבלו אישורי תור ותזכורות באימייל</li>
                                        </ul>
                                    </div>
                                    <button onClick={() => router.push("/automation")} className="bg-slate-900 hover:bg-slate-700 text-white px-10 py-3 rounded-xl font-bold transition-all">
                                        חזור להגדרות
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
