"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearToken, setToken, getToken } from "@/lib/api";

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
    const [form, setForm] = useState<NewStudioForm>({
        studio_name: "", slug: "", owner_email: "", owner_password: "",
        owner_display_name: "", subscription_plan: "starter", plan_days: 30,
    });

    const load = useCallback(async () => {
        setErr(null);
        try {
            const [s, st] = await Promise.all([
                apiFetch<Stats>("/api/admin/stats"),
                apiFetch<Studio[]>("/api/admin/studios"),
            ]);
            setStats(s);
            setStudios(st);
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

    const handleExtend = async (studio: Studio) => {
        const days = prompt(`כמה ימים להוסיף למנוי של ${studio.name}?`, "30");
        if (!days) return;
        try {
            await apiFetch(`/api/admin/studios/${studio.id}`, {
                method: "PATCH",
                body: JSON.stringify({ plan_days: Number(days) }),
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

                {err && (
                    <div className="bg-red-900/40 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">{err}</div>
                )}

                {/* KPI Cards */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        {[
                            { label: "סטודיואים", value: stats.total_studios, icon: "🏢" },
                            { label: "פעילים", value: stats.active_studios, icon: "✅" },
                            { label: "חדשים החודש", value: stats.new_studios_month, icon: "🆕" },
                            { label: "לקוחות סה\"כ", value: stats.total_clients, icon: "👥" },
                            { label: "תורים החודש", value: stats.total_appointments_month, icon: "📅" },
                            { label: "הודעות ממתינות", value: stats.pending_messages, icon: "📬" },
                        ].map(k => (
                            <div key={k.label} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                <div className="text-2xl mb-2">{k.icon}</div>
                                <div className="text-2xl font-bold">{k.value}</div>
                                <div className="text-xs text-slate-400 mt-1">{k.label}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Studios Table */}
                <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
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
                                                        <span className="text-red-400 text-xs font-bold">פג תוקף</span>
                                                    ) : days <= 7 ? (
                                                        <span className="text-amber-400 text-xs font-bold">{days} ימים</span>
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
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleImpersonate(s)}
                                                            disabled={impersonating === s.id}
                                                            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            {impersonating === s.id ? "..." : "כנס"}
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
                </div>
            </div>

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
