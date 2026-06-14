"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

interface StudioEmailSettings {
    reply_to_email?: string;
    business_signature?: string;
}

interface StudioStats {
    total: number;
    sent: number;
    failed: number;
    success_rate: number;
    by_template: { template_key: string; cnt: number }[];
}

interface Log {
    id: string;
    recipient_email: string;
    subject: string;
    template_key: string;
    status: string;
    sent_at: string;
    error_message?: string;
}

const TEMPLATE_LABELS: Record<string, string> = {
    appointment_confirmation: "אישור תור",
    appointment_reminder:     "תזכורת תור",
    appointment_cancelled:    "ביטול תור",
    invoice_created:          "קבלה / חשבונית",
    credit_note_created:      "זיכוי",
    birthday_coupon:          "קופון יום הולדת",
    password_reset:           "איפוס סיסמה",
    welcome_email:            "ברכת שלום",
    test_email:               "מייל בדיקה",
};

export default function StudioEmailSettingsPage() {
    const [tab, setTab] = useState<"settings" | "logs" | "stats">("settings");
    const [settings, setSettings] = useState<StudioEmailSettings>({});
    const [stats, setStats] = useState<StudioStats | null>(null);
    const [logs, setLogs] = useState<Log[]>([]);
    const [logsTotal, setLogsTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        apiFetch<StudioEmailSettings>("/api/email-center/studio")
            .then(s => setSettings(s))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (tab === "stats" && !stats) {
            apiFetch<StudioStats>("/api/email-center/studio/stats").then(setStats);
        }
        if (tab === "logs") {
            apiFetch<{ items: Log[]; total: number }>("/api/email-center/studio/logs?limit=50")
                .then(r => { setLogs(r.items); setLogsTotal(r.total); });
        }
    }, [tab]);

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch("/api/email-center/studio", {
                method: "PUT",
                body: JSON.stringify(settings),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppShell title="הגדרות מייל">
            {/* Tabs */}
            <div className="flex gap-1 px-4 border-b border-slate-100 mb-5">
                {[
                    { id: "settings", label: "⚙️ הגדרות" },
                    { id: "logs",     label: "📋 היסטוריה" },
                    { id: "stats",    label: "📊 סטטיסטיקות" },
                ].map(t => (
                    <button key={t.id} type="button" onClick={() => setTab(t.id as any)}
                        className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === t.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="px-4 max-w-lg space-y-5">

                {tab === "settings" && !loading && (
                    <>
                        {/* How it works */}
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-blue-800">
                            <div className="font-bold mb-1">איך זה עובד?</div>
                            <div className="text-xs leading-relaxed">
                                כל המיילים יוצאים מתשתית BizControl.<br />
                                הלקוח רואה את <strong>שם העסק שלך</strong> ויכול להשיב ישירות אל כתובת ה-Reply-To שלך.
                            </div>
                            <div className="mt-2 font-mono text-xs bg-white rounded-xl px-3 py-2 border border-blue-100">
                                <span className="text-slate-400">From:</span> {"{שם העסק}"} via BizControl<br />
                                <span className="text-slate-400">Reply-To:</span> {settings.reply_to_email || "כתובת שתגדיר"}
                            </div>
                        </div>

                        {/* Reply-To */}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1.5">
                                Reply-To Email
                            </label>
                            <p className="text-xs text-slate-400 mb-2">כתובת שהלקוח יראה ויוכל להשיב אליה</p>
                            <input
                                value={settings.reply_to_email || ""}
                                onChange={e => setSettings(p => ({ ...p, reply_to_email: e.target.value }))}
                                type="email" dir="ltr"
                                placeholder="studio@example.com"
                                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 font-mono"
                            />
                        </div>

                        {/* Signature */}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1.5">
                                חתימת עסק (אופציונלי)
                            </label>
                            <p className="text-xs text-slate-400 mb-2">תופיע בתחתית כל מייל שנשלח מהעסק שלך</p>
                            <textarea
                                value={settings.business_signature || ""}
                                onChange={e => setSettings(p => ({ ...p, business_signature: e.target.value }))}
                                rows={5}
                                placeholder={"בברכה,\nסטודיו הקעקועים של נועם\n\nטלפון: 050-0000000\nכתובת: הרצל 100 ראשון לציון"}
                                className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 resize-none"
                            />
                        </div>

                        <button type="button" onClick={save} disabled={saving}
                            className="w-full py-3 bg-slate-900 text-white rounded-2xl font-bold text-sm hover:bg-slate-700 transition disabled:opacity-60">
                            {saved ? "✓ נשמר!" : saving ? "שומר..." : "שמור הגדרות"}
                        </button>
                    </>
                )}

                {tab === "logs" && (
                    <div>
                        <p className="text-xs text-slate-400 mb-3">סה"כ {logsTotal} מיילים</p>
                        {logs.length === 0 ? (
                            <div className="text-center py-12 text-slate-400">
                                <div className="text-4xl mb-2">📭</div>
                                <div>אין מיילים שנשלחו עדיין</div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {logs.map(l => (
                                    <div key={l.id} className="bg-white rounded-xl border border-slate-100 p-3.5">
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <div className="text-xs font-mono text-slate-500">{l.recipient_email}</div>
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${l.status === "sent" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                                                {l.status === "sent" ? "✓ נשלח" : "✗ נכשל"}
                                            </span>
                                        </div>
                                        <div className="text-sm text-slate-800 font-medium truncate">{l.subject}</div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                                {TEMPLATE_LABELS[l.template_key] || l.template_key}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {new Date(l.sent_at).toLocaleString("he-IL")}
                                            </span>
                                        </div>
                                        {l.error_message && <div className="text-xs text-red-500 mt-1">{l.error_message}</div>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === "stats" && stats && (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { label: "סה\"כ מיילים", value: stats.total },
                                { label: "נשלחו בהצלחה", value: stats.sent, color: "text-emerald-700" },
                                { label: "נכשלו",         value: stats.failed, color: "text-red-600" },
                                { label: "אחוז הצלחה",   value: `${stats.success_rate}%`, color: "text-blue-700" },
                            ].map(k => (
                                <div key={k.label} className="bg-white rounded-2xl p-4 text-center border border-slate-100">
                                    <div className={`text-xl font-black ${k.color || "text-slate-800"}`}>{k.value}</div>
                                    <div className="text-xs text-slate-400">{k.label}</div>
                                </div>
                            ))}
                        </div>

                        <div className="bg-white rounded-2xl border border-slate-100 p-4">
                            <div className="font-bold text-sm text-slate-700 mb-3">לפי סוג מייל</div>
                            {stats.by_template.map(r => (
                                <div key={r.template_key} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0 text-sm">
                                    <span className="text-slate-700">{TEMPLATE_LABELS[r.template_key] || r.template_key}</span>
                                    <span className="font-bold text-slate-800">{r.cnt}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </AppShell>
    );
}
