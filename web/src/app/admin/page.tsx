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
    owner_display_name: string | null;
    owner_phone: string | null;
    client_count: number;
    appointment_count_month: number;
    has_whatsapp: boolean;
    has_branding: boolean;
    has_activity: boolean;
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
    owner_phone: string;
    subscription_plan: string;
    plan_days: number;
};

type StudioUser = {
    id: string;
    email: string;
    display_name: string;
    role: string;
    phone: string | null;
    is_active: boolean;
};

type GlobalClient = {
    id: string;
    studio_id: string;
    studio_name: string;
    studio_slug: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    is_active: boolean;
    created_at: string;
};

type GlobalAppointment = {
    id: string;
    studio_id: string;
    studio_name: string;
    studio_slug: string;
    client_name: string;
    client_phone: string | null;
    title: string;
    starts_at: string;
    status: string;
    total_price_cents: number;
};

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
    free:     { label: "חינמי",   color: "bg-slate-100 text-slate-600" },
    starter:  { label: "Starter", color: "bg-blue-100 text-blue-700" },
    pro:      { label: "Pro",     color: "bg-purple-100 text-purple-700" },
    studio:   { label: "Studio",  color: "bg-emerald-100 text-emerald-700" },
    platform: { label: "Platform", color: "bg-black text-white" },
};

function ChangePasswordForm() {
    const [cur, setCur] = useState("");
    const [next, setNext] = useState("");
    const [conf, setConf] = useState("");
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (next !== conf) { setMsg({ ok: false, text: "הסיסמאות החדשות לא תואמות" }); return; }
        if (next.length < 6) { setMsg({ ok: false, text: "סיסמה חייבת להכיל לפחות 6 תווים" }); return; }
        setSaving(true); setMsg(null);
        try {
            await apiFetch("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: cur, new_password: next }) });
            setMsg({ ok: true, text: "✅ הסיסמה שונתה בהצלחה!" });
            setCur(""); setNext(""); setConf("");
        } catch (err: any) {
            setMsg({ ok: false, text: err.message || "שגיאה בשינוי הסיסמה" });
        } finally { setSaving(false); }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <input type="password" placeholder="סיסמה נוכחית" value={cur} onChange={e => setCur(e.target.value)} required
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500" />
            <input type="password" placeholder="סיסמה חדשה" value={next} onChange={e => setNext(e.target.value)} required
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500" />
            <input type="password" placeholder="אימות סיסמה חדשה" value={conf} onChange={e => setConf(e.target.value)} required
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500" />
            {msg && <div className={`text-sm px-4 py-2.5 rounded-xl ${msg.ok ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300"}`}>{msg.text}</div>}
            <button type="submit" disabled={saving}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40">
                {saving ? "שומר..." : "שנה סיסמה"}
            </button>
        </form>
    );
}

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
    const [deleteModal, setDeleteModal] = useState<Studio | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteErr, setDeleteErr] = useState<string | null>(null);
    const [extendDays, setExtendDays] = useState(14);
    const [extending, setExtending] = useState(false);
    const [tab, setTab] = useState<"studios" | "audit" | "platform" | "leads" | "contacts">("studios");
    const [auditLog, setAuditLog] = useState<AuditEntry[] | null>(null);
    const [auditLoading, setAuditLoading] = useState(false);
    const [platformSettings, setPlatformSettings] = useState<{ whatsapp_provider: string | null; whatsapp_phone_id: string | null; whatsapp_api_key: string | null } | null>(null);
    const [webhookConfig, setWebhookConfig] = useState<{ webhook_url: string; verify_token: string } | null>(null);
    const [platformLoading, setPlatformLoading] = useState(false);
    const [platformSaving, setPlatformSaving] = useState(false);
    const [platformForm, setPlatformForm] = useState({ whatsapp_provider: "meta", whatsapp_phone_id: "", whatsapp_api_key: "" });
    const [testPhone, setTestPhone] = useState("");
    const [testSending, setTestSending] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

    // Leads Inbox
    type GlobalLead = {
        id: string; studio_id: string; studio_name: string; studio_slug: string;
        name: string; phone: string | null; email: string | null; source: string; status: string;
        service_interest: string | null; notes: string | null; campaign_name: string | null;
        created_at: string; updated_at: string;
    };
    const [leads, setLeads] = useState<GlobalLead[]>([]);
    const [leadsLoading, setLeadsLoading] = useState(false);
    const [selectedLead, setSelectedLead] = useState<GlobalLead | null>(null);
    const [leadNote, setLeadNote] = useState("");
    const [leadSaving, setLeadSaving] = useState(false);
    const [leadsFilter, setLeadsFilter] = useState<{ source: string; status: string; search: string }>({ source: "", status: "", search: "" });
    // Edit studio/owner modal
    const [editModal, setEditModal] = useState<Studio | null>(null);
    const [editForm, setEditForm] = useState({ name: "", slug: "", owner_display_name: "", owner_email: "", owner_phone: "" });
    const [editSaving, setEditSaving] = useState(false);
    const [editErr, setEditErr] = useState<string | null>(null);

    // Users management modal
    const [usersModal, setUsersModal] = useState<Studio | null>(null);
    const [studioUsers, setStudioUsers] = useState<StudioUser[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [addUserForm, setAddUserForm] = useState({ email: "", display_name: "", role: "staff", phone: "" });
    const [addingUser, setAddingUser] = useState(false);
    const [addUserErr, setAddUserErr] = useState<string | null>(null);
    const [editingUser, setEditingUser] = useState<StudioUser | null>(null);
    const [editUserForm, setEditUserForm] = useState({ display_name: "", email: "", role: "", phone: "", is_active: true });
    const [savingUser, setSavingUser] = useState(false);
    const [resetingPw, setResetingPw] = useState<string | null>(null);

    // Contacts tab
    const [contacts, setContacts] = useState<GlobalClient[]>([]);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactsSearch, setContactsSearch] = useState("");
    const [appts, setAppts] = useState<GlobalAppointment[]>([]);
    const [apptsLoading, setApptsLoading] = useState(false);
    const [apptsSearch, setApptsSearch] = useState("");
    const [apptsStatus, setApptsStatus] = useState("");
    const [contactsSubTab, setContactsSubTab] = useState<"clients" | "appointments">("clients");

    const [form, setForm] = useState<NewStudioForm>({
        studio_name: "", slug: "", owner_email: "", owner_password: "", owner_phone: "",
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
            setForm({ studio_name: "", slug: "", owner_email: "", owner_password: "", owner_phone: "", owner_display_name: "", subscription_plan: "starter", plan_days: 30 });
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
            const [data, wh] = await Promise.all([
                apiFetch<{ whatsapp_provider: string | null; whatsapp_phone_id: string | null; whatsapp_api_key: string | null }>("/api/admin/platform-settings"),
                apiFetch<{ webhook_url: string; verify_token: string }>("/api/admin/webhook-config"),
            ]);
            setPlatformSettings(data);
            setWebhookConfig(wh);
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

    const loadLeads = async (f = leadsFilter) => {
        setLeadsLoading(true);
        try {
            const params = new URLSearchParams();
            if (f.source) params.set("source", f.source);
            if (f.status) params.set("status", f.status);
            if (f.search) params.set("search", f.search);
            const data = await apiFetch<GlobalLead[]>(`/api/admin/leads-inbox?${params}`);
            setLeads(data);
        } catch { } finally { setLeadsLoading(false); }
    };

    const handleTabChange = (t: "studios" | "audit" | "platform" | "leads" | "contacts") => {
        setTab(t);
        if (t === "audit") loadAuditLog();
        if (t === "platform") loadPlatformSettings();
        if (t === "leads") loadLeads();
        if (t === "contacts") { loadContacts(); loadAppts(); }
    };

    const openEditModal = (studio: Studio) => {
        setEditErr(null);
        setEditForm({
            name: studio.name,
            slug: studio.slug,
            owner_display_name: studio.owner_display_name || "",
            owner_email: studio.owner_email || "",
            owner_phone: studio.owner_phone || "",
        });
        setEditModal(studio);
    };

    const handleEditSave = async () => {
        if (!editModal) return;
        setEditSaving(true);
        setEditErr(null);
        try {
            await apiFetch(`/api/admin/studios/${editModal.id}`, {
                method: "PATCH",
                body: JSON.stringify({ name: editForm.name, slug: editForm.slug }),
            });
            if (editForm.owner_display_name || editForm.owner_email || editForm.owner_phone) {
                await apiFetch(`/api/admin/studios/${editModal.id}/owner`, {
                    method: "PATCH",
                    body: JSON.stringify({
                        display_name: editForm.owner_display_name || undefined,
                        email: editForm.owner_email || undefined,
                        phone: editForm.owner_phone || undefined,
                    }),
                });
            }
            setEditModal(null);
            await load();
        } catch (e: any) {
            setEditErr(e?.message || "שגיאה בשמירה");
        } finally {
            setEditSaving(false);
        }
    };

    const openUsersModal = async (studio: Studio) => {
        setUsersModal(studio);
        setUsersLoading(true);
        setAddUserErr(null);
        setEditingUser(null);
        setAddUserForm({ email: "", display_name: "", role: "staff", phone: "" });
        try {
            const data = await apiFetch<StudioUser[]>(`/api/admin/studios/${studio.id}/users`);
            setStudioUsers(data);
        } catch { setStudioUsers([]); }
        finally { setUsersLoading(false); }
    };

    const handleAddUser = async () => {
        if (!usersModal) return;
        setAddingUser(true);
        setAddUserErr(null);
        try {
            const u = await apiFetch<StudioUser>(`/api/admin/studios/${usersModal.id}/users`, {
                method: "POST",
                body: JSON.stringify(addUserForm),
            });
            setStudioUsers(prev => [...prev, u]);
            setAddUserForm({ email: "", display_name: "", role: "staff", phone: "" });
        } catch (e: any) {
            setAddUserErr(e?.message || "שגיאה בהוספה");
        } finally {
            setAddingUser(false);
        }
    };

    const handleSaveUser = async () => {
        if (!editingUser) return;
        setSavingUser(true);
        try {
            await apiFetch(`/api/admin/users/${editingUser.id}`, {
                method: "PATCH",
                body: JSON.stringify(editUserForm),
            });
            setStudioUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, ...editUserForm } : u));
            setEditingUser(null);
        } catch (e: any) { alert(e?.message); }
        finally { setSavingUser(false); }
    };

    const handleResetPassword = async (user: StudioUser) => {
        setResetingPw(user.id);
        try {
            await apiFetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
            alert(`✅ קישור איפוס סיסמה נשלח ל-${user.email}`);
        } catch (e: any) { alert(e?.message); }
        finally { setResetingPw(null); }
    };

    const loadContacts = async (search = contactsSearch) => {
        setContactsLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set("search", search);
            const data = await apiFetch<GlobalClient[]>(`/api/admin/contacts?${params}`);
            setContacts(data);
        } catch { } finally { setContactsLoading(false); }
    };

    const loadAppts = async (search = apptsSearch, status = apptsStatus) => {
        setApptsLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set("search", search);
            if (status) params.set("status", status);
            const data = await apiFetch<GlobalAppointment[]>(`/api/admin/appointments?${params}`);
            setAppts(data);
        } catch { } finally { setApptsLoading(false); }
    };

    const handleLeadStatusChange = async (lead: GlobalLead, status: string) => {
        setLeadSaving(true);
        try {
            await apiFetch(`/api/admin/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
            const updated = { ...lead, status };
            setLeads(ls => ls.map(l => l.id === lead.id ? updated : l));
            setSelectedLead(updated);
        } catch { } finally { setLeadSaving(false); }
    };

    const handleLeadNoteSave = async () => {
        if (!selectedLead) return;
        setLeadSaving(true);
        try {
            await apiFetch(`/api/admin/leads/${selectedLead.id}`, { method: "PATCH", body: JSON.stringify({ notes: leadNote }) });
            const updated = { ...selectedLead, notes: leadNote };
            setLeads(ls => ls.map(l => l.id === selectedLead.id ? updated : l));
            setSelectedLead(updated);
        } catch { } finally { setLeadSaving(false); }
    };

    const handleDelete = (studio: Studio) => {
        setDeleteErr(null);
        setDeleteModal(studio);
    };

    const confirmDelete = async () => {
        if (!deleteModal) return;
        setDeleting(true);
        setDeleteErr(null);
        try {
            await apiFetch(`/api/admin/studios/${deleteModal.id}`, { method: "DELETE" });
            setDeleteModal(null);
            await load();
        } catch (e: any) {
            setDeleteErr(e?.message || "שגיאה במחיקה");
        } finally {
            setDeleting(false);
        }
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

    const incompleteSetupStudios = studios.filter(s => !s.has_whatsapp || !s.has_branding || !s.has_activity);

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
                <div className="flex flex-wrap gap-1 bg-white/5 border border-white/10 rounded-2xl p-1 w-fit">
                    {(["studios", "contacts", "leads", "audit", "platform"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => handleTabChange(t)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                                tab === t ? "bg-white text-slate-900" : "text-slate-400 hover:text-white"
                            }`}
                        >
                            {t === "studios" ? "🏢 סטודיואים" : t === "contacts" ? "👥 אנשי קשר" : t === "leads" ? "📥 לידים" : t === "audit" ? "📋 לוג פעולות" : "⚙️ פלטפורמה"}
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
                            { label: "טרם הגדירו", value: incompleteSetupStudios.length, icon: "⚙️", color: incompleteSetupStudios.length > 0 ? "border-orange-500/40 bg-orange-500/10" : "" },
                            { label: "לקוחות סה\"כ", value: stats.total_clients, icon: "👥", color: "" },
                            { label: "תורים החודש", value: stats.total_appointments_month, icon: "📅", color: "" },
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

                {/* Incomplete setup notification */}
                {tab === "studios" && incompleteSetupStudios.length > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-5 py-4">
                        <div className="flex items-center gap-3 mb-3">
                            <span className="text-xl">⚠️</span>
                            <span className="font-bold text-amber-300">{incompleteSetupStudios.length} סטודיו{incompleteSetupStudios.length === 1 ? "" : "אים"} לא השלימו הגדרה</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {incompleteSetupStudios.map(s => (
                                <div key={s.id} className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
                                    <span className="font-semibold text-sm text-white">{s.name}</span>
                                    <div className="flex gap-1">
                                        <span title="WhatsApp" className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${s.has_whatsapp ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                            {s.has_whatsapp ? "✓" : "✗"} WA
                                        </span>
                                        <span title="מיתוג" className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${s.has_branding ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                            {s.has_branding ? "✓" : "✗"} מיתוג
                                        </span>
                                        <span title="פעילות" className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${s.has_activity ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                            {s.has_activity ? "✓" : "✗"} לקוחות
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

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
                                        <th className="text-right px-4 py-3 font-medium">הגדרה</th>
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
                                                    <div className="flex gap-1">
                                                        <span title="WhatsApp מחובר" className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.has_whatsapp ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>W</span>
                                                        <span title="מיתוג הוגדר" className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.has_branding ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>B</span>
                                                        <span title="יש לקוחות" className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.has_activity ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>A</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${s.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                                        {s.is_active ? "פעיל" : "מושבת"}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <button
                                                            onClick={() => openEditModal(s)}
                                                            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            ✏️ ערוך
                                                        </button>
                                                        <button
                                                            onClick={() => openUsersModal(s)}
                                                            className="text-xs bg-slate-600 hover:bg-slate-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            👤 משתמשים
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
                    <div className="max-w-2xl space-y-6">

                        {/* Webhook Config Card */}
                        {webhookConfig && (
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
                                <div>
                                    <h2 className="text-lg font-bold">🔗 חיבור פלטפורמות — Meta Webhook</h2>
                                    <p className="text-slate-400 text-sm mt-1">הכנס את הפרטים האלה בקונסול Meta Developer כדי לקבל הודעות מ-WhatsApp, Facebook ו-Instagram.</p>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-slate-400 block mb-1.5">Callback URL (הכנס ב-Meta → Webhooks)</label>
                                        <div className="flex gap-2">
                                            <input readOnly value={webhookConfig.webhook_url} dir="ltr"
                                                className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono" />
                                            <button onClick={() => navigator.clipboard.writeText(webhookConfig.webhook_url)}
                                                className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs text-slate-300 transition-colors">העתק</button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 block mb-1.5">Verify Token (הכנס ב-Meta → Webhooks)</label>
                                        <div className="flex gap-2">
                                            <input readOnly value={webhookConfig.verify_token} dir="ltr"
                                                className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono" />
                                            <button onClick={() => navigator.clipboard.writeText(webhookConfig.verify_token)}
                                                className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs text-slate-300 transition-colors">העתק</button>
                                        </div>
                                    </div>
                                </div>

                                {/* Platform connection status */}
                                <div>
                                    <div className="text-xs text-slate-400 mb-3">פלטפורמות מחוברות — BizControl</div>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { icon: "💬", name: "WhatsApp", connected: !!platformSettings?.whatsapp_phone_id, detail: platformSettings?.whatsapp_phone_id ? `ID: ${platformSettings.whatsapp_phone_id}` : "לא מוגדר" },
                                            { icon: "📘", name: "Facebook", connected: false, detail: "הגדר Page ID בסטודיו" },
                                            { icon: "📸", name: "Instagram", connected: false, detail: "הגדר Account ID בסטודיו" },
                                        ].map(p => (
                                            <div key={p.name} className={`rounded-xl p-3 border text-center ${p.connected ? "bg-green-900/20 border-green-500/30" : "bg-white/5 border-white/10"}`}>
                                                <div className="text-2xl mb-1">{p.icon}</div>
                                                <div className="text-xs font-semibold text-white">{p.name}</div>
                                                <div className={`text-xs mt-1 ${p.connected ? "text-green-400" : "text-slate-500"}`}>
                                                    {p.connected ? "✅ מחובר" : "⚪ לא מחובר"}
                                                </div>
                                                <div className="text-xs text-slate-600 mt-0.5 truncate">{p.detail}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Instructions */}
                                <details className="group">
                                    <summary className="text-xs text-blue-300 cursor-pointer hover:text-blue-200 transition-colors">📋 הוראות חיבור ב-Meta Developer Console</summary>
                                    <ol className="mt-3 space-y-2 text-xs text-slate-400 list-decimal list-inside leading-relaxed">
                                        <li>כנס ל-<span className="text-blue-300">developers.facebook.com</span> → האפליקציה שלך</li>
                                        <li>בתפריט שמאל: <strong className="text-slate-300">WhatsApp → Configuration</strong> (או Messenger/Instagram)</li>
                                        <li>לחץ <strong className="text-slate-300">Edit</strong> ב-Webhook</li>
                                        <li>הכנס את ה-<strong className="text-slate-300">Callback URL</strong> וה-<strong className="text-slate-300">Verify Token</strong> מלמעלה</li>
                                        <li>לחץ <strong className="text-slate-300">Verify and Save</strong></li>
                                        <li>עבור לטאב <strong className="text-slate-300">Webhook Fields</strong> → Subscribe ל: <code className="bg-white/10 px-1 rounded">messages</code></li>
                                        <li>חזור על הפעולה עבור כל פלטפורמה (WhatsApp, Messenger, Instagram)</li>
                                        <li>הוסף <code className="bg-white/10 px-1 rounded">META_WEBHOOK_VERIFY_TOKEN</code> ו-<code className="bg-white/10 px-1 rounded">BACKEND_URL</code> ב-Railway Environment Variables</li>
                                    </ol>
                                </details>
                            </div>
                        )}

                        <div>
                            <h2 className="text-lg font-bold">הגדרות WhatsApp — פלטפורמה</h2>
                            <p className="text-slate-400 text-sm mt-1">הגדרות אלה משמשות כברירת מחדל לכל הסטודיואים שאין להם WhatsApp משלהם.</p>
                        </div>

                        {platformLoading ? (
                            <div className="text-slate-400 text-sm">טוען...</div>
                        ) : (
                            <>
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
                            </>
                        )}

                        {/* Change Password Card */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                            <div>
                                <h2 className="text-lg font-bold">🔐 שינוי סיסמה</h2>
                                <p className="text-slate-400 text-sm mt-1">שנה את סיסמת חשבון הסופר-אדמין שלך.</p>
                            </div>
                            <ChangePasswordForm />
                        </div>

                    </div>
                )}

                {/* ── Contacts Tab ── */}
                {tab === "contacts" && (
                    <div className="space-y-4">
                        {/* Sub-tabs */}
                        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
                            {(["clients", "appointments"] as const).map(st => (
                                <button key={st} onClick={() => setContactsSubTab(st)}
                                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${contactsSubTab === st ? "bg-white text-slate-900" : "text-slate-400 hover:text-white"}`}>
                                    {st === "clients" ? "👥 לקוחות" : "📅 תורים"}
                                </button>
                            ))}
                        </div>

                        {/* Clients sub-tab */}
                        {contactsSubTab === "clients" && (
                            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                                <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3">
                                    <h2 className="font-bold text-lg flex-1">כל הלקוחות ({contacts.length})</h2>
                                    <input
                                        placeholder="חיפוש שם / טלפון / אימייל..."
                                        value={contactsSearch}
                                        onChange={e => { setContactsSearch(e.target.value); loadContacts(e.target.value); }}
                                        className="bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30 w-64"
                                        dir="rtl"
                                    />
                                    <button onClick={() => loadContacts()} className="text-xs text-slate-400 hover:text-white transition-colors">↻ רענן</button>
                                </div>
                                {contactsLoading ? (
                                    <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-white/20 border-t-white rounded-full" /></div>
                                ) : contacts.length === 0 ? (
                                    <div className="text-center text-slate-500 py-12">אין לקוחות</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase">
                                                    <th className="text-right px-6 py-3 font-medium">שם</th>
                                                    <th className="text-right px-4 py-3 font-medium">טלפון</th>
                                                    <th className="text-right px-4 py-3 font-medium">אימייל</th>
                                                    <th className="text-right px-4 py-3 font-medium">סטודיו</th>
                                                    <th className="text-right px-4 py-3 font-medium">הצטרף</th>
                                                    <th className="text-right px-4 py-3 font-medium">סטטוס</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {contacts.map(c => (
                                                    <tr key={c.id} className="hover:bg-white/5 transition-colors">
                                                        <td className="px-6 py-3 font-medium">{c.full_name}</td>
                                                        <td className="px-4 py-3 text-slate-300 font-mono text-xs">{c.phone || "—"}</td>
                                                        <td className="px-4 py-3 text-slate-400 text-xs">{c.email || "—"}</td>
                                                        <td className="px-4 py-3">
                                                            <span className="text-xs bg-white/10 rounded-lg px-2 py-0.5 text-slate-300">{c.studio_name}</span>
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                                                            {new Date(c.created_at).toLocaleDateString("he-IL")}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`text-xs px-2 py-0.5 rounded-full ${c.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                                                {c.is_active ? "פעיל" : "לא פעיל"}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Appointments sub-tab */}
                        {contactsSubTab === "appointments" && (
                            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                                <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3 flex-wrap">
                                    <h2 className="font-bold text-lg flex-1">כל התורים ({appts.length})</h2>
                                    <input
                                        placeholder="חיפוש שם / טלפון..."
                                        value={apptsSearch}
                                        onChange={e => { setApptsSearch(e.target.value); loadAppts(e.target.value, apptsStatus); }}
                                        className="bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30 w-52"
                                        dir="rtl"
                                    />
                                    <select
                                        value={apptsStatus}
                                        onChange={e => { setApptsStatus(e.target.value); loadAppts(apptsSearch, e.target.value); }}
                                        className="bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white outline-none"
                                    >
                                        <option value="">כל הסטטוסים</option>
                                        <option value="scheduled">מתוכנן</option>
                                        <option value="done">הסתיים</option>
                                        <option value="canceled">בוטל</option>
                                        <option value="no_show">לא הגיע</option>
                                    </select>
                                    <button onClick={() => loadAppts()} className="text-xs text-slate-400 hover:text-white transition-colors">↻ רענן</button>
                                </div>
                                {apptsLoading ? (
                                    <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-white/20 border-t-white rounded-full" /></div>
                                ) : appts.length === 0 ? (
                                    <div className="text-center text-slate-500 py-12">אין תורים</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase">
                                                    <th className="text-right px-6 py-3 font-medium">לקוח</th>
                                                    <th className="text-right px-4 py-3 font-medium">טלפון</th>
                                                    <th className="text-right px-4 py-3 font-medium">שירות</th>
                                                    <th className="text-right px-4 py-3 font-medium">סטודיו</th>
                                                    <th className="text-right px-4 py-3 font-medium">תאריך ושעה</th>
                                                    <th className="text-right px-4 py-3 font-medium">סטטוס</th>
                                                    <th className="text-right px-4 py-3 font-medium">מחיר</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {appts.map(a => {
                                                    const statusMap: Record<string, { label: string; color: string }> = {
                                                        scheduled: { label: "מתוכנן", color: "bg-blue-500/20 text-blue-300" },
                                                        done: { label: "הסתיים", color: "bg-emerald-500/20 text-emerald-400" },
                                                        canceled: { label: "בוטל", color: "bg-red-500/20 text-red-400" },
                                                        no_show: { label: "לא הגיע", color: "bg-amber-500/20 text-amber-400" },
                                                    };
                                                    const st = statusMap[a.status] || { label: a.status, color: "bg-slate-500/20 text-slate-400" };
                                                    return (
                                                        <tr key={a.id} className="hover:bg-white/5 transition-colors">
                                                            <td className="px-6 py-3 font-medium">{a.client_name}</td>
                                                            <td className="px-4 py-3 text-slate-300 font-mono text-xs">{a.client_phone || "—"}</td>
                                                            <td className="px-4 py-3 text-slate-300 text-xs">{a.title}</td>
                                                            <td className="px-4 py-3">
                                                                <span className="text-xs bg-white/10 rounded-lg px-2 py-0.5 text-slate-300">{a.studio_name}</span>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">
                                                                {new Date(a.starts_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-300 text-xs">
                                                                {a.total_price_cents > 0 ? `₪${(a.total_price_cents / 100).toLocaleString()}` : "—"}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Leads Inbox Tab ── */}
                {tab === "leads" && (
                    <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[500px]">

                        {/* Left: Lead List */}
                        <div className="w-80 flex-shrink-0 flex flex-col gap-3">
                            {/* Filters */}
                            <div className="flex gap-2">
                                <input
                                    placeholder="חיפוש שם / טלפון..."
                                    value={leadsFilter.search}
                                    onChange={e => { const f = { ...leadsFilter, search: e.target.value }; setLeadsFilter(f); loadLeads(f); }}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30"
                                    dir="rtl"
                                />
                            </div>
                            <div className="flex gap-2">
                                <select value={leadsFilter.source} onChange={e => { const f = { ...leadsFilter, source: e.target.value }; setLeadsFilter(f); loadLeads(f); }}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white outline-none">
                                    <option value="">כל המקורות</option>
                                    <option value="whatsapp">WhatsApp</option>
                                    <option value="facebook">Facebook</option>
                                    <option value="instagram">Instagram</option>
                                    <option value="manual">ידני</option>
                                </select>
                                <select value={leadsFilter.status} onChange={e => { const f = { ...leadsFilter, status: e.target.value }; setLeadsFilter(f); loadLeads(f); }}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white outline-none">
                                    <option value="">כל הסטטוסים</option>
                                    <option value="new">חדש</option>
                                    <option value="contacted">נענה</option>
                                    <option value="interested">מעוניין</option>
                                    <option value="booked">נקבע תור</option>
                                    <option value="lost">אבוד</option>
                                </select>
                            </div>

                            {/* Lead list */}
                            <div className="flex-1 overflow-y-auto space-y-2 pl-1">
                                {leadsLoading && <div className="text-slate-400 text-sm text-center py-8">טוען...</div>}
                                {!leadsLoading && leads.length === 0 && <div className="text-slate-500 text-sm text-center py-8">אין לידים</div>}
                                {leads.map(lead => {
                                    const srcIcon = lead.source === "whatsapp" ? "💬" : lead.source === "facebook" ? "📘" : lead.source === "instagram" ? "📸" : "✏️";
                                    const statusColor = lead.status === "new" ? "bg-blue-500/20 text-blue-300" : lead.status === "contacted" ? "bg-yellow-500/20 text-yellow-300" : lead.status === "interested" ? "bg-orange-500/20 text-orange-300" : lead.status === "booked" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300";
                                    const statusLabel = lead.status === "new" ? "חדש" : lead.status === "contacted" ? "נענה" : lead.status === "interested" ? "מעוניין" : lead.status === "booked" ? "נקבע תור" : "אבוד";
                                    return (
                                        <button key={lead.id} onClick={() => { setSelectedLead(lead); setLeadNote(lead.notes || ""); }}
                                            className={`w-full text-right rounded-xl p-3 border transition-all ${selectedLead?.id === lead.id ? "bg-white/15 border-white/30" : "bg-white/5 border-white/10 hover:bg-white/10"}`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs text-slate-400">{srcIcon} {lead.studio_name}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>{statusLabel}</span>
                                            </div>
                                            <div className="font-semibold text-sm text-white truncate">{lead.name}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">{lead.phone || lead.email || "—"}</div>
                                            <div className="text-xs text-slate-600 mt-0.5">{new Date(lead.created_at).toLocaleDateString("he-IL")}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Right: Lead Detail */}
                        <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 overflow-y-auto">
                            {!selectedLead ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                                    <div className="text-5xl mb-3">📥</div>
                                    <p className="text-sm">בחר ליד מהרשימה לצפייה בפרטים</p>
                                </div>
                            ) : (
                                <div className="space-y-5" dir="rtl">
                                    {/* Header */}
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h2 className="text-xl font-bold text-white">{selectedLead.name}</h2>
                                            <p className="text-sm text-slate-400 mt-0.5">
                                                {selectedLead.source === "whatsapp" ? "💬 WhatsApp" : selectedLead.source === "facebook" ? "📘 Facebook" : selectedLead.source === "instagram" ? "📸 Instagram" : "✏️ ידני"}
                                                {" · "}סטודיו: <span className="text-slate-300">{selectedLead.studio_name}</span>
                                            </p>
                                        </div>
                                        <div className="text-xs text-slate-500">{new Date(selectedLead.created_at).toLocaleString("he-IL")}</div>
                                    </div>

                                    {/* Contact Info */}
                                    <div className="grid grid-cols-2 gap-3">
                                        {selectedLead.phone && (
                                            <div className="bg-white/5 rounded-xl px-4 py-3">
                                                <div className="text-xs text-slate-500 mb-1">טלפון</div>
                                                <div className="text-sm text-white font-mono">{selectedLead.phone}</div>
                                            </div>
                                        )}
                                        {selectedLead.email && (
                                            <div className="bg-white/5 rounded-xl px-4 py-3">
                                                <div className="text-xs text-slate-500 mb-1">אימייל</div>
                                                <div className="text-sm text-white">{selectedLead.email}</div>
                                            </div>
                                        )}
                                        {selectedLead.service_interest && (
                                            <div className="bg-white/5 rounded-xl px-4 py-3">
                                                <div className="text-xs text-slate-500 mb-1">עניין בשירות</div>
                                                <div className="text-sm text-white">{selectedLead.service_interest}</div>
                                            </div>
                                        )}
                                        {selectedLead.campaign_name && (
                                            <div className="bg-white/5 rounded-xl px-4 py-3">
                                                <div className="text-xs text-slate-500 mb-1">קמפיין</div>
                                                <div className="text-sm text-white">{selectedLead.campaign_name}</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Status */}
                                    <div>
                                        <div className="text-xs text-slate-400 mb-2">סטטוס טיפול</div>
                                        <div className="flex flex-wrap gap-2">
                                            {[
                                                { v: "new", label: "חדש", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
                                                { v: "contacted", label: "נענה", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
                                                { v: "interested", label: "מעוניין", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
                                                { v: "booked", label: "✅ נקבע תור", color: "bg-green-500/20 text-green-300 border-green-500/30" },
                                                { v: "lost", label: "❌ אבוד", color: "bg-red-500/20 text-red-300 border-red-500/30" },
                                            ].map(({ v, label, color }) => (
                                                <button key={v}
                                                    onClick={() => handleLeadStatusChange(selectedLead, v)}
                                                    disabled={leadSaving}
                                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${selectedLead.status === v ? color + " ring-1 ring-white/20" : "bg-white/5 text-slate-400 border-white/10 hover:border-white/30"}`}>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    <div>
                                        <div className="text-xs text-slate-400 mb-2">הערות פנימיות</div>
                                        <textarea
                                            value={leadNote}
                                            onChange={e => setLeadNote(e.target.value)}
                                            rows={4}
                                            placeholder="הוסף הערה על הליד..."
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/30 resize-none"
                                            dir="rtl"
                                        />
                                        <button
                                            onClick={handleLeadNoteSave}
                                            disabled={leadSaving || leadNote === (selectedLead.notes || "")}
                                            className="mt-2 px-4 py-2 bg-white text-slate-900 text-sm font-bold rounded-xl hover:bg-slate-100 disabled:opacity-40 transition-colors"
                                        >
                                            {leadSaving ? "שומר..." : "שמור הערה"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* Edit Studio + Owner Modal */}
            {editModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" dir="rtl">
                        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
                            <h3 className="font-bold text-lg">✏️ עריכת סטודיו — {editModal.name}</h3>
                            <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>
                        {editErr && <div className="mx-6 mb-2 text-sm text-red-400 bg-red-900/30 border border-red-500/20 rounded-xl px-3 py-2 flex-shrink-0">⚠️ {editErr}</div>}
                        <div className="overflow-y-auto flex-1 px-6 pb-2 space-y-5">
                            <div>
                                <p className="text-xs text-slate-400 mb-3 font-semibold uppercase tracking-wide">פרטי הסטודיו</p>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">שם הסטודיו</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                            value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">Slug (מזהה ייחודי)</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30 font-mono" dir="ltr"
                                            value={editForm.slug} onChange={e => setEditForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s/g, "-") }))} />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 mb-3 font-semibold uppercase tracking-wide">פרטי בעל העסק</p>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">שם בעלים (השאר ריק לאי-שינוי)</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                            value={editForm.owner_display_name} onChange={e => setEditForm(f => ({ ...f, owner_display_name: e.target.value }))} placeholder="שם נוכחי" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">אימייל בעלים</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                            type="email" value={editForm.owner_email} onChange={e => setEditForm(f => ({ ...f, owner_email: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">טלפון בעלים (WhatsApp)</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                            type="tel" value={editForm.owner_phone} onChange={e => setEditForm(f => ({ ...f, owner_phone: e.target.value }))} placeholder="972521234567" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3 p-6 pt-4 flex-shrink-0">
                            <button onClick={handleEditSave} disabled={editSaving || !editForm.name || !editForm.slug}
                                className="flex-1 bg-white text-slate-900 font-bold py-2.5 rounded-xl hover:bg-slate-100 disabled:opacity-40 transition-colors">
                                {editSaving ? "שומר..." : "💾 שמור שינויים"}
                            </button>
                            <button onClick={() => setEditModal(null)} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors">ביטול</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Users Management Modal */}
            {usersModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" dir="rtl">
                        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
                            <h3 className="font-bold text-lg">👤 משתמשי הסטודיו — {usersModal.name}</h3>
                            <button onClick={() => { setUsersModal(null); setEditingUser(null); }} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>
                        <div className="overflow-y-auto flex-1 px-6 pb-6 space-y-5">
                            {/* Current users */}
                            {usersLoading ? (
                                <div className="flex justify-center py-6"><div className="animate-spin w-6 h-6 border-4 border-white/20 border-t-white rounded-full" /></div>
                            ) : (
                                <div className="space-y-2">
                                    {studioUsers.map(u => (
                                        <div key={u.id} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-sm">{u.display_name}</span>
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === "owner" ? "bg-purple-500/20 text-purple-300" : u.role === "admin" ? "bg-blue-500/20 text-blue-300" : u.role === "artist" ? "bg-pink-500/20 text-pink-300" : "bg-slate-500/20 text-slate-400"}`}>
                                                        {u.role === "owner" ? "בעלים" : u.role === "admin" ? "מנהל" : u.role === "artist" ? "אמן" : "צוות"}
                                                    </span>
                                                    {!u.is_active && <span className="text-xs text-red-400">מושבת</span>}
                                                </div>
                                                <div className="text-xs text-slate-400 mt-0.5" dir="ltr">{u.email}</div>
                                                {u.phone && <div className="text-xs text-slate-500 font-mono">{u.phone}</div>}
                                            </div>
                                            <div className="flex gap-1.5 flex-shrink-0">
                                                <button onClick={() => { setEditingUser(u); setEditUserForm({ display_name: u.display_name, email: u.email, role: u.role, phone: u.phone || "", is_active: u.is_active }); }}
                                                    className="text-xs bg-indigo-600/30 hover:bg-indigo-600/60 text-indigo-300 px-2.5 py-1.5 rounded-lg transition-colors">ערוך</button>
                                                <button onClick={() => handleResetPassword(u)} disabled={resetingPw === u.id}
                                                    className="text-xs bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40">
                                                    {resetingPw === u.id ? "..." : "🔑 סיסמה"}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Edit user inline */}
                            {editingUser && (
                                <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-xl p-4 space-y-3">
                                    <p className="text-sm font-bold text-indigo-300">עריכת {editingUser.display_name}</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs text-slate-400 mb-1 block">שם</label>
                                            <input className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30"
                                                value={editUserForm.display_name} onChange={e => setEditUserForm(f => ({ ...f, display_name: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 mb-1 block">אימייל</label>
                                            <input className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30" dir="ltr"
                                                value={editUserForm.email} onChange={e => setEditUserForm(f => ({ ...f, email: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 mb-1 block">תפקיד</label>
                                            <select className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none"
                                                value={editUserForm.role} onChange={e => setEditUserForm(f => ({ ...f, role: e.target.value }))}>
                                                <option value="owner">בעלים</option>
                                                <option value="admin">מנהל</option>
                                                <option value="artist">אמן/אמנית</option>
                                                <option value="staff">צוות</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 mb-1 block">טלפון</label>
                                            <input className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30" dir="ltr"
                                                value={editUserForm.phone} onChange={e => setEditUserForm(f => ({ ...f, phone: e.target.value }))} />
                                        </div>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input type="checkbox" checked={editUserForm.is_active} onChange={e => setEditUserForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 accent-indigo-400" />
                                        <span className="text-slate-300">משתמש פעיל</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <button onClick={handleSaveUser} disabled={savingUser}
                                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-2 rounded-lg transition-colors disabled:opacity-40">
                                            {savingUser ? "שומר..." : "💾 שמור"}
                                        </button>
                                        <button onClick={() => setEditingUser(null)} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors">ביטול</button>
                                    </div>
                                </div>
                            )}

                            {/* Add new user */}
                            <div className="border-t border-white/10 pt-4 space-y-3">
                                <p className="text-sm font-bold text-slate-300">+ הוסף משתמש חדש</p>
                                {addUserErr && <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2">⚠️ {addUserErr}</div>}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">שם</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white/30"
                                            value={addUserForm.display_name} onChange={e => setAddUserForm(f => ({ ...f, display_name: e.target.value }))} placeholder="ישראל ישראלי" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">אימייל</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white/30" dir="ltr"
                                            type="email" value={addUserForm.email} onChange={e => setAddUserForm(f => ({ ...f, email: e.target.value }))} placeholder="user@studio.com" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">תפקיד</label>
                                        <select className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"
                                            value={addUserForm.role} onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value }))}>
                                            <option value="admin">מנהל</option>
                                            <option value="artist">אמן/אמנית</option>
                                            <option value="staff">צוות</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">טלפון (אופציונלי)</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white/30" dir="ltr"
                                            type="tel" value={addUserForm.phone} onChange={e => setAddUserForm(f => ({ ...f, phone: e.target.value }))} placeholder="972521234567" />
                                    </div>
                                </div>
                                <button onClick={handleAddUser} disabled={addingUser || !addUserForm.email || !addUserForm.display_name}
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-2.5 rounded-xl transition-colors disabled:opacity-40">
                                    {addingUser ? "מוסיף..." : "✅ הוסף משתמש ושלח הזמנה"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm p-6" dir="rtl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center text-xl">🗑️</div>
                            <div>
                                <h3 className="font-bold text-lg text-white">מחיקת סטודיו</h3>
                                <p className="text-sm text-slate-400">{deleteModal.name}</p>
                            </div>
                        </div>
                        <p className="text-sm text-slate-300 mb-5 leading-relaxed">
                            פעולה זו <strong className="text-red-400">בלתי הפיכה</strong> — כל הנתונים, הלקוחות, התורים וההיסטוריה של הסטודיו יימחקו לצמיתות.
                        </p>
                        {deleteErr && (
                            <div className="text-sm text-red-300 bg-red-900/30 border border-red-500/20 rounded-xl px-3 py-2 mb-4">{deleteErr}</div>
                        )}
                        <div className="flex gap-3">
                            <button
                                onClick={confirmDelete}
                                disabled={deleting}
                                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl transition-colors disabled:opacity-50"
                            >
                                {deleting ? "מוחק..." : "כן, מחק לצמיתות"}
                            </button>
                            <button
                                onClick={() => { setDeleteModal(null); setDeleteErr(null); }}
                                disabled={deleting}
                                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors disabled:opacity-50"
                            >
                                ביטול
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" dir="rtl">
                        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
                            <h3 className="font-bold text-lg">הקמת סטודיו חדש</h3>
                            <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>

                        {createErr && (
                            <div className="mx-6 mb-2 text-sm text-red-400 bg-red-900/30 border border-red-500/20 rounded-xl px-3 py-2 flex-shrink-0">⚠️ {createErr}</div>
                        )}

                        <div className="overflow-y-auto flex-1 px-6 pb-6 space-y-4">
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

                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">טלפון בעלים (WhatsApp) — אופציונלי</label>
                                <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                    type="tel" value={form.owner_phone} onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))} placeholder="972521234567" />
                                <p className="text-xs text-slate-500 mt-0.5">פורמט בינלאומי ללא + (לשליחת פרטי כניסה ב-WhatsApp)</p>
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

                        <div className="flex gap-3 p-6 pt-4 flex-shrink-0">
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
