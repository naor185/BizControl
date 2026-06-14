"use client";
import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────

interface SystemSettings {
    provider: string;
    api_key_masked?: string;
    domain: string;
    system_email: string;
    notification_email: string;
    support_email: string;
    reply_email_default: string;
    email_sending_enabled: boolean;
    marketing_emails_enabled: boolean;
    appointment_emails_enabled: boolean;
    invoice_emails_enabled: boolean;
    updated_at?: string;
}

interface Stats {
    total: number;
    sent: number;
    failed: number;
    success_rate: number;
    by_template: { template_key: string; cnt: number }[];
    by_studio: { name: string; cnt: number }[];
    by_month: { month: string; cnt: number }[];
}

interface Log {
    id: string;
    studio_name?: string;
    recipient_email: string;
    subject: string;
    template_key: string;
    status: string;
    sent_at: string;
    error_message?: string;
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function EmailCenterPage() {
    const [tab, setTab] = useState<"settings" | "logs" | "stats">("settings");
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [stats, setStats] = useState<Stats | null>(null);
    const [logs, setLogs] = useState<Log[]>([]);
    const [logsTotal, setLogsTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [testEmail, setTestEmail] = useState("");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<"ok" | "err" | null>(null);
    const [newApiKey, setNewApiKey] = useState("");
    const [showApiKey, setShowApiKey] = useState(false);
    const [form, setForm] = useState<Partial<SystemSettings>>({});

    const loadSettings = useCallback(async () => {
        setLoading(true);
        try {
            const s = await apiFetch<SystemSettings>("/api/email-center/system");
            setSettings(s);
            setForm({
                provider: s.provider,
                domain: s.domain,
                system_email: s.system_email,
                notification_email: s.notification_email,
                support_email: s.support_email,
                reply_email_default: s.reply_email_default,
                email_sending_enabled: s.email_sending_enabled,
                marketing_emails_enabled: s.marketing_emails_enabled,
                appointment_emails_enabled: s.appointment_emails_enabled,
                invoice_emails_enabled: s.invoice_emails_enabled,
            });
        } finally {
            setLoading(false);
        }
    }, []);

    const loadStats = useCallback(async () => {
        const s = await apiFetch<Stats>("/api/email-center/stats");
        setStats(s);
    }, []);

    const loadLogs = useCallback(async () => {
        const r = await apiFetch<{ items: Log[]; total: number }>("/api/email-center/logs?limit=50");
        setLogs(r.items);
        setLogsTotal(r.total);
    }, []);

    useEffect(() => { loadSettings(); }, [loadSettings]);
    useEffect(() => {
        if (tab === "stats" && !stats) loadStats();
        if (tab === "logs") loadLogs();
    }, [tab]);

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch("/api/email-center/system", {
                method: "PUT",
                body: JSON.stringify({ ...form, api_key: newApiKey || undefined }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            await loadSettings();
            setNewApiKey("");
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async () => {
        if (!testEmail) return;
        setTesting(true);
        setTestResult(null);
        try {
            await apiFetch("/api/email-center/test", {
                method: "POST",
                body: JSON.stringify({ to_email: testEmail }),
            });
            setTestResult("ok");
        } catch {
            setTestResult("err");
        } finally {
            setTesting(false);
        }
    };

    const set = (k: keyof SystemSettings, v: any) => setForm(p => ({ ...p, [k]: v }));

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center text-slate-400" dir="rtl">טוען...</div>
    );

    const PROVIDERS = [
        { value: "resend", label: "Resend", desc: "מומלץ — API פשוט, ביצועים גבוהים" },
        { value: "mailgun", label: "Mailgun", desc: "אמין, מתאים לנפחים גדולים" },
        { value: "ses", label: "Amazon SES", desc: "הכי זול, מורכב להגדרה" },
    ];

    return (
        <div dir="rtl" className="min-h-screen bg-slate-50 pb-20">
            {/* Header */}
            <div className="bg-white border-b border-slate-100 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
                    <a href="/admin" className="text-slate-400 hover:text-black text-xl">←</a>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900">Email Center</h1>
                        <p className="text-xs text-slate-400">תשתית מייל מרכזית — BizControl</p>
                    </div>
                    {settings && (
                        <span className={`mr-auto text-xs font-bold px-2.5 py-1 rounded-full ${settings.email_sending_enabled ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                            {settings.email_sending_enabled ? "✓ פעיל" : "✗ כבוי"}
                        </span>
                    )}
                </div>

                {/* Tabs */}
                <div className="max-w-4xl mx-auto px-4 flex gap-1 pb-0">
                    {[
                        { id: "settings", label: "⚙️ הגדרות" },
                        { id: "logs",     label: "📋 לוגים" },
                        { id: "stats",    label: "📊 סטטיסטיקות" },
                    ].map(t => (
                        <button key={t.id} type="button" onClick={() => setTab(t.id as any)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === t.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

                {/* ── SETTINGS TAB ── */}
                {tab === "settings" && (
                    <>
                        {/* Provider */}
                        <Section title="ספק שליחה" icon="🚀">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {PROVIDERS.map(p => (
                                    <button key={p.value} type="button" onClick={() => set("provider", p.value)}
                                        className={`p-4 rounded-2xl border-2 text-right transition-all ${form.provider === p.value ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}>
                                        <div className="font-bold text-slate-800">{p.label}</div>
                                        <div className="text-xs text-slate-400 mt-0.5">{p.desc}</div>
                                    </button>
                                ))}
                            </div>

                            <div className="mt-4">
                                <label className={lbl}>API Key</label>
                                {settings?.api_key_masked && !showApiKey ? (
                                    <div className="flex gap-2">
                                        <div className="flex-1 px-3 py-2.5 bg-slate-100 rounded-xl text-sm font-mono text-slate-500 border border-slate-200">
                                            {settings.api_key_masked}
                                        </div>
                                        <button type="button" onClick={() => setShowApiKey(true)} className="px-4 py-2 text-sm border border-slate-200 rounded-xl hover:bg-slate-50">
                                            החלף
                                        </button>
                                    </div>
                                ) : (
                                    <input value={newApiKey} onChange={e => setNewApiKey(e.target.value)}
                                        type="password"
                                        placeholder={`re_...  (${form.provider})`}
                                        className={inp} dir="ltr" />
                                )}
                            </div>

                            <div className="mt-3">
                                <label className={lbl}>Domain</label>
                                <input value={form.domain || ""} onChange={e => set("domain", e.target.value)}
                                    className={inp} dir="ltr" placeholder="biz-control.com" />
                            </div>
                        </Section>

                        {/* Email Addresses */}
                        <Section title="כתובות מייל" icon="📧">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {[
                                    { key: "system_email",         label: "System Email",        placeholder: "noreply@biz-control.com" },
                                    { key: "notification_email",   label: "Notification Email",   placeholder: "notifications@biz-control.com" },
                                    { key: "support_email",        label: "Support Email",        placeholder: "support@biz-control.com" },
                                    { key: "reply_email_default",  label: "Reply-To Default",     placeholder: "support@biz-control.com" },
                                ].map(f => (
                                    <div key={f.key}>
                                        <label className={lbl}>{f.label}</label>
                                        <input value={(form as any)[f.key] || ""} onChange={e => set(f.key as any, e.target.value)}
                                            className={inp} dir="ltr" placeholder={f.placeholder} type="email" />
                                    </div>
                                ))}
                            </div>
                            <div className="mt-3 p-3 bg-blue-50 rounded-xl text-xs text-blue-700 font-mono">
                                From: סטודיו X via BizControl &lt;{form.notification_email || "notifications@biz-control.com"}&gt;<br />
                                Reply-To: &lt;studio@example.com&gt;
                            </div>
                        </Section>

                        {/* Enable/Disable toggles */}
                        <Section title="הפעלה / כיבוי" icon="🔘">
                            <div className="space-y-3">
                                {[
                                    { key: "email_sending_enabled",      label: "שליחת מיילים כללית",      desc: "מתג ראשי — כיבוי מבטל הכל" },
                                    { key: "appointment_emails_enabled",  label: "מיילים לתורים",           desc: "אישורים, תזכורות, ביטולים" },
                                    { key: "invoice_emails_enabled",      label: "מיילים לחשבוניות",        desc: "קבלות, חשבוניות מס, זיכויים" },
                                    { key: "marketing_emails_enabled",    label: "מיילים שיווקיים",         desc: "ימי הולדת, קמפיינים, קופונים" },
                                ].map(t => (
                                    <div key={t.key} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                                        <div>
                                            <div className="font-semibold text-slate-800 text-sm">{t.label}</div>
                                            <div className="text-xs text-slate-400">{t.desc}</div>
                                        </div>
                                        <button type="button" onClick={() => set(t.key as any, !(form as any)[t.key])}
                                            className={`relative w-12 h-6 rounded-full transition-colors ${(form as any)[t.key] ? "bg-emerald-500" : "bg-slate-300"}`}>
                                            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${(form as any)[t.key] ? "right-1" : "left-1"}`} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* Test Send */}
                        <Section title="שליחת מייל בדיקה" icon="🧪">
                            <div className="flex gap-2">
                                <input value={testEmail} onChange={e => setTestEmail(e.target.value)}
                                    placeholder="email@example.com" type="email"
                                    className={`${inp} flex-1`} dir="ltr" />
                                <button type="button" onClick={sendTest} disabled={testing || !testEmail}
                                    className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-slate-700 transition">
                                    {testing ? "שולח..." : "שלח בדיקה"}
                                </button>
                            </div>
                            {testResult === "ok" && <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-2.5">✅ מייל הבדיקה נשלח בהצלחה!</div>}
                            {testResult === "err" && <div className="mt-2 text-sm text-red-700 bg-red-50 rounded-xl px-4 py-2.5">❌ שליחה נכשלה — בדוק מפתח API וספק</div>}
                        </Section>

                        {/* Save */}
                        <button type="button" onClick={save} disabled={saving}
                            className="w-full py-3.5 bg-slate-900 text-white rounded-2xl font-black text-base hover:bg-slate-700 transition disabled:opacity-60">
                            {saved ? "✓ נשמר בהצלחה!" : saving ? "שומר..." : "שמור הגדרות"}
                        </button>

                        {settings?.updated_at && (
                            <p className="text-center text-xs text-slate-400">
                                עודכן לאחרונה: {new Date(settings.updated_at).toLocaleString("he-IL")}
                            </p>
                        )}
                    </>
                )}

                {/* ── LOGS TAB ── */}
                {tab === "logs" && (
                    <Section title={`לוג שליחות (${logsTotal})`} icon="📋">
                        {logs.length === 0 ? (
                            <div className="text-center py-12 text-slate-400">
                                <div className="text-4xl mb-2">📭</div>
                                <div>אין מיילים שנשלחו עדיין</div>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100">
                                            <th className="pb-2 text-right text-xs font-semibold text-slate-400">תאריך</th>
                                            <th className="pb-2 text-right text-xs font-semibold text-slate-400">נמען</th>
                                            <th className="pb-2 text-right text-xs font-semibold text-slate-400">נושא</th>
                                            <th className="pb-2 text-right text-xs font-semibold text-slate-400">תבנית</th>
                                            <th className="pb-2 text-right text-xs font-semibold text-slate-400">סטודיו</th>
                                            <th className="pb-2 text-right text-xs font-semibold text-slate-400">סטטוס</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {logs.map(l => (
                                            <tr key={l.id} className="border-b border-slate-50 hover:bg-slate-50">
                                                <td className="py-2 text-xs text-slate-400 font-mono whitespace-nowrap">
                                                    {new Date(l.sent_at).toLocaleString("he-IL")}
                                                </td>
                                                <td className="py-2 text-xs font-mono">{l.recipient_email}</td>
                                                <td className="py-2 text-xs text-slate-600 max-w-xs truncate">{l.subject}</td>
                                                <td className="py-2"><span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-mono">{l.template_key}</span></td>
                                                <td className="py-2 text-xs text-slate-500">{l.studio_name || "—"}</td>
                                                <td className="py-2">
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.status === "sent" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                                                        {l.status === "sent" ? "✓ נשלח" : "✗ נכשל"}
                                                    </span>
                                                    {l.error_message && <div className="text-xs text-red-500 mt-0.5 max-w-xs truncate">{l.error_message}</div>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Section>
                )}

                {/* ── STATS TAB ── */}
                {tab === "stats" && stats && (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                                { label: "סה\"כ מיילים", value: stats.total, color: "text-slate-800" },
                                { label: "נשלחו",        value: stats.sent,  color: "text-emerald-700" },
                                { label: "נכשלו",        value: stats.failed, color: "text-red-600" },
                                { label: "אחוז הצלחה",  value: `${stats.success_rate}%`, color: "text-blue-700" },
                            ].map(k => (
                                <div key={k.label} className="bg-white rounded-2xl p-4 text-center border border-slate-100 shadow-sm">
                                    <div className={`text-2xl font-black ${k.color}`}>{k.value}</div>
                                    <div className="text-xs text-slate-400 mt-0.5">{k.label}</div>
                                </div>
                            ))}
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <Section title="לפי תבנית" icon="📄">
                                {stats.by_template.map(r => (
                                    <div key={r.template_key} className="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0">
                                        <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded-full text-slate-600">{r.template_key}</span>
                                        <span className="font-bold text-slate-800">{r.cnt}</span>
                                    </div>
                                ))}
                            </Section>

                            <Section title="לפי סטודיו" icon="🏠">
                                {stats.by_studio.map(r => (
                                    <div key={r.name} className="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0">
                                        <span className="text-sm text-slate-700">{r.name || "מערכת"}</span>
                                        <span className="font-bold text-slate-800">{r.cnt}</span>
                                    </div>
                                ))}
                            </Section>

                            <Section title="לפי חודש" icon="📅" className="sm:col-span-2">
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {stats.by_month.map(r => (
                                        <div key={r.month} className="flex-shrink-0 flex flex-col items-center gap-1">
                                            <div className="text-xs font-bold text-slate-800">{r.cnt}</div>
                                            <div className="w-8 bg-slate-900 rounded" style={{ height: Math.max(4, (r.cnt / Math.max(...stats.by_month.map(x => x.cnt))) * 64) }} />
                                            <div className="text-xs text-slate-400">{r.month.slice(5)}</div>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Shared UI ──────────────────────────────────────────────────────────────

function Section({ title, icon, children, className = "" }: { title: string; icon: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ${className}`}>
            <div className="px-5 py-3.5 border-b border-slate-50 flex items-center gap-2">
                <span>{icon}</span>
                <h2 className="font-bold text-slate-800 text-sm">{title}</h2>
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

const lbl = "block text-xs font-semibold text-slate-500 mb-1.5";
const inp = "w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 font-mono";
