"use client";
import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

interface WaStatus {
    connected: boolean;
    status: string;
    instance_id: string | null;
    phone_number: string | null;
    managed: boolean;
    last_connected_at: string | null;
    messages_this_month: number;
}

// Test send only — no credentials editing
export default function WhatsAppPage() {
    const [status, setStatus] = useState<WaStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [testPhone, setTestPhone] = useState("");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

    useEffect(() => {
        apiFetch<WaStatus>("/api/whatsapp/status")
            .then(s => setStatus(s))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const handleTest = async () => {
        if (!testPhone.trim()) return;
        setTesting(true); setTestResult(null);
        try {
            await apiFetch("/api/studio/automation/test-whatsapp", {
                method: "POST",
                body: JSON.stringify({ phone: testPhone.trim() }),
            });
            setTestResult({ ok: true, msg: "✅ ההודעה נשלחה בהצלחה!" });
        } catch (e: unknown) {
            setTestResult({ ok: false, msg: (e as Error).message || "שגיאה בשליחה" });
        } finally { setTesting(false); }
    };

    const isConnected = status?.connected ?? false;
    const phone = status?.phone_number?.replace(/^972/, "0") ?? null;

    return (
        <RequireAuth>
            <AppShell title="💬 WhatsApp">
                <div className="max-w-xl mx-auto pb-16 space-y-5 pt-4" dir="rtl">

                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500" />
                        </div>
                    ) : (
                        <>
                            {/* Status card */}
                            <div className={`rounded-2xl border p-6 ${isConnected ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl ${isConnected ? "bg-emerald-100" : "bg-rose-100"}`}>
                                        💬
                                    </div>
                                    <div>
                                        <div className={`font-bold text-lg ${isConnected ? "text-emerald-800" : "text-rose-800"}`}>
                                            {isConnected ? "WhatsApp מחובר ✅" : "WhatsApp לא מחובר"}
                                        </div>
                                        {isConnected && phone && (
                                            <div className="text-emerald-700 text-sm mt-0.5 font-mono" dir="ltr">{phone}</div>
                                        )}
                                        {isConnected && (
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                                <span className="text-xs text-emerald-600 font-semibold">פעיל — הודעות נשלחות</span>
                                            </div>
                                        )}
                                        {!isConnected && (
                                            <div className="text-rose-600 text-sm mt-1">פנה למנהל המערכת לחיבור WhatsApp</div>
                                        )}
                                    </div>
                                </div>

                                {isConnected && (
                                    <div className="mt-4 grid grid-cols-2 gap-3">
                                        <div className="bg-white/60 rounded-xl p-3">
                                            <div className="text-xs text-slate-400 mb-0.5">הודעות החודש</div>
                                            <div className="font-bold text-slate-800">{status?.messages_this_month?.toLocaleString() ?? "0"}</div>
                                        </div>
                                        <div className="bg-white/60 rounded-xl p-3">
                                            <div className="text-xs text-slate-400 mb-0.5">חיבור אחרון</div>
                                            <div className="font-bold text-slate-800 text-sm">
                                                {status?.last_connected_at
                                                    ? new Date(status.last_connected_at).toLocaleDateString("he-IL")
                                                    : "—"}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Source info */}
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm text-slate-600">
                                {status?.instance_id ? (
                                    <div className="flex items-start gap-2">
                                        <span className="text-emerald-500 mt-0.5">✓</span>
                                        <div>
                                            <span className="font-semibold text-slate-700">WhatsApp ייעודי לעסק זה</span>
                                            <div className="text-slate-400 text-xs mt-0.5 font-mono" dir="ltr">Instance: {status.instance_id}</div>
                                            <div className="text-slate-500 text-xs mt-0.5">הודעות יוצאות מהמספר שלך</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-start gap-2">
                                        <span className="text-blue-400 mt-0.5">ℹ️</span>
                                        <div>
                                            <span className="font-semibold text-slate-700">הודעות דרך BizControl</span>
                                            <div className="text-slate-500 text-xs mt-0.5">הודעות יוצאות מהמספר המרכזי של הפלטפורמה</div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Test send — only when connected */}
                            {isConnected && (
                                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                                    <h3 className="font-bold text-slate-800 mb-3">🧪 בדיקת שליחה</h3>
                                    <div className="flex gap-2">
                                        <input value={testPhone} onChange={e => setTestPhone(e.target.value)} type="tel"
                                            placeholder="050-0000000" dir="ltr"
                                            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400" />
                                        <button type="button" onClick={handleTest} disabled={testing || !testPhone.trim()}
                                            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors">
                                            {testing ? "שולח..." : "שלח"}
                                        </button>
                                    </div>
                                    {testResult && (
                                        <p className={`text-sm mt-2 font-medium ${testResult.ok ? "text-emerald-600" : "text-rose-600"}`}>
                                            {testResult.msg}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Admin note */}
                            <div className="text-center text-xs text-slate-400 pt-2">
                                לשינוי הגדרות WhatsApp — פנה למנהל המערכת
                            </div>
                        </>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
