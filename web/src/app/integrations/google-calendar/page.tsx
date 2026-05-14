"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Step = 1 | 2 | 3 | 4;

const STEPS: { id: Step; label: string }[] = [
    { id: 1, label: "מפתחות Google" },
    { id: 2, label: "חיבור OAuth" },
    { id: 3, label: "שעות יומן" },
    { id: 4, label: "סיום" },
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
                    {i < STEPS.length - 1 && (
                        <div className={`h-0.5 flex-1 mx-3 mb-5 ${current > s.id ? "bg-blue-400" : "bg-slate-200"}`} />
                    )}
                </div>
            ))}
        </div>
    );
}

export default function GoogleCalendarWizardPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>(1);
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const [refreshToken, setRefreshToken] = useState<string | null>(null);
    const [startHour, setStartHour] = useState("08:00");
    const [endHour, setEndHour] = useState("23:00");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [savingHours, setSavingHours] = useState(false);

    useEffect(() => {
        apiFetch<Record<string, string>>("/api/studio/automation")
            .then(data => {
                setClientId(data.google_calendar_client_id || "");
                setClientSecret(data.google_calendar_client_secret || "");
                setRefreshToken(data.google_calendar_refresh_token || null);
                setStartHour(data.calendar_start_hour || "08:00");
                setEndHour(data.calendar_end_hour || "23:00");
                if (data.google_calendar_refresh_token) setStep(3);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const handleMessage = async (event: MessageEvent) => {
            if (event.data?.type === "GOOGLE_OAUTH_CODE") {
                const { code } = event.data;
                try {
                    const res = await apiFetch<{ status: string; message: string }>("/api/studio/google/exchange-token", {
                        method: "POST",
                        body: JSON.stringify({ code }),
                    });
                    if (res.status === "success") {
                        setRefreshToken("active");
                        setStep(3);
                    } else {
                        setErr(res.message);
                    }
                } catch (e: unknown) {
                    setErr((e as { message?: string })?.message || "שגיאה בהשלמת החיבור");
                }
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const handleSaveCredentials = async () => {
        if (!clientId || !clientSecret) { setErr("יש להזין Client ID ו-Client Secret"); return; }
        setSaving(true);
        setErr(null);
        try {
            await apiFetch("/api/studio/automation", {
                method: "PATCH",
                body: JSON.stringify({ google_calendar_client_id: clientId, google_calendar_client_secret: clientSecret }),
            });
            setStep(2);
        } catch (e: unknown) {
            setErr((e as { message?: string })?.message || "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    const handleGoogleConnect = async () => {
        if (!clientId || !clientSecret) { setErr("יש קודם לשמור את המפתחות"); return; }
        try {
            const res = await apiFetch<{ url: string }>("/api/studio/google/auth-url");
            const width = 500, height = 600;
            const left = window.screen.width / 2 - width / 2;
            const top = window.screen.height / 2 - height / 2;
            window.open(res.url, "GoogleOAuth", `width=${width},height=${height},top=${top},left=${left}`);
        } catch (e: unknown) {
            setErr((e as { message?: string })?.message || "שגיאה בפתיחת חיבור Google");
        }
    };

    const handleDisconnect = async () => {
        if (!confirm("האם לנתק את יומן Google?")) return;
        try {
            await apiFetch("/api/studio/google/disconnect", { method: "POST" });
            setRefreshToken(null);
            setStep(2);
        } catch (e: unknown) {
            setErr((e as { message?: string })?.message || "שגיאה בניתוק");
        }
    };

    const handleSaveHours = async () => {
        setSavingHours(true);
        setErr(null);
        try {
            await apiFetch("/api/studio/automation", {
                method: "PATCH",
                body: JSON.stringify({ calendar_start_hour: startHour, calendar_end_hour: endHour }),
            });
            setStep(4);
        } catch (e: unknown) {
            setErr((e as { message?: string })?.message || "שגיאה בשמירה");
        } finally {
            setSavingHours(false);
        }
    };

    return (
        <RequireAuth>
            <AppShell title="חיבור Google Calendar">
                <div className="max-w-2xl mx-auto pb-16" dir="rtl">

                    <button onClick={() => router.push("/automation")} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-6 transition-colors text-sm font-medium">
                        <span>→</span> חזרה להגדרות
                    </button>

                    <div className="mb-8">
                        <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center text-3xl mb-4">📅</div>
                        <h1 className="text-2xl font-bold text-slate-800">אשף חיבור Google Calendar</h1>
                        <p className="text-slate-500 mt-1">סנכרן תורים ופגישות ישירות ליומן Google שלך</p>
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
                                        <h2 className="text-xl font-bold text-slate-800 mb-1">יצירת מפתחות Google OAuth</h2>
                                        <p className="text-sm text-slate-500">יש ליצור פרויקט ב-Google Cloud ולהוציא מפתחות OAuth</p>
                                    </div>

                                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 space-y-3">
                                        <h4 className="font-bold text-blue-900 flex items-center gap-2"><span>🔧</span> מדריך יצירת מפתחות:</h4>
                                        <ol className="space-y-2 text-sm text-blue-800 list-decimal list-inside">
                                            <li>היכנס ל-<strong>console.cloud.google.com</strong></li>
                                            <li>צור פרויקט חדש (או בחר קיים)</li>
                                            <li>APIs &amp; Services → <strong>Enable APIs</strong> → חפש ואפשר <strong>Google Calendar API</strong></li>
                                            <li>APIs &amp; Services → <strong>Credentials</strong> → Create Credentials → <strong>OAuth 2.0 Client ID</strong></li>
                                            <li>סוג: <strong>Web Application</strong></li>
                                            <li>Authorized redirect URI: הוסף את הכתובת שלמטה</li>
                                        </ol>
                                        <div className="bg-white rounded-xl border border-blue-200 px-4 py-2">
                                            <p className="text-xs font-mono text-slate-600 break-all" dir="ltr">
                                                {process.env.NEXT_PUBLIC_API_BASE || "https://your-backend.railway.app"}/api/studio/google/callback
                                            </p>
                                        </div>
                                        <li className="text-sm text-blue-800 list-none">7. העתק את ה-<strong>Client ID</strong> וה-<strong>Client Secret</strong> לשדות למטה</li>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">Google Client ID</label>
                                            <input type="text" dir="ltr" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="123456789-xxxx.apps.googleusercontent.com" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">Google Client Secret</label>
                                            <input type="password" dir="ltr" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="GOCSPX-••••••••" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                    </div>

                                    {err && <p className="text-red-500 text-sm bg-red-50 border border-red-100 rounded-xl px-4 py-2">{err}</p>}

                                    <div className="flex justify-end pt-2">
                                        <button onClick={handleSaveCredentials} disabled={saving} className="bg-slate-900 hover:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-2">
                                            {saving ? (
                                                <>
                                                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                                    שומר...
                                                </>
                                            ) : (
                                                <>שמור ועבור לחיבור <span>←</span></>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-6">
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-800 mb-1">אישור גישה ל-Google Calendar</h2>
                                        <p className="text-sm text-slate-500">לחץ על הכפתור ואשר את הגישה בחשבון Google שלך</p>
                                    </div>

                                    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-6 text-center space-y-4">
                                        <div className="text-5xl">📅</div>
                                        <div>
                                            <p className="font-semibold text-slate-700 mb-1">יפתח חלון Google לאישור</p>
                                            <p className="text-sm text-slate-500">אחרי האישור, החלון ייסגר אוטומטית ותעבור לשלב הבא</p>
                                        </div>
                                        <button onClick={handleGoogleConnect} className="bg-white hover:bg-slate-50 border-2 border-slate-200 text-slate-700 px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-3 mx-auto shadow-sm">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src="https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png" alt="Google Calendar" className="w-6 h-6" />
                                            התחבר עם Google
                                        </button>
                                    </div>

                                    {err && <p className="text-red-500 text-sm bg-red-50 border border-red-100 rounded-xl px-4 py-2">{err}</p>}

                                    <div className="flex justify-between pt-2">
                                        <button onClick={() => setStep(1)} className="text-slate-500 hover:text-slate-800 px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2">
                                            <span>→</span> חזרה
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h2 className="text-xl font-bold text-slate-800 mb-1">שעות פעילות היומן</h2>
                                            <p className="text-sm text-slate-500">הגדר את שעות העבודה שיוצגו ביומן</p>
                                        </div>
                                        <div className="flex items-center gap-2 bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full font-bold text-sm">
                                            <span>✓</span> מחובר לגוגל
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">שעת פתיחה</label>
                                            <input type="time" value={startHour} onChange={e => setStartHour(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" dir="ltr" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-sm font-semibold text-slate-700">שעת סגירה</label>
                                            <input type="time" value={endHour} onChange={e => setEndHour(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" dir="ltr" />
                                        </div>
                                    </div>

                                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                                        <p className="text-sm text-blue-700">תורים שנוצרים במערכת ייסנכרנו אוטומטית ליומן Google שלך בטווח שעות זה</p>
                                    </div>

                                    {err && <p className="text-red-500 text-sm bg-red-50 border border-red-100 rounded-xl px-4 py-2">{err}</p>}

                                    <div className="flex justify-between items-center pt-2">
                                        <button onClick={handleDisconnect} className="text-red-400 hover:text-red-600 text-sm font-medium transition-colors px-4 py-2">
                                            נתק חיבור Google
                                        </button>
                                        <button onClick={handleSaveHours} disabled={savingHours} className="bg-slate-900 hover:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-2">
                                            {savingHours ? (
                                                <>
                                                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                                    שומר...
                                                </>
                                            ) : (
                                                <>שמור וסיים <span>←</span></>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 4 && (
                                <div className="text-center py-8 space-y-6">
                                    <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center text-4xl mx-auto">✅</div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-slate-800 mb-2">Google Calendar מחובר!</h2>
                                        <p className="text-slate-500">תורים יסונכרנו אוטומטית ליומן Google שלך</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 text-right">
                                        <h4 className="font-semibold text-slate-700 mb-3">מה קורה עכשיו:</h4>
                                        <ul className="space-y-2 text-sm text-slate-600">
                                            <li className="flex items-center gap-2"><span className="text-blue-500">✓</span> תורים חדשים מופיעים ביומן Google שלך אוטומטית</li>
                                            <li className="flex items-center gap-2"><span className="text-blue-500">✓</span> ביטולים ושינויים מתעדכנים בזמן אמת</li>
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
