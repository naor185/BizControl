"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearToken, setToken, getToken } from "@/lib/api";
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie,
    XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

type Stats = {
    total_studios: number;
    active_studios: number;
    new_studios_month: number;
    total_clients: number;
    total_appointments_month: number;
    pending_messages: number;
};

type Studio = {
    id: string;
    name: string;
    slug: string;
    subscription_plan: string;
    is_active: boolean;
    plan_expires_at: string | null;
    created_at: string;
    owner_email: string | null;
    client_count: number;
    appointment_count_month: number;
};

type ChartsData = {
    studios_by_month: { month: string; count: number }[];
    appts_by_month: { month: string; count: number }[];
    plan_distribution: Record<string, number>;
    status_breakdown: { active: number; trial: number; expired: number };
};

type AuditEntry = {
    id: string;
    admin_email: string;
    action: string;
    studio_id: string | null;
    studio_name: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
};

type NewStudioForm = {
    studio_name: string;
    slug: string;
    owner_email: string;
    owner_password: string;
    owner_display_name: string;
    subscription_plan: string;
    plan_days: number;
};

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
    free:     { label: "חינמי",   color: "bg-slate-100 text-slate-600" },
    starter:  { label: "Starter", color: "bg-blue-100 text-blue-700" },
    pro:      { label: "Pro",     color: "bg-purple-100 text-purple-700" },
    studio:   { label: "Studio",  color: "bg-emerald-100 text-emerald-700" },
    platform: { label: "Platform", color: "bg-black text-white" },
};

export default function AdminPage() {
    const router = useRouter();
    const [stats, setStats] = useState<Stats | null>(null);
    const [studios, setStudios] = useState<Studio[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createErr, setCreateErr] = useState<string | null>(null);
    const [impersonating, setImpersonating] = useState<string | null>(null);
    const [charts, setCharts] = useState<ChartsData | null>(null);
    const [extendModal, setExtendModal] = useState<{ studio: Studio } | null>(null);
    const [extendDays, setExtendDays] = useState(14);
    const [extending, setExtending] = useState(false);
    const [tab, setTab] = useState<"studios" | "audit" | "platform">("studios");
    const [auditLog, setAuditLog] = useState<AuditEntry[] | null>(null);
    const [auditLoading, setAuditLoading] = useState(false);
    const [platformSettings, setPlatformSettings] = useState<{ whatsapp_provider: string | null; whatsapp_phone_id: string | null; whatsapp_api_key: string | null } | null>(null);
    const [platformLoading, setPlatformLoading] = useState(false);
    const [platformSaving, setPlatformSaving] = useState(false);
    const [platformForm, setPlatformForm] = useState({ whatsapp_provider: "meta", whatsapp_phone_id: "", whatsapp_api_key: "" });
    const [testPhone, setTestPhone] = useState("");
    const [testSending, setTestSending] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const [form, setForm] = useState<NewStudioForm>({
        studio_name: "", slug: "", owner_email: "", owner_password: "",
        owner_display_name: "", subscription_plan: "starter", plan_days: 30,
    });

    const load = useCallback(async () => {
        setErr(null);
        try {
            const [s, st, ch] = await Promise.all([
                apiFetch<Stats>("/api/admin/stats"),
                apiFetch<Studio[]>("/api/admin/studios"),
                apiFetch<ChartsData>("/api/admin/charts"),
            ]);
            setStats(s);
            setStudios(st);
            setCharts(ch);
        } catch (e: any) {
            if (e?.message?.includes("403") || e?.message?.includes("401")) {
                router.replace("/login");
            } else {
                setErr(e?.message || "שגיאה בטעינה");
            }
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async () => {
        setCreating(true);
        setCreateErr(null);
        try {
            await apiFetch("/api/admin/studios", {
                method: "POST",
                body: JSON.stringify({ ...form, plan_days: Number(form.plan_days) }),
            });
            setShowNew(false);
            setForm({ studio_name: "", slug: "", owner_email: "", owner_password: "", owner_display_name: "", subscription_plan: "starter", plan_days: 30 });
            await load();
        } catch (e: any) {
            setCreateErr(e?.message || "שגיאה ביצירה");
        } finally {
            setCreating(false);
        }
    };

    const handleToggleActive = async (studio: Studio) => {
        try {
            await apiFetch(`/api/admin/studios/${studio.id}`, {
                method: "PATCH",
                body: JSON.stringify({ is_active: !studio.is_active }),
            });
            await load();
        } catch (e: any) { alert(e?.message); }
    };

    const handleExtend = (studio: Studio) => {
        setExtendDays(14);
        setExtendModal({ studio });
    };

    const handleExtendSubmit = async () => {
        if (!extendModal) return;
        setExtending(true);
        try {
            await apiFetch(`/api/admin/studios/${extendModal.studio.id}`, {
                method: "PATCH",
                body: JSON.stringify({ plan_days: extendDays }),
            });
            setExtendModal(null);
            await load();
        } catch (e: any) {
            alert(e?.message);
        } finally {
            setExtending(false);
        }
    };

    const handleQuickTrial = async (studio: Studio) => {
        try {
            await apiFetch(`/api/admin/studios/${studio.id}`, {
                method: "PATCH",
                body: JSON.stringify({ plan_days: 14 }),
            });
            await load();
        } catch (e: any) { alert(e?.message); }
    };

    const handleImpersonate = async (studio: Studio) => {
        setImpersonating(studio.id);
        try {
            const res = await apiFetch<{ access_token: string; studio_name: string }>(`/api/admin/impersonate/${studio.id}`, { method: "POST" });
            // Save admin token to restore later
            sessionStorage.setItem("admin_token", getToken() || "");
            sessionStorage.setItem("admin_return", "true");
            setToken(res.access_token);
            router.push("/dashboard");
        } catch (e: any) {
            alert(e?.message);
        } finally {
            setImpersonating(null);
        }
    };

    const loadAuditLog = async () => {
        if (auditLog) return;
        setAuditLoading(true);
        try {
            const data = await apiFetch<AuditEntry[]>("/api/admin/audit-log?limit=200");
            setAuditLog(data);
        } catch {
            setAuditLog([]);
        } finally {
            setAuditLoading(false);
        }
    };

    const loadPlatformSettings = async () => {
        if (platformSettings) return;
        setPlatformLoading(true);
        try {
            const data = await apiFetch<{ whatsapp_provider: string | null; whatsapp_phone_id: string | null; whatsapp_api_key: string | null }>("/api/admin/platform-settings");
            setPlatformSettings(data);
            setPlatformForm({
                whatsapp_provider: data.whatsapp_provider || "meta",
                whatsapp_phone_id: data.whatsapp_phone_id || "",
                whatsapp_api_key: data.whatsapp_api_key || "",
            });
        } catch { setPlatformSettings(null); }
        finally { setPlatformLoading(false); }
    };

    const handleTestWhatsapp = async () => {
        if (!testPhone.trim()) return;
        setTestSending(true);
        setTestResult(null);
        try {
            await apiFetch("/api/admin/test-whatsapp", {
                method: "POST",
                body: JSON.stringify({ phone: testPhone.trim() }),
            });
            setTestResult({ ok: true, msg: "✅ ההודעה נשלחה! בדוק את הWhatsApp שלך." });
        } catch (e: any) {
            setTestResult({ ok: false, msg: `❌ ${e?.message || "שליחה נכשלה"}` });
        } finally {
            setTestSending(false);
        }
    };

    const handleSavePlatform = async () => {
        setPlatformSaving(true);
        try {
            await apiFetch("/api/admin/platform-settings", {
                method: "PATCH",
                body: JSON.stringify(platformForm),
            });
            setPlatformSettings({ ...platformForm });
            alert("✅ הגדרות נשמרו בהצלחה!");
        } catch (e: any) { alert(e?.message); }
        finally { setPlatformSaving(false); }
    };

    const handleTabChange = (t: "studios" | "audit" | "platform") => {
        setTab(t);
        if (t === "audit") loadAuditLog();
        if (t === "platform") loadPlatformSettings();
    };

    const handleDelete = async (studio: Studio) => {
        if (!confirm(`למחוק את ${studio.name}? פעולה זו בלתי הפיכה ותמחק את כל הנתונים.`)) return;
        try {
            await apiFetch(`/api/admin/studios/${studio.id}`, { method: "DELETE" });
            await load();
        } catch (e: any) { alert(e?.message); }
    };

    const handleLogout = () => {
        clearToken();
        router.replace("/login");
    };

    const daysUntilExpiry = (expires: string | null) => {
        if (!expires) return null;
        const diff = Math.ceil((new Date(expires).getTime() - Date.now()) / 86400000);
        return diff;
    };

    const trialCount = studios.filter(s => {
        const d = daysUntilExpiry(s.plan_expires_at);
        return d !== null && d > 0 && d <= 14 && s.is_active;
    }).length;

    const expiredCount = studios.filter(s => {
        const d = daysUntilExpiry(s.plan_expires_at);
        return d !== null && d <= 0;
    }).length;

    if (loading) return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center">
            <div className="animate-spin w-10 h-10 border-4 border-white/20 border-t-white rounded-full" />
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-950 text-white" dir="rtl">

            {/* Header */}
            <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">👑</span>
                    <div>
                        <div className="font-bold text-lg tracking-tight">BizControl Admin</div>
                        <div className="text-xs text-slate-400">Super Admin Panel</div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => { setShowNew(true); setCreateErr(null); }}
                        className="bg-white text-slate-900 text-sm font-bold px-5 py-2 rounded-xl hover:bg-slate-100 transition-colors"
                    >
                        + הוסף סטודיו חדש
                    </button>
                    <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-white transition-colors px-3 py-2">
                        התנתקות
                    </button>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

                {/* Tabs */}
                <div className="flex gap-1 bg-white/5 border border-white/10 rounded-2xl p-1 w-fit">
                    {(["studios", "audit", "platform"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => handleTabChange(t)}
                            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                                tab === t ? "bg-white text-slate-900" : "text-slate-400 hover:text-white"
                            }`}
                        >
                            {t === "studios" ? "🏢 סטודיואים" : t === "audit" ? "📋 לוג פעולות" : "⚙️ פלטפורמה"}
                        </button>
                    ))}
                </div>

                {err && (
                    <div className="bg-red-900/40 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">{err}</div>
                )}

                {/* KPI Cards */}
                {tab === "studios" && stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                        {[
                            { label: "סטודיואים", value: stats.total_studios, icon: "🏢", color: "" },
                            { label: "פעילים", value: stats.active_studios, icon: "✅", color: "" },
                            { label: "חדשים החודש", value: stats.new_studios_month, icon: "🆕", color: "" },
                            { label: "בניסיון (<14י׳)", value: trialCount, icon: "🔬", color: trialCount > 0 ? "border-amber-500/40 bg-amber-500/10" : "" },
                            { label: "פג תוקף", value: expiredCount, icon: "⏰", color: expiredCount > 0 ? "border-red-500/40 bg-red-500/10" : "" },
                            { label: "לקוחות סה\"כ", value: stats.total_clients, icon: "👥", color: "" },
                            { label: "תורים החודש", value: stats.total_appointments_month, icon: "📅", color: "" },
                            { label: "הודעות ממתינות", value: stats.pending_messages, icon: "📬", color: "" },
                        ].map(k => (
                            <div key={k.label} className={`bg-white/5 border border-white/10 rounded-2xl p-4 ${k.color}`}>
                                <div className="text-2xl mb-2">{k.icon}</div>
                                <div className="text-2xl font-bold">{k.value}</div>
                                <div className="text-xs text-slate-400 mt-1">{k.label}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Charts */}
                {tab === "studios" && charts && (() => {
                    const HE_MONTHS = ["", "ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];
                    const fmtMonth = (m: string) => {
                        const [y, mo] = m.split("-");
                        return `${HE_MONTHS[parseInt(mo)]} ${y.slice(2)}`;
                    };
                    const studiosChart = charts.studios_by_month.map(r => ({ ...r, name: fmtMonth(r.month) }));
                    const apptsChart = charts.appts_by_month.map(r => ({ ...r, name: fmtMonth(r.month) }));
                    const planColors: Record<string, string> = { free: "#64748b", starter: "#3b82f6", pro: "#8b5cf6", studio: "#10b981" };
                    const planPie = Object.entries(charts.plan_distribution).map(([k, v]) => ({ name: k, value: v, fill: planColors[k] || "#94a3b8" }));
                    const statusPie = [
                        { name: "פעיל", value: charts.status_breakdown.active, fill: "#10b981" },
                        { name: "ניסיון", value: charts.status_breakdown.trial, fill: "#f59e0b" },
                        { name: "פג תוקף", value: charts.status_breakdown.expired, fill: "#ef4444" },
                    ].filter(x => x.value > 0);

                    const tooltipStyle = { backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 12 };

                    return (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Studios growth */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                <h3 className="font-bold text-sm text-slate-300 mb-4">📈 סטודיואים חדשים — 12 חודשים</h3>
                                <ResponsiveContainer width="100%" height={180}>
                                    <LineChart data={studiosChart}>
                                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                                        <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={25} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Line type="monotone" dataKey="count" name="סטודיואים" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: "#3b82f6" }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Appointments trend */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                <h3 className="font-bold text-sm text-slate-300 mb-4">📅 תורים — 12 חודשים</h3>
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={apptsChart}>
                                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                                        <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Bar dataKey="count" name="תורים" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Plan distribution */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                <h3 className="font-bold text-sm text-slate-300 mb-4">💳 התפלגות תוכניות</h3>
                                {planPie.length > 0 ? (
                                    <div className="flex items-center gap-6">
                                        <ResponsiveContainer width={140} height={140}>
                                            <PieChart>
                                                <Pie data={planPie} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3} />
                                                <Tooltip contentStyle={tooltipStyle} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="space-y-2 flex-1">
                                            {planPie.map(p => (
                                                <div key={p.name} className="flex items-center justify-between text-sm">
                                                    <span className="flex items-center gap-2">
                                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.fill }} />
                                                        <span className="text-slate-300 capitalize">{p.name}</span>
                                                    </span>
                                                    <span className="font-bold text-white">{p.value}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : <p className="text-slate-500 text-sm text-center py-8">אין נתונים</p>}
                            </div>

                            {/* Status breakdown */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                <h3 className="font-bold text-sm text-slate-300 mb-4">🔍 סטטוס סטודיואים</h3>
                                {statusPie.length > 0 ? (
                                    <div className="flex items-center gap-6">
                                        <ResponsiveContainer width={140} height={140}>
                                            <PieChart>
                                                <Pie data={statusPie} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3} />
                                                <Tooltip contentStyle={tooltipStyle} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="space-y-3 flex-1">
                                            {statusPie.map(p => (
                                                <div key={p.name} className="flex items-center justify-between">
                                                    <span className="flex items-center gap-2 text-sm text-slate-300">
                                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.fill }} />
                                                        {p.name}
                                                    </span>
                                                    <span className="font-bold text-white text-lg">{p.value}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : <p className="text-slate-500 text-sm text-center py-8">אין נתונים</p>}
                            </div>
                        </div>
                    );
                })()}

                {/* Studios Table */}
                {tab === "studios" && <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                        <h2 className="font-bold text-lg">כל הסטודיואים ({studios.length})</h2>
                        <button onClick={load} className="text-xs text-slate-400 hover:text-white transition-colors">
                            ↻ רענן
                        </button>
                    </div>

                    {studios.length === 0 ? (
                        <div className="py-16 text-center text-slate-500">
                            <div className="text-4xl mb-3">🏢</div>
                            <p>אין סטודיואים עדיין. לחץ "הוסף סטודיו חדש" כדי להתחיל.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-slate-400 text-xs uppercase">
                                        <th className="text-right px-6 py-3 font-medium">שם / Slug</th>
                                        <th className="text-right px-4 py-3 font-medium">בעלים</th>
                                        <th className="text-right px-4 py-3 font-medium">תוכנית</th>
                                        <th className="text-right px-4 py-3 font-medium">מנוי</th>
                                        <th className="text-right px-4 py-3 font-medium">לקוחות</th>
                                        <th className="text-right px-4 py-3 font-medium">תורים החודש</th>
                                        <th className="text-right px-4 py-3 font-medium">סטטוס</th>
                                        <th className="text-right px-4 py-3 font-medium">פעולות</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {studios.map(s => {
                                        const days = daysUntilExpiry(s.plan_expires_at);
                                        const planStyle = PLAN_LABELS[s.subscription_plan] || { label: s.subscription_plan, color: "bg-slate-100 text-slate-600" };
                                        return (
                                            <tr key={s.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="font-semibold">{s.name}</div>
                                                    <div className="text-slate-400 text-xs" dir="ltr">{s.slug}</div>
                                                </td>
                                                <td className="px-4 py-4 text-slate-300 text-xs" dir="ltr">{s.owner_email || "—"}</td>
                                                <td className="px-4 py-4">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${planStyle.color}`}>
                                                        {planStyle.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    {days === null ? (
                                                        <span className="text-slate-500 text-xs">ללא הגבלה</span>
                                                    ) : days <= 0 ? (
                                                        <span className="text-red-400 text-xs font-bold">⏰ פג תוקף</span>
                                                    ) : days <= 7 ? (
                                                        <span className="text-amber-400 text-xs font-bold">⚠️ {days} ימים</span>
                                                    ) : days <= 14 ? (
                                                        <span className="text-yellow-300 text-xs font-bold">🔬 ניסיון {days}י׳</span>
                                                    ) : (
                                                        <span className="text-slate-300 text-xs">{days} ימים</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 text-slate-300">{s.client_count}</td>
                                                <td className="px-4 py-4 text-slate-300">{s.appointment_count_month}</td>
                                                <td className="px-4 py-4">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${s.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                                        {s.is_active ? "פעיל" : "מושבת"}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <button
                                                            onClick={() => router.push(`/admin/studios/${s.id}`)}
                                                            className="text-xs bg-slate-600 hover:bg-slate-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            פרטים
                                                        </button>
                                                        <button
                                                            onClick={() => handleImpersonate(s)}
                                                            disabled={impersonating === s.id}
                                                            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            {impersonating === s.id ? "..." : "כנס"}
                                                        </button>
                                                        <button
                                                            onClick={() => handleQuickTrial(s)}
                                                            className="text-xs bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-lg transition-colors font-bold"
                                                            title="הענק 14 ימי ניסיון מהיום"
                                                        >
                                                            🔬 14י׳
                                                        </button>
                                                        <button
                                                            onClick={() => handleExtend(s)}
                                                            className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            הארך
                                                        </button>
                                                        <button
                                                            onClick={() => handleToggleActive(s)}
                                                            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${s.is_active ? "bg-amber-600/30 hover:bg-amber-600/50 text-amber-300" : "bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300"}`}
                                                        >
                                                            {s.is_active ? "השבת" : "הפעל"}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(s)}
                                                            className="text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            מחק
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>}

                {/* Audit Log */}
                {tab === "audit" && (
                    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                            <h2 className="font-bold text-lg">📋 לוג פעולות אדמין</h2>
                            <button
                                onClick={() => { setAuditLog(null); loadAuditLog(); }}
                                className="text-xs text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10"
                            >
                                רענן
                            </button>
                        </div>
                        {auditLoading && (
                            <div className="flex justify-center py-12">
                                <div className="animate-spin w-8 h-8 border-4 border-white/20 border-t-white rounded-full" />
                            </div>
                        )}
                        {auditLog && auditLog.length === 0 && (
                            <div className="text-center text-slate-500 py-12">אין פעולות רשומות עדיין</div>
                        )}
                        {auditLog && auditLog.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-right text-slate-400 text-xs border-b border-white/10">
                                            <th className="px-6 py-3 font-medium">תאריך ושעה</th>
                                            <th className="px-6 py-3 font-medium">פעולה</th>
                                            <th className="px-6 py-3 font-medium">סטודיו</th>
                                            <th className="px-6 py-3 font-medium">פרטים</th>
                                            <th className="px-6 py-3 font-medium">מבוצע על ידי</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {auditLog.map(entry => (
                                            <tr key={entry.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-3 text-slate-400 whitespace-nowrap">
                                                    {new Date(entry.created_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}
                                                </td>
                                                <td className="px-6 py-3 font-medium">{entry.action}</td>
                                                <td className="px-6 py-3 text-slate-300">
                                                    {entry.studio_name || <span className="text-slate-600">—</span>}
                                                </td>
                                                <td className="px-6 py-3 text-slate-400 font-mono text-xs max-w-xs truncate">
                                                    {entry.details ? JSON.stringify(entry.details) : "—"}
                                                </td>
                                                <td className="px-6 py-3 text-slate-400 text-xs">{entry.admin_email}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Platform Settings Tab */}
                {tab === "platform" && (
                    <div className="max-w-xl space-y-6">
                        <div>
                            <h2 className="text-lg font-bold">הגדרות WhatsApp — פלטפורמה</h2>
                            <p className="text-slate-400 text-sm mt-1">הגדרות אלה משמשות כברירת מחדל לכל הסטודיואים שאין להם WhatsApp משלהם.</p>
                        </div>

                        {platformLoading ? (
                            <div className="text-slate-400 text-sm">טוען...</div>
                        ) : (
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
                                {/* Provider */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">ספק WhatsApp</label>
                                    <div className="flex gap-3">
                                        {["meta", "green_api"].map(p => (
                                            <button
                                                key={p}
                                                onClick={() => setPlatformForm(f => ({ ...f, whatsapp_provider: p }))}
                                                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                                                    platformForm.whatsapp_provider === p
                                                        ? "bg-white text-slate-900 border-white"
                                                        : "bg-white/5 text-slate-400 border-white/10 hover:border-white/30"
                                                }`}
                                            >
                                                {p === "meta" ? "Meta (WhatsApp Cloud API)" : "Green API"}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Phone Number ID */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Phone Number ID</label>
                                    <input
                                        type="text"
                                        value={platformForm.whatsapp_phone_id}
                                        onChange={e => setPlatformForm(f => ({ ...f, whatsapp_phone_id: e.target.value }))}
                                        placeholder="123456789012345"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30"
                                        dir="ltr"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">מ-Meta Business → WhatsApp → Phone Numbers</p>
                                </div>

                                {/* Access Token */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Access Token (קבוע)</label>
                                    <textarea
                                        value={platformForm.whatsapp_api_key}
                                        onChange={e => setPlatformForm(f => ({ ...f, whatsapp_api_key: e.target.value }))}
                                        placeholder="EAAxxxxxxxxxxxxxxx..."
                                        rows={4}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30 font-mono resize-none"
                                        dir="ltr"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">System User Token מ-Meta Business → System Users</p>
                                </div>

                                <button
                                    onClick={handleSavePlatform}
                                    disabled={platformSaving}
                                    className="w-full bg-white text-slate-900 font-bold py-3 rounded-xl hover:bg-slate-100 transition-colors disabled:opacity-50"
                                >
                                    {platformSaving ? "שומר..." : "שמור הגדרות"}
                                </button>
                            </div>

                            {/* Test WhatsApp */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                                <div>
                                    <h3 className="text-sm font-semibold text-white">בדיקת WhatsApp</h3>
                                    <p className="text-xs text-slate-400 mt-1">שלח הודעת טסט למספר כלשהו כדי לאמת שהחיבור עובד</p>
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="tel"
                                        value={testPhone}
                                        onChange={e => { setTestPhone(e.target.value); setTestResult(null); }}
                                        placeholder="972521234567"
                                        dir="ltr"
                                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30"
                                    />
                                    <button
                                        onClick={handleTestWhatsapp}
                                        disabled={testSending || !testPhone.trim()}
                                        className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40"
                                    >
                                        {testSending ? "שולח..." : "שלח טסט"}
                                    </button>
                                </div>
                                <p className="text-xs text-slate-500">הכנס מספר בפורמט בינלאומי ללא + (לדוג׳: 972521234567)</p>
                                {testResult && (
                                    <div className={`text-sm px-4 py-3 rounded-xl ${testResult.ok ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300"}`}>
                                        {testResult.msg}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

            </div>

            {/* Extend / Trial Modal */}
            {extendModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm p-6" dir="rtl">
                        <div className="flex items-center justify-between mb-1">
                            <h3 className="font-bold text-lg">הארכת מנוי</h3>
                            <button onClick={() => setExtendModal(null)} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>
                        <p className="text-slate-400 text-sm mb-5">{extendModal.studio.name} — בחר לכמה ימים מהיום</p>

                        <div className="grid grid-cols-4 gap-2 mb-4">
                            {[7, 14, 30, 90].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setExtendDays(d)}
                                    className={`py-3 rounded-xl text-sm font-bold transition-all ${extendDays === d ? "bg-white text-slate-900" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}
                                >
                                    {d} ימים
                                </button>
                            ))}
                        </div>

                        <div className="mb-4">
                            <label className="text-xs text-slate-400 mb-1 block">מספר ימים מותאם:</label>
                            <input
                                type="number" min={1} max={365} dir="ltr"
                                value={extendDays}
                                onChange={e => setExtendDays(Number(e.target.value))}
                                className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                            />
                        </div>

                        <div className="bg-white/5 rounded-xl px-4 py-3 mb-5 text-sm">
                            <div className="text-slate-400 text-xs mb-1">תאריך פקיעה חדש:</div>
                            <div className="font-bold text-emerald-400">
                                {new Date(Date.now() + extendDays * 86400000).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleExtendSubmit}
                                disabled={extending || extendDays < 1}
                                className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl transition-colors"
                            >
                                {extending ? "מעדכן..." : `✅ הענק ${extendDays} ימים`}
                            </button>
                            <button onClick={() => setExtendModal(null)} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors">
                                ביטול
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Studio Modal */}
            {showNew && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg p-6" dir="rtl">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-lg">הקמת סטודיו חדש</h3>
                            <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">שם הסטודיו</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                        value={form.studio_name} onChange={e => setForm(f => ({ ...f, studio_name: e.target.value }))} placeholder="סטודיו XYZ" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">Slug (ייחודי)</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30 font-mono" dir="ltr"
                                        value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s/g, "-") }))} placeholder="studio-xyz" />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">שם בעל העסק</label>
                                <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                    value={form.owner_display_name} onChange={e => setForm(f => ({ ...f, owner_display_name: e.target.value }))} placeholder="ישראל ישראלי" />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">מייל בעלים</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                        type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="owner@studio.com" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">סיסמה ראשונית</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                        type="text" value={form.owner_password} onChange={e => setForm(f => ({ ...f, owner_password: e.target.value }))} placeholder="password123" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">תוכנית</label>
                                    <select className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                        value={form.subscription_plan} onChange={e => setForm(f => ({ ...f, subscription_plan: e.target.value }))}>
                                        <option value="starter">Starter — 99₪/חודש</option>
                                        <option value="pro">Pro — 199₪/חודש</option>
                                        <option value="studio">Studio — 349₪/חודש</option>
                                        <option value="free">חינמי</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">ימי מנוי ראשוניים</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                        type="number" min={1} value={form.plan_days} onChange={e => setForm(f => ({ ...f, plan_days: Number(e.target.value) }))} />
                                </div>
                            </div>
                        </div>

                        {createErr && (
                            <div className="mt-4 text-sm text-red-400 bg-red-900/30 border border-red-500/20 rounded-xl px-3 py-2">{createErr}</div>
                        )}

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={handleCreate}
                                disabled={creating || !form.studio_name || !form.slug || !form.owner_email || !form.owner_password}
                                className="flex-1 bg-white text-slate-900 font-bold py-2.5 rounded-xl hover:bg-slate-100 disabled:opacity-40 transition-colors"
                            >
                                {creating ? "יוצר..." : "צור סטודיו"}
                            </button>
                            <button onClick={() => setShowNew(false)} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors">
                                ביטול
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
