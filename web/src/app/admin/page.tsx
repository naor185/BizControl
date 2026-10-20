"use client";
import { toast } from "@/lib/toast";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearToken, setToken, getToken, API_BASE } from "@/lib/api";
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie,
    XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import PasswordInput from "@/components/PasswordInput";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import LandingPageTemplate from "@/components/LandingPageTemplate";
import BizFindStoreLinks from "@/components/admin/BizFindStoreLinks";
import BizFindDesign from "@/components/admin/BizFindDesign";
import BizFindHero from "@/components/admin/BizFindHero";
import { Flag, Inbox, Tags, Users } from "lucide-react";

import { tx, intl } from "@/lib/i18n";
type Tab = "studios" | "audit" | "bizcontrol" | "bizfind" | "leads" | "contacts" | "health";

type Stats = {
    total_studios: number;
    active_studios: number;
    new_studios_month: number;
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
    free:     { label: tx("חינמי"),   color: "bg-slate-100 text-slate-600" },
    starter:  { label: "Starter", color: "bg-blue-100 text-blue-700" },
    pro:      { label: "Pro",     color: "bg-purple-100 text-purple-700" },
    studio:   { label: "Studio",  color: "bg-emerald-100 text-emerald-700" },
    platform: { label: "Platform", color: "bg-black text-white" },
};

const OPTION_STYLE: React.CSSProperties = { background: "#1e1b4b", color: "#fff" };

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
    const [tab, setTab] = useState<Tab>("studios");
    const [healthData, setHealthData] = useState<{ studio_id: string; studio_name: string; wa_status: string; wa_instance_id: string | null; wa_provider: string | null; wa_phone_id: string | null; failed_jobs_24h: number; stuck_pending_jobs: number; has_alert: boolean }[] | null>(null);
    const [healthLoading, setHealthLoading] = useState(false);
    const [auditLog, setAuditLog] = useState<AuditEntry[] | null>(null);
    const [auditLoading, setAuditLoading] = useState(false);
    const [platformSettings, setPlatformSettings] = useState<{
        whatsapp_provider: string | null; whatsapp_phone_id: string | null; whatsapp_api_key: string | null;
        theme_primary_color?: string; theme_secondary_color?: string; theme_accent_color?: string;
        theme_background_color?: string; theme_surface_color?: string;
        theme_text_color?: string; theme_text_muted_color?: string;
        theme_heading_font?: string | null; theme_body_font?: string | null;
    } | null>(null);
    const [webhookConfig, setWebhookConfig] = useState<{ webhook_url: string; verify_token: string } | null>(null);
    const [platformLoading, setPlatformLoading] = useState(false);
    const [platformSaving, setPlatformSaving] = useState(false);
    const [platformForm, setPlatformForm] = useState({
        whatsapp_provider: "meta", whatsapp_phone_id: "", whatsapp_api_key: "",
        theme_primary_color: "#7c3aed", theme_secondary_color: "#4c1d95", theme_accent_color: "#f59e0b",
        theme_background_color: "#f8fafc", theme_surface_color: "#ffffff",
        theme_text_color: "#0f172a", theme_text_muted_color: "#64748b",
        theme_heading_font: "Heebo", theme_body_font: "Assistant",
    });
    const [testPhone, setTestPhone] = useState("");
    const [testSending, setTestSending] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

    // BizFind OTP WhatsApp settings
    type BizFindSettings = { otp_studio_id: string | null; otp_studio_name: string | null; otp_phone_number: string | null };
    type BizFindStudio = { studio_id: string; name: string; phone_number: string | null; instance_id: string };
    const [bizfindSettings, setBizfindSettings] = useState<BizFindSettings | null>(null);
    const [bizfindStudios, setBizfindStudios] = useState<BizFindStudio[]>([]);
    const [bizfindSelected, setBizfindSelected] = useState("");
    const [bizfindSaving, setBizfindSaving] = useState(false);
    const [bizfindTestPhone, setBizfindTestPhone] = useState("");
    const [bizfindTestResult, setBizfindTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

    // System WhatsApp (central fallback for all studios)
    type SystemWA = { studio_id: string | null; studio_name: string | null; phone_number: string | null };
    const [systemWA, setSystemWA] = useState<SystemWA | null>(null);
    const [systemWASelected, setSystemWASelected] = useState("");
    const [systemWASaving, setSystemWASaving] = useState(false);

    // Platform Green API (dedicated instance for superadmin)
    const [platformWAInstance, setPlatformWAInstance] = useState("");
    const [platformWAToken, setPlatformWAToken] = useState("");
    const [platformWATokenSet, setPlatformWATokenSet] = useState(false);
    const [platformWASaving, setPlatformWASaving] = useState(false);
    const [platformWATestPhone, setPlatformWATestPhone] = useState("");
    const [platformWATestResult, setPlatformWATestResult] = useState<{ok:boolean;msg:string}|null>(null);

    // Manual birthday sweep
    const [birthdaySweeping, setBirthdaySweeping] = useState(false);
    const [birthdaySweepResult, setBirthdaySweepResult] = useState<{ ok: boolean; messages_enqueued: number } | null>(null);


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
                setErr(e?.message || tx("שגיאה בטעינה"));
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
            setCreateErr(e?.message || tx("שגיאה ביצירה"));
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
        } catch (e: any) { toast.error(e?.message); }
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
            toast.error(e?.message);
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
        } catch (e: any) { toast.error(e?.message); }
    };

    const handleImpersonate = async (studio: Studio) => {
        setImpersonating(studio.id);
        try {
            // Use raw fetch to avoid apiFetch redirecting to /login on 401
            const rawRes = await fetch(`${API_BASE}/api/admin/impersonate/${studio.id}`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${getToken()}`,
                    "Content-Type": "application/json",
                },
            });
            if (!rawRes.ok) {
                let detail = `HTTP ${rawRes.status}`;
                try { const j = await rawRes.json(); detail = j.detail || detail; } catch { /* ignore */ }
                alert(tx("שגיאת כניסה ({0}): {1}", { 0: rawRes.status, 1: detail }));
                return;
            }
            const data = await rawRes.json();
            // Save admin token to restore later
            sessionStorage.setItem("admin_token", getToken() || "");
            sessionStorage.setItem("admin_return", "true");
            setToken(data.access_token);
            window.location.href = "/calendar";
        } catch (e: any) {
            alert(tx("שגיאת רשת: ") + (e?.message || tx("לא ידוע")));
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

        // Load Platform Green API first — isolated so a failure in other calls can't hide it
        try {
            const platWA = await apiFetch<{instance_id:string|null;token_set:boolean}>("/api/admin/platform-green-api");
            setPlatformWAInstance(platWA.instance_id || "");
            setPlatformWATokenSet(platWA.token_set);
        } catch { /* platform green api failed — leave defaults */ }


        // Load remaining settings — each isolated so one failure doesn't block others
        try {
            const data = await apiFetch<{
                whatsapp_provider: string | null; whatsapp_phone_id: string | null; whatsapp_api_key: string | null;
                theme_primary_color: string; theme_secondary_color: string; theme_accent_color: string;
                theme_background_color: string; theme_surface_color: string;
                theme_text_color: string; theme_text_muted_color: string;
                theme_heading_font: string | null; theme_body_font: string | null;
            }>("/api/admin/platform-settings");
            setPlatformSettings(data);
            setPlatformForm({
                whatsapp_provider: data.whatsapp_provider || "meta",
                whatsapp_phone_id: data.whatsapp_phone_id || "",
                whatsapp_api_key: data.whatsapp_api_key || "",
                theme_primary_color: data.theme_primary_color || "#7c3aed",
                theme_secondary_color: data.theme_secondary_color || "#4c1d95",
                theme_accent_color: data.theme_accent_color || "#f59e0b",
                theme_background_color: data.theme_background_color || "#f8fafc",
                theme_surface_color: data.theme_surface_color || "#ffffff",
                theme_text_color: data.theme_text_color || "#0f172a",
                theme_text_muted_color: data.theme_text_muted_color || "#64748b",
                theme_heading_font: data.theme_heading_font || "Heebo",
                theme_body_font: data.theme_body_font || "Assistant",
            });
        } catch { setPlatformSettings(null); }

        try {
            const wh = await apiFetch<{ webhook_url: string; verify_token: string }>("/api/admin/webhook-config");
            setWebhookConfig(wh);
        } catch { /* ignore */ }

        try {
            const [bf, sysWA] = await Promise.all([
                apiFetch<BizFindSettings>("/api/admin/bizfind-settings"),
                apiFetch<SystemWA>("/api/admin/system-whatsapp"),
            ]);
            setBizfindSettings(bf);
            setBizfindSelected(bf.otp_studio_id || "");
            setSystemWA(sysWA);
            setSystemWASelected(sysWA.studio_id || "");
        } catch { /* ignore */ }

        // Studios list is optional — failure must never affect other settings
        try {
            const studios = await apiFetch<BizFindStudio[]>("/api/admin/bizfind-settings/studios");
            setBizfindStudios(studios);
        } catch { setBizfindStudios([]); }

        setPlatformLoading(false);
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
            setTestResult({ ok: true, msg: tx("✅ ההודעה נשלחה! בדוק את הWhatsApp שלך.") });
        } catch (e: any) {
            setTestResult({ ok: false, msg: `❌ ${e?.message || tx("שליחה נכשלה")}` });
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
            toast.error(tx("✅ הגדרות נשמרו בהצלחה!"));
        } catch (e: any) { toast.error(e?.message); }
        finally { setPlatformSaving(false); }
    };

    const handleSavePlatformGreenAPI = async () => {
        if (!platformWAInstance.trim()) { toast.error(tx("הכנס Instance ID")); return; }
        setPlatformWASaving(true);
        try {
            const body: Record<string,string|null> = { instance_id: platformWAInstance.trim() };
            if (platformWAToken.trim()) body.token = platformWAToken.trim();
            const d = await apiFetch<{instance_id:string|null;token_set:boolean}>("/api/admin/platform-green-api", {
                method: "POST", body: JSON.stringify(body),
            });
            setPlatformWAInstance(d.instance_id || "");
            setPlatformWATokenSet(d.token_set);
            setPlatformWAToken("");
            toast.success(tx("✅ Green API הפלטפורמה נשמר!"));
        } catch (e:any) { toast.error(e?.message); }
        finally { setPlatformWASaving(false); }
    };

    const handleTestPlatformGreenAPI = async () => {
        if (!platformWATestPhone.trim()) return;
        try {
            await apiFetch("/api/admin/platform-green-api/test", {
                method: "POST", body: JSON.stringify({ phone: platformWATestPhone.trim() }),
            });
            setPlatformWATestResult({ ok: true, msg: tx("✅ הודעת בדיקה נשלחה!") });
        } catch (e:any) { setPlatformWATestResult({ ok: false, msg: e?.message || tx("שגיאה") }); }
    };


    const handleSaveSystemWA = async () => {
        setSystemWASaving(true);
        try {
            const data = await apiFetch<SystemWA>("/api/admin/system-whatsapp", {
                method: "POST", body: JSON.stringify({ studio_id: systemWASelected || null }),
            });
            setSystemWA(data);
            toast.success(tx("✅ WhatsApp מרכזי עודכן!"));
        } catch (e: any) { toast.error(e?.message); }
        finally { setSystemWASaving(false); }
    };

    const handleSaveBizfind = async () => {
        setBizfindSaving(true);
        try {
            const data = await apiFetch<BizFindSettings>("/api/admin/bizfind-settings", {
                method: "POST", body: JSON.stringify({ otp_studio_id: bizfindSelected || null }),
            });
            setBizfindSettings(data);
            toast.success(tx("✅ הגדרות BizFind נשמרו!"));
        } catch (e: any) { toast.error(e?.message); }
        finally { setBizfindSaving(false); }
    };

    const handleTestBizfindOtp = async () => {
        if (!bizfindTestPhone.trim()) return;
        try {
            await apiFetch("/api/admin/bizfind-settings/test-otp", {
                method: "POST", body: JSON.stringify({ phone: bizfindTestPhone.trim() }),
            });
            setBizfindTestResult({ ok: true, msg: tx("✅ הודעת בדיקה נשלחה!") });
        } catch (e: any) {
            setBizfindTestResult({ ok: false, msg: e?.message || tx("שגיאה") });
        }
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

    const handleTabChange = (t: Tab) => {
        if (t === "health" && !healthData) {
            setHealthLoading(true);
            apiFetch<typeof healthData>("/api/admin/health")
                .then(d => setHealthData(d))
                .catch(() => {})
                .finally(() => setHealthLoading(false));
        }
        setTab(t);
        if (t === "audit") loadAuditLog();
        if (t === "bizcontrol" || t === "bizfind") loadPlatformSettings();
        if (t === "leads") loadLeads();
        if (t === "contacts") { loadContacts(); loadAppts(); }
    };

    // a tab from the address — /admin?tab=bizfind (the old HERO page leads there)
    useEffect(() => {
        const t = new URLSearchParams(window.location.search).get("tab");
        if (t === "bizcontrol" || t === "bizfind") handleTabChange(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            setEditErr(e?.message || tx("שגיאה בשמירה"));
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
            setAddUserErr(e?.message || tx("שגיאה בהוספה"));
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
        } catch (e: any) { toast.error(e?.message); }
        finally { setSavingUser(false); }
    };

    const handleResetPassword = async (user: StudioUser) => {
        setResetingPw(user.id);
        try {
            await apiFetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
            toast.error(tx("✅ קישור איפוס סיסמה נשלח ל-{0}", { 0: user.email }));
        } catch (e: any) { toast.error(e?.message); }
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
            setDeleteErr(e?.message || tx("שגיאה במחיקה"));
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
        <div className="min-h-screen bg-slate-950 text-white">

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
                        {tx("+ הוסף סטודיו חדש")}
                    </button>
                    <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-white transition-colors px-3 py-2">
                        {tx("התנתקות")}
                    </button>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

                {/* Tabs */}
                <div className="flex flex-wrap gap-1 bg-white/5 border border-white/10 rounded-2xl p-1 w-fit">
                    {(["studios", "contacts", "leads", "audit", "bizcontrol", "bizfind", "health"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => handleTabChange(t)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                                tab === t ? "bg-white text-slate-900" : "text-slate-400 hover:text-white"
                            }`}
                        >
                            {t === "studios" ? tx("🏢 סטודיואים") : t === "contacts" ? tx("👥 אנשי קשר") : t === "leads" ? tx("📥 לידים") : t === "audit" ? tx("📋 לוג פעולות") : t === "bizcontrol" ? tx("⚙️ הגדרות BizControl") : t === "bizfind" ? tx("🔎 הגדרות BizFind") : tx("🚨 התראות")}
                        </button>
                    ))}
                    <a
                        href="/admin/wallet"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white"
                    >
                        💳 Wallet System
                    </a>
                    <a
                        href="/admin/crm"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white inline-flex items-center gap-1.5"
                    >
                        <Users className="h-4 w-4" /> {tx("הלקוחות שלי")}
                    </a>
                    <a
                        href="/admin/messages"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white inline-flex items-center gap-1.5"
                    >
                        <Inbox className="h-4 w-4" /> {tx("תור הודעות")}
                    </a>
                    <a
                        href="/admin/review-reports"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white inline-flex items-center gap-1.5"
                    >
                        <Flag className="h-4 w-4" /> {tx("ביקורות שדווחו")}
                    </a>
                    <a
                        href="/admin/invoice-scans"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white"
                    >
                        {tx("📄 סריקות AI")}
                    </a>
                    <a
                        href="/admin/modules"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white"
                    >
                        {tx("🧩 מודולים")}
                    </a>
                    <a
                        href="/admin/packages"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white"
                    >
                        {tx("📦 חבילות")}
                    </a>
                    <a
                        href="/admin/email-center"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white"
                    >
                        📧 Email Center
                    </a>
                    <a
                        href="/admin/platform-analytics"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white"
                    >
                        📊 Analytics
                    </a>
                    <a
                        href="/admin/migrations"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white"
                    >
                        {tx("📥 ייבוא נתונים")}
                    </a>
                    <a
                        href="/admin/business-import"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white"
                    >
                        {tx("🗺️ ייבוא עסקים")}
                    </a>
                    <a
                        href="/admin/business-types"
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-slate-400 hover:text-white inline-flex items-center gap-1.5"
                    >
                        <Tags className="h-4 w-4" /> {tx("תחומי עסק")}
                    </a>
                </div>

                {err && (
                    <div className="bg-red-900/40 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">{err}</div>
                )}

                {/* KPI Cards */}
                {tab === "studios" && stats && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        {[
                            { label: tx("סטודיואים"), value: stats.total_studios, icon: "🏢", color: "" },
                            { label: tx("פעילים"), value: stats.active_studios, icon: "✅", color: "" },
                            { label: tx("חדשים החודש"), value: stats.new_studios_month, icon: "🆕", color: "" },
                            { label: tx("בניסיון (<14י׳)"), value: trialCount, icon: "🔬", color: trialCount > 0 ? "border-amber-500/40 bg-amber-500/10" : "" },
                            { label: tx("פג תוקף"), value: expiredCount, icon: "⏰", color: expiredCount > 0 ? "border-red-500/40 bg-red-500/10" : "" },
                            { label: tx("טרם הגדירו"), value: incompleteSetupStudios.length, icon: "⚙️", color: incompleteSetupStudios.length > 0 ? "border-orange-500/40 bg-orange-500/10" : "" },
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
                    const HE_MONTHS = ["", tx("ינו׳"), tx("פבר׳"), tx("מרץ"), tx("אפר׳"), tx("מאי"), tx("יוני"), tx("יולי"), tx("אוג׳"), tx("ספט׳"), tx("אוק׳"), tx("נוב׳"), tx("דצמ׳")];
                    const fmtMonth = (m: string) => {
                        const [y, mo] = m.split("-");
                        return `${HE_MONTHS[parseInt(mo)]} ${y.slice(2)}`;
                    };
                    const studiosChart = charts.studios_by_month.map(r => ({ ...r, name: fmtMonth(r.month) }));
                    const apptsChart = charts.appts_by_month.map(r => ({ ...r, name: fmtMonth(r.month) }));
                    const planColors: Record<string, string> = { free: "#64748b", starter: "#3b82f6", pro: "#8b5cf6", studio: "#10b981" };
                    const planPie = Object.entries(charts.plan_distribution).map(([k, v]) => ({ name: k, value: v, fill: planColors[k] || "#94a3b8" }));
                    const statusPie = [
                        { name: tx("פעיל"), value: charts.status_breakdown.active, fill: "#10b981" },
                        { name: tx("ניסיון"), value: charts.status_breakdown.trial, fill: "#f59e0b" },
                        { name: tx("פג תוקף"), value: charts.status_breakdown.expired, fill: "#ef4444" },
                    ].filter(x => x.value > 0);

                    const tooltipStyle = { backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 12 };

                    return (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Studios growth */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                <h3 className="font-bold text-sm text-slate-300 mb-4">{tx("📈 סטודיואים חדשים — 12 חודשים")}</h3>
                                <ResponsiveContainer width="100%" height={180}>
                                    <LineChart data={studiosChart}>
                                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                                        <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={25} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Line type="monotone" dataKey="count" name={tx("סטודיואים")} stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: "#3b82f6" }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Appointments trend */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                <h3 className="font-bold text-sm text-slate-300 mb-4">{tx("📅 תורים — 12 חודשים")}</h3>
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={apptsChart}>
                                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                                        <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Bar dataKey="count" name={tx("תורים")} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Plan distribution */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                <h3 className="font-bold text-sm text-slate-300 mb-4">{tx("💳 התפלגות תוכניות")}</h3>
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
                                ) : <p className="text-slate-500 text-sm text-center py-8">{tx("אין נתונים")}</p>}
                            </div>

                            {/* Status breakdown */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                <h3 className="font-bold text-sm text-slate-300 mb-4">{tx("🔍 סטטוס סטודיואים")}</h3>
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
                                ) : <p className="text-slate-500 text-sm text-center py-8">{tx("אין נתונים")}</p>}
                            </div>
                        </div>
                    );
                })()}

                {/* Incomplete setup notification */}
                {tab === "studios" && incompleteSetupStudios.length > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-5 py-4">
                        <div className="flex items-center gap-3 mb-3">
                            <span className="text-xl">⚠️</span>
                            <span className="font-bold text-amber-300">{incompleteSetupStudios.length}{tx(" סטודיו")}{incompleteSetupStudios.length === 1 ? "" : tx("אים")}{tx(" לא השלימו הגדרה")}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {incompleteSetupStudios.map(s => (
                                <div key={s.id} className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
                                    <span className="font-semibold text-sm text-white">{s.name}</span>
                                    <div className="flex gap-1">
                                        <span title="WhatsApp" className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${s.has_whatsapp ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                            {s.has_whatsapp ? "✓" : "✗"} WA
                                        </span>
                                        <span title={tx("מיתוג")} className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${s.has_branding ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                            {s.has_branding ? "✓" : "✗"} {tx("מיתוג")}
                                        </span>
                                        <span title={tx("פעילות")} className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${s.has_activity ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                            {s.has_activity ? "✓" : "✗"} {tx("לקוחות")}
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
                        <h2 className="font-bold text-lg">{tx("כל הסטודיואים (")}{studios.length})</h2>
                        <button onClick={load} className="text-xs text-slate-400 hover:text-white transition-colors">
                            {tx("↻ רענן")}
                        </button>
                    </div>

                    {studios.length === 0 ? (
                        <div className="py-16 text-center text-slate-500">
                            <div className="text-4xl mb-3">🏢</div>
                            <p>{tx("אין סטודיואים עדיין. לחץ \"הוסף סטודיו חדש\" כדי להתחיל.")}</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-slate-400 text-xs uppercase">
                                        <th className="text-start px-6 py-3 font-medium">{tx("שם / Slug")}</th>
                                        <th className="text-start px-4 py-3 font-medium">{tx("בעלים")}</th>
                                        <th className="text-start px-4 py-3 font-medium">{tx("תוכנית")}</th>
                                        <th className="text-start px-4 py-3 font-medium">{tx("מנוי")}</th>
                                        <th className="text-start px-4 py-3 font-medium">{tx("לקוחות")}</th>
                                        <th className="text-start px-4 py-3 font-medium">{tx("תורים החודש")}</th>
                                        <th className="text-start px-4 py-3 font-medium">{tx("הגדרה")}</th>
                                        <th className="text-start px-4 py-3 font-medium">{tx("סטטוס")}</th>
                                        <th className="text-start px-4 py-3 font-medium">{tx("פעולות")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {studios.map(s => {
                                        const days = daysUntilExpiry(s.plan_expires_at);
                                        const planStyle = PLAN_LABELS[s.subscription_plan] || { label: s.subscription_plan, color: "bg-slate-100 text-slate-600" };
                                        return (
                                            <tr key={s.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4">
                                                    <a href={`/admin/studios/${s.id}`} className="font-semibold hover:text-sky-400 transition-colors cursor-pointer">{s.name}</a>
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
                                                        <span className="text-slate-500 text-xs">{tx("ללא הגבלה")}</span>
                                                    ) : days <= 0 ? (
                                                        <span className="text-red-400 text-xs font-bold">{tx("⏰ פג תוקף")}</span>
                                                    ) : days <= 7 ? (
                                                        <span className="text-amber-400 text-xs font-bold">⚠️ {days}{tx(" ימים")}</span>
                                                    ) : days <= 14 ? (
                                                        <span className="text-yellow-300 text-xs font-bold">{tx("🔬 ניסיון ")}{days}{tx("י׳")}</span>
                                                    ) : (
                                                        <span className="text-slate-300 text-xs">{days}{tx(" ימים")}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 text-slate-300">{s.client_count}</td>
                                                <td className="px-4 py-4 text-slate-300">{s.appointment_count_month}</td>
                                                <td className="px-4 py-4">
                                                    <div className="flex gap-1">
                                                        <span title={tx("WhatsApp מחובר")} className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.has_whatsapp ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>W</span>
                                                        <span title={tx("מיתוג הוגדר")} className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.has_branding ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>B</span>
                                                        <span title={tx("יש לקוחות")} className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.has_activity ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>A</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${s.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                                        {s.is_active ? tx("פעיל") : tx("מושבת")}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <button
                                                            onClick={() => openEditModal(s)}
                                                            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            {tx("✏️ ערוך")}
                                                        </button>
                                                        <button
                                                            onClick={() => openUsersModal(s)}
                                                            className="text-xs bg-slate-600 hover:bg-slate-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            {tx("👤 משתמשים")}
                                                        </button>
                                                        <button
                                                            onClick={() => handleImpersonate(s)}
                                                            disabled={impersonating === s.id}
                                                            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            {impersonating === s.id ? "..." : tx("כנס")}
                                                        </button>
                                                        <button
                                                            onClick={() => handleQuickTrial(s)}
                                                            className="text-xs bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-lg transition-colors font-bold"
                                                            title={tx("הענק 14 ימי ניסיון מהיום")}
                                                        >
                                                            {tx("🔬 14י׳")}
                                                        </button>
                                                        <button
                                                            onClick={() => handleExtend(s)}
                                                            className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            {tx("הארך")}
                                                        </button>
                                                        <button
                                                            onClick={() => handleToggleActive(s)}
                                                            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${s.is_active ? "bg-amber-600/30 hover:bg-amber-600/50 text-amber-300" : "bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300"}`}
                                                        >
                                                            {s.is_active ? tx("השבת") : tx("הפעל")}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(s)}
                                                            className="text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-1.5 rounded-lg transition-colors"
                                                        >
                                                            {tx("מחק")}
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
                            <h2 className="font-bold text-lg">{tx("📋 לוג פעולות אדמין")}</h2>
                            <button
                                onClick={() => { setAuditLog(null); loadAuditLog(); }}
                                className="text-xs text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10"
                            >
                                {tx("רענן")}
                            </button>
                        </div>
                        {auditLoading && (
                            <div className="flex justify-center py-12">
                                <div className="animate-spin w-8 h-8 border-4 border-white/20 border-t-white rounded-full" />
                            </div>
                        )}
                        {auditLog && auditLog.length === 0 && (
                            <div className="text-center text-slate-500 py-12">{tx("אין פעולות רשומות עדיין")}</div>
                        )}
                        {auditLog && auditLog.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-start text-slate-400 text-xs border-b border-white/10">
                                            <th className="px-6 py-3 font-medium">{tx("תאריך ושעה")}</th>
                                            <th className="px-6 py-3 font-medium">{tx("פעולה")}</th>
                                            <th className="px-6 py-3 font-medium">{tx("סטודיו")}</th>
                                            <th className="px-6 py-3 font-medium">{tx("פרטים")}</th>
                                            <th className="px-6 py-3 font-medium">{tx("מבוצע על ידי")}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {auditLog.map(entry => (
                                            <tr key={entry.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-3 text-slate-400 whitespace-nowrap">
                                                    {new Date(entry.created_at).toLocaleString(intl(), { dateStyle: "short", timeStyle: "short" })}
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

                {/* BizControl's settings — the businesses' system (owner, 2026-10-13: two areas, BizControl and BizFind) */}
                {tab === "bizcontrol" && (
                    <div className="max-w-2xl space-y-6">
                        {/* ══ GLOBAL DESIGN SYSTEM CARD ══ */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-2xl">🎨</div>
                                <div>
                                    <h2 className="text-lg font-bold">{tx("עיצוב BizControl")}</h2>
                                    <p className="text-slate-400 text-sm mt-0.5">{tx("חל רק על BizControl — המערכת של בעלי העסקים. הלוגו נשאר של כל עסק. ל-BizFind יש עיצוב משלו — בלשונית \"הגדרות BizFind\".")}</p>
                                </div>
                            </div>

                            {/* BizControl's own — BizFind has its look apart (components/admin/BizFindDesign.tsx) */}
                            <div className="space-y-2">
                                <span className="text-xs font-bold text-slate-300">{tx("צבעי מותג")}</span>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                    {([
                                        ["theme_primary_color", tx("ראשי")],
                                        ["theme_secondary_color", tx("משני")],
                                        ["theme_accent_color", tx("הדגשה")],
                                    ] as const).map(([key, label]) => (
                                        <div key={key} className="space-y-1.5">
                                            <label className="text-xs text-slate-400 block">{label}</label>
                                            <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-xl p-1.5">
                                                <input
                                                    type="color"
                                                    value={platformForm[key]}
                                                    onChange={e => setPlatformForm(f => ({ ...f, [key]: e.target.value }))}
                                                    className="h-8 w-9 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
                                                />
                                                <input
                                                    type="text" dir="ltr"
                                                    value={platformForm[key]}
                                                    onChange={e => setPlatformForm(f => ({ ...f, [key]: e.target.value }))}
                                                    className="bg-transparent w-full text-xs outline-none uppercase font-mono text-slate-300 min-w-0"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <span className="text-xs font-bold text-slate-300">{tx("רקע וטקסט")}</span>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    {([
                                        ["theme_background_color", tx("רקע")],
                                        ["theme_surface_color", tx("כרטיסים")],
                                        ["theme_text_color", tx("טקסט")],
                                        ["theme_text_muted_color", tx("טקסט משני")],
                                    ] as const).map(([key, label]) => (
                                        <div key={key} className="space-y-1.5">
                                            <label className="text-xs text-slate-400 block">{label}</label>
                                            <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-xl p-1.5">
                                                <input
                                                    type="color"
                                                    value={platformForm[key]}
                                                    onChange={e => setPlatformForm(f => ({ ...f, [key]: e.target.value }))}
                                                    className="h-8 w-9 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
                                                />
                                                <input
                                                    type="text" dir="ltr"
                                                    value={platformForm[key]}
                                                    onChange={e => setPlatformForm(f => ({ ...f, [key]: e.target.value }))}
                                                    className="bg-transparent w-full text-xs outline-none uppercase font-mono text-slate-300 min-w-0"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <span className="text-xs font-bold text-slate-300">{tx("פונטים")}</span>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs text-slate-400 block">{tx("פונט כותרות")}</label>
                                        <select
                                            value={platformForm.theme_heading_font}
                                            onChange={e => setPlatformForm(f => ({ ...f, theme_heading_font: e.target.value }))}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"
                                            style={{ colorScheme: "dark" }}
                                        >
                                            {["Heebo", "Assistant", "Rubik", "M PLUS Rounded 1c", "Varela Round"].map(f => <option key={f} value={f} style={OPTION_STYLE}>{f}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs text-slate-400 block">{tx("פונט גוף טקסט")}</label>
                                        <select
                                            value={platformForm.theme_body_font}
                                            onChange={e => setPlatformForm(f => ({ ...f, theme_body_font: e.target.value }))}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"
                                            style={{ colorScheme: "dark" }}
                                        >
                                            {["Heebo", "Assistant", "Rubik", "M PLUS Rounded 1c", "Varela Round"].map(f => <option key={f} value={f} style={OPTION_STYLE}>{f}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Live preview #1 — public landing page, same isLive={false} mock automation/page.tsx's branding tab already uses */}
                            <div>
                                <div className="text-xs text-slate-400 mb-2">{tx("תצוגה מקדימה — דף נחיתה ציבורי (BizControl)")}</div>
                                <div className="w-full h-64 relative bg-white rounded-2xl shadow-xl overflow-hidden border border-white/10">
                                    <div className="h-8 bg-slate-100 border-b border-slate-200 flex items-center px-3 gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                                        <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                                        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                                    </div>
                                    <div className="w-full h-[calc(100%-2rem)] overflow-hidden relative bg-white">
                                        <div className="absolute inset-0 origin-top w-[160%] h-[160%] scale-[0.625]">
                                            <LandingPageTemplate
                                                themePrimary={platformForm.theme_primary_color}
                                                themeSecondary={platformForm.theme_secondary_color}
                                                logoUrl={null}
                                                title={tx("שם העסק שלך")}
                                                description={tx("תיאור קצר של העסק יופיע כאן, בדיוק כמו שיראה כל לקוח.")}
                                                templateId={1}
                                                titleFont={platformForm.theme_heading_font}
                                                descFont={platformForm.theme_body_font}
                                                isLive={false}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Live preview #2 — the authenticated app's own sidebar chrome (a materially different surface than the public landing page) */}
                            <div>
                                <div className="text-xs text-slate-400 mb-2">{tx("תצוגה מקדימה — סרגל ניווט (BizControl)")}</div>
                                <div
                                    className="w-48 rounded-2xl border border-white/10 p-2.5 space-y-1"
                                    style={{ background: platformForm.theme_surface_color }}
                                >
                                    {[
                                        ["📅", tx("יומן תורים")],
                                        ["📊", tx("לוח בקרה")],
                                        ["👥", tx("לקוחות")],
                                    ].map(([icon, label], i) => (
                                        <div
                                            key={label}
                                            className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium"
                                            style={i === 0
                                                ? { background: platformForm.theme_primary_color, color: "#fff" }
                                                : { color: platformForm.theme_text_color }
                                            }
                                        >
                                            <span>{icon}</span>
                                            <span>{label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={handleSavePlatform}
                                disabled={platformSaving}
                                className="w-full py-3 rounded-xl font-bold text-sm transition-all text-white disabled:opacity-60"
                                style={{ background: platformForm.theme_primary_color }}
                            >
                                {platformSaving ? tx("שומר...") : tx("💾 שמירת העיצוב של BizControl")}
                            </button>
                        </div>

                        {/* Webhook Config Card */}
                        {webhookConfig && (
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
                                <div>
                                    <h2 className="text-lg font-bold">{tx("🔗 חיבור פלטפורמות — Meta Webhook")}</h2>
                                    <p className="text-slate-400 text-sm mt-1">{tx("הכנס את הפרטים האלה בקונסול Meta Developer כדי לקבל הודעות מ-WhatsApp, Facebook ו-Instagram.")}</p>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-slate-400 block mb-1.5">{tx("Callback URL (הכנס ב-Meta → Webhooks)")}</label>
                                        <div className="flex gap-2">
                                            <input readOnly value={webhookConfig.webhook_url} dir="ltr"
                                                className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono" />
                                            <button onClick={() => navigator.clipboard.writeText(webhookConfig.webhook_url)}
                                                className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs text-slate-300 transition-colors">{tx("העתק")}</button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 block mb-1.5">{tx("Verify Token (הכנס ב-Meta → Webhooks)")}</label>
                                        <div className="flex gap-2">
                                            <input readOnly value={webhookConfig.verify_token} dir="ltr"
                                                className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono" />
                                            <button onClick={() => navigator.clipboard.writeText(webhookConfig.verify_token)}
                                                className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs text-slate-300 transition-colors">{tx("העתק")}</button>
                                        </div>
                                    </div>
                                </div>

                                {/* Platform connection status */}
                                <div>
                                    <div className="text-xs text-slate-400 mb-3">{tx("פלטפורמות מחוברות — BizControl")}</div>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { icon: "💬", name: "WhatsApp", connected: !!platformSettings?.whatsapp_phone_id, detail: platformSettings?.whatsapp_phone_id ? `ID: ${platformSettings.whatsapp_phone_id}` : tx("לא מוגדר") },
                                            { icon: "📘", name: "Facebook", connected: false, detail: tx("הגדר Page ID בסטודיו") },
                                            { icon: "📸", name: "Instagram", connected: false, detail: tx("הגדר Account ID בסטודיו") },
                                        ].map(p => (
                                            <div key={p.name} className={`rounded-xl p-3 border text-center ${p.connected ? "bg-green-900/20 border-green-500/30" : "bg-white/5 border-white/10"}`}>
                                                <div className="text-2xl mb-1">{p.icon}</div>
                                                <div className="text-xs font-semibold text-white">{p.name}</div>
                                                <div className={`text-xs mt-1 ${p.connected ? "text-green-400" : "text-slate-500"}`}>
                                                    {p.connected ? tx("✅ מחובר") : tx("⚪ לא מחובר")}
                                                </div>
                                                <div className="text-xs text-slate-600 mt-0.5 truncate">{p.detail}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Instructions */}
                                <details className="group">
                                    <summary className="text-xs text-blue-300 cursor-pointer hover:text-blue-200 transition-colors">{tx("📋 הוראות חיבור ב-Meta Developer Console")}</summary>
                                    <ol className="mt-3 space-y-2 text-xs text-slate-400 list-decimal list-inside leading-relaxed">
                                        <li>{tx("כנס ל-")}<span className="text-blue-300">developers.facebook.com</span>{tx(" → האפליקציה שלך")}</li>
                                        <li>{tx("בתפריט שמאל: ")}<strong className="text-slate-300">WhatsApp → Configuration</strong>{tx(" (או Messenger/Instagram)")}</li>
                                        <li>{tx("לחץ ")}<strong className="text-slate-300">Edit</strong>{tx(" ב-Webhook")}</li>
                                        <li>{tx("הכנס את ה-")}<strong className="text-slate-300">Callback URL</strong>{tx(" וה-")}<strong className="text-slate-300">Verify Token</strong>{tx(" מלמעלה")}</li>
                                        <li>{tx("לחץ ")}<strong className="text-slate-300">Verify and Save</strong></li>
                                        <li>{tx("עבור לטאב ")}<strong className="text-slate-300">Webhook Fields</strong>{tx(" → Subscribe ל: ")}<code className="bg-white/10 px-1 rounded">messages</code></li>
                                        <li>{tx("חזור על הפעולה עבור כל פלטפורמה (WhatsApp, Messenger, Instagram)")}</li>
                                        <li>{tx("הוסף ")}<code className="bg-white/10 px-1 rounded">META_WEBHOOK_VERIFY_TOKEN</code>{tx(" ו-")}<code className="bg-white/10 px-1 rounded">BACKEND_URL</code>{tx(" ב-Railway Environment Variables")}</li>
                                    </ol>
                                </details>
                            </div>
                        )}

                        {/* ══ UNIFIED WHATSAPP PLATFORM CARD ══ */}
                        <div className="bg-gradient-to-br from-emerald-900/30 to-slate-900/50 border border-emerald-500/40 rounded-2xl p-6 space-y-5">
                            {/* Header */}
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-2xl">💬</div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">{tx("WhatsApp מרכזי — BizControl")}</h2>
                                    <p className="text-slate-400 text-sm mt-0.5">{tx("מספר אחד לכל הפלטפורמה — OTP, הודעות, וסטודיואים ללא מספר משלהם")}</p>
                                </div>
                            </div>

                            {/* Status */}
                            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold ${platformWAInstance && platformWATokenSet ? "bg-emerald-900/40 border-emerald-500/40 text-emerald-300" : "bg-amber-900/20 border-amber-500/30 text-amber-300"}`}>
                                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${platformWAInstance && platformWATokenSet ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                                {platformWAInstance && platformWATokenSet
                                    ? tx("✅ מחובר — Instance: {0}", { 0: platformWAInstance })
                                    : tx("⚠️ לא מוגדר — הגדר Instance ID ו-Token")}
                            </div>

                            {/* Credentials */}
                            <div className="grid grid-cols-1 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1.5">🔑 Instance ID <span className="text-slate-500 font-normal">{tx("(מ-green-api.com)")}</span></label>
                                    <input value={platformWAInstance} onChange={e => setPlatformWAInstance(e.target.value)}
                                        placeholder="7107619924" dir="ltr"
                                        className="w-full bg-black/30 border border-white/15 rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                                        🔐 API Token {platformWATokenSet && <span className="text-emerald-400 font-normal ms-1">{tx("✓ שמור")}</span>}
                                    </label>
                                    <PasswordInput value={platformWAToken} onChange={e => setPlatformWAToken(e.target.value)}
                                        dir="ltr"
                                        iconClassName="text-white/70 hover:text-white"
                                        placeholder={platformWATokenSet ? tx("השאר ריק כדי לשמור על הToken הקיים") : tx("הדבק את ה-API Token מ-Green API...")}
                                        className="w-full bg-black/30 border border-white/15 rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400" />
                                </div>
                            </div>

                            {/* What this number does */}
                            <div className="bg-black/20 rounded-xl p-4 space-y-2">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{tx("המספר הזה ישמש ל:")}</div>
                                {[
                                    [tx("📲 OTP ב-BizFind"), tx("קודי אימות ללקוחות שנרשמים לאתר")],
                                    [tx("📩 סטודיואים ללא WhatsApp"), tx("הודעות תזכורות ואוטומציה עבורם")],
                                    [tx("🔔 הודעות מערכת"), tx("שליחות פלטפורמה כלליות")],
                                ].map(([title, desc]) => (
                                    <div key={title} className="flex items-start gap-2">
                                        <span className="text-emerald-400 text-xs mt-0.5">✓</span>
                                        <div>
                                            <span className="text-white text-xs font-semibold">{title}</span>
                                            <span className="text-slate-500 text-xs ms-1">— {desc}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Hint when token not yet saved */}
                            {!platformWATokenSet && !platformWAToken.trim() && platformWAInstance.trim() && (
                                <div className="text-xs text-slate-400 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5">
                                    {tx("💡 Instance ID ישמר. הוסף גם API Token כדי להפעיל שליחת הודעות.")}
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={handleSavePlatformGreenAPI}
                                disabled={platformWASaving || !platformWAInstance.trim()}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black py-3 rounded-xl text-sm transition-colors shadow-lg shadow-emerald-900/40"
                            >
                                {platformWASaving ? tx("שומר...") : tx("💾 שמור והפעל")}
                            </button>

                            {/* Test */}
                            {platformWAInstance && platformWATokenSet && (
                                <div className="border-t border-white/10 pt-4">
                                    <div className="text-xs text-slate-400 mb-2">{tx("בדוק שהמספר עובד — שלח הודעת טסט:")}</div>
                                    <div className="flex gap-2">
                                        <input value={platformWATestPhone} onChange={e => { setPlatformWATestPhone(e.target.value); setPlatformWATestResult(null); }}
                                            placeholder="050-0000000" type="tel" dir="ltr"
                                            className="flex-1 bg-black/30 border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30" />
                                        <button type="button" onClick={handleTestPlatformGreenAPI} disabled={!platformWATestPhone.trim()}
                                            className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors">
                                            {tx("שלח טסט")}
                                        </button>
                                    </div>
                                    {platformWATestResult && (
                                        <div className={`text-sm px-4 py-2.5 rounded-xl mt-2 break-all whitespace-pre-wrap ${platformWATestResult.ok ? "bg-emerald-900/40 text-emerald-300" : "bg-red-900/40 text-red-300"}`} dir="ltr">
                                            {platformWATestResult.msg}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Change Password Card */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                            <div>
                                <h2 className="text-lg font-bold">{tx("🔐 שינוי סיסמה")}</h2>
                                <p className="text-slate-400 text-sm mt-1">{tx("שנה את סיסמת חשבון הסופר-אדמין שלך.")}</p>
                            </div>
                            <ChangePasswordForm tone="dark" />
                        </div>
                    </div>
                )}

                {/* BizFind's settings — the clients' site and app: its look, its home page, the stores, sign-in codes */}
                {tab === "bizfind" && (
                    <div className="max-w-2xl space-y-6">
                        <BizFindDesign />

                        <BizFindHero />

                        <BizFindStoreLinks />

                        {/* BizFind OTP WhatsApp Card */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-xl">💬</div>
                                <div>
                                    <h2 className="text-lg font-bold">{tx("BizFind — WhatsApp לשליחת OTP")}</h2>
                                    <p className="text-slate-400 text-sm mt-0.5">{tx("OTP נשלח ללקוחות BizFind בעת הרשמה, מהמספר המרכזי של הפלטפורמה.")}</p>
                                </div>
                            </div>

                            {/* Platform status only */}
                            <div className={`flex items-start gap-3 px-4 py-4 rounded-xl text-sm border ${platformWAInstance && platformWATokenSet ? "bg-emerald-900/30 border-emerald-500/30 text-emerald-300" : "bg-amber-900/20 border-amber-500/30 text-amber-300"}`}>
                                <span className="text-lg mt-0.5">{platformWAInstance && platformWATokenSet ? "✅" : "⚠️"}</span>
                                <div>
                                    <div className="font-bold">
                                        {platformWAInstance && platformWATokenSet
                                            ? tx("מחובר — Instance: {0}", { 0: platformWAInstance })
                                            : tx("לא מוגדר — הגדר Platform Green API למעלה")}
                                    </div>
                                    <div className="text-xs opacity-70 mt-1">
                                        {platformWAInstance && platformWATokenSet
                                            ? tx("OTP יישלח ממספר הפלטפורמה אוטומטית — הכל תקין ✓")
                                            : tx("יש להגדיר Platform Green API כדי לשלוח OTP")}
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* The rest of BizFind's screens */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
                            <h2 className="text-lg font-bold">{tx("עוד ב-BizFind")}</h2>
                            <div className="flex flex-wrap gap-2">
                                {([["/admin/review-reports", tx("ביקורות שדווחו")], ["/admin/business-import", tx("ייבוא עסקים למדריך")], ["/admin/business-types", tx("תחומי עסק")]] as const).map(([href, label]) => (
                                    <a key={href} href={href} className="px-4 py-2 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 text-slate-200">{label}</a>
                                ))}
                            </div>
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
                                    {st === "clients" ? tx("👥 לקוחות") : tx("📅 תורים")}
                                </button>
                            ))}
                        </div>

                        {/* Clients sub-tab */}
                        {contactsSubTab === "clients" && (
                            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                                <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3">
                                    <h2 className="font-bold text-lg flex-1">{tx("כל הלקוחות (")}{contacts.length})</h2>
                                    <input
                                        placeholder={tx("חיפוש שם / טלפון / אימייל...")}
                                        value={contactsSearch}
                                        onChange={e => { setContactsSearch(e.target.value); loadContacts(e.target.value); }}
                                        className="bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30 w-64"
                                    />
                                    <button onClick={() => loadContacts()} className="text-xs text-slate-400 hover:text-white transition-colors">{tx("↻ רענן")}</button>
                                </div>
                                {contactsLoading ? (
                                    <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-white/20 border-t-white rounded-full" /></div>
                                ) : contacts.length === 0 ? (
                                    <div className="text-center text-slate-500 py-12">{tx("אין לקוחות")}</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase">
                                                    <th className="text-start px-6 py-3 font-medium">{tx("שם")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("טלפון")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("אימייל")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("סטודיו")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("הצטרף")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("סטטוס")}</th>
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
                                                            {new Date(c.created_at).toLocaleDateString(intl())}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`text-xs px-2 py-0.5 rounded-full ${c.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                                                {c.is_active ? tx("פעיל") : tx("לא פעיל")}
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
                                    <h2 className="font-bold text-lg flex-1">{tx("כל התורים (")}{appts.length})</h2>
                                    <input
                                        placeholder={tx("חיפוש שם / טלפון...")}
                                        value={apptsSearch}
                                        onChange={e => { setApptsSearch(e.target.value); loadAppts(e.target.value, apptsStatus); }}
                                        className="bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30 w-52"
                                    />
                                    <select
                                        value={apptsStatus}
                                        onChange={e => { setApptsStatus(e.target.value); loadAppts(apptsSearch, e.target.value); }}
                                        className="bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white outline-none scheme-dark"
                                    >
                                        <option value="" style={OPTION_STYLE}>{tx("כל הסטטוסים")}</option>
                                        <option value="scheduled" style={OPTION_STYLE}>{tx("מתוכנן")}</option>
                                        <option value="done" style={OPTION_STYLE}>{tx("הסתיים")}</option>
                                        <option value="canceled" style={OPTION_STYLE}>{tx("בוטל")}</option>
                                        <option value="no_show" style={OPTION_STYLE}>{tx("לא הגיע")}</option>
                                    </select>
                                    <button onClick={() => loadAppts()} className="text-xs text-slate-400 hover:text-white transition-colors">{tx("↻ רענן")}</button>
                                </div>
                                {apptsLoading ? (
                                    <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-white/20 border-t-white rounded-full" /></div>
                                ) : appts.length === 0 ? (
                                    <div className="text-center text-slate-500 py-12">{tx("אין תורים")}</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase">
                                                    <th className="text-start px-6 py-3 font-medium">{tx("לקוח")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("טלפון")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("שירות")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("סטודיו")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("תאריך ושעה")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("סטטוס")}</th>
                                                    <th className="text-start px-4 py-3 font-medium">{tx("מחיר")}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {appts.map(a => {
                                                    const statusMap: Record<string, { label: string; color: string }> = {
                                                        scheduled: { label: tx("מתוכנן"), color: "bg-blue-500/20 text-blue-300" },
                                                        done: { label: tx("הסתיים"), color: "bg-emerald-500/20 text-emerald-400" },
                                                        canceled: { label: tx("בוטל"), color: "bg-red-500/20 text-red-400" },
                                                        no_show: { label: tx("לא הגיע"), color: "bg-amber-500/20 text-amber-400" },
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
                                                                {new Date(a.starts_at).toLocaleString(intl(), { dateStyle: "short", timeStyle: "short" })}
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
                            {/* Open full page button */}
                            <button onClick={() => router.push("/admin/leads")}
                                className="w-full text-center text-xs text-slate-400 hover:text-white border border-white/10 rounded-xl py-1.5 transition-colors">
                                {tx("↗ פתח אינבוקס מלא")}
                            </button>
                            {/* Filters */}
                            <div className="flex gap-2">
                                <input
                                    placeholder={tx("חיפוש שם / טלפון...")}
                                    value={leadsFilter.search}
                                    onChange={e => { const f = { ...leadsFilter, search: e.target.value }; setLeadsFilter(f); loadLeads(f); }}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30"
                                />
                            </div>
                            <div className="flex gap-2">
                                <select value={leadsFilter.source} onChange={e => { const f = { ...leadsFilter, source: e.target.value }; setLeadsFilter(f); loadLeads(f); }}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white outline-none scheme-dark">
                                    <option value="" style={OPTION_STYLE}>{tx("כל המקורות")}</option>
                                    <option value="whatsapp" style={OPTION_STYLE}>WhatsApp</option>
                                    <option value="facebook" style={OPTION_STYLE}>Facebook</option>
                                    <option value="instagram" style={OPTION_STYLE}>Instagram</option>
                                    <option value="manual" style={OPTION_STYLE}>{tx("ידני")}</option>
                                </select>
                                <select value={leadsFilter.status} onChange={e => { const f = { ...leadsFilter, status: e.target.value }; setLeadsFilter(f); loadLeads(f); }}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white outline-none scheme-dark">
                                    <option value="" style={OPTION_STYLE}>{tx("כל הסטטוסים")}</option>
                                    <option value="new" style={OPTION_STYLE}>{tx("חדש")}</option>
                                    <option value="contacted" style={OPTION_STYLE}>{tx("נענה")}</option>
                                    <option value="interested" style={OPTION_STYLE}>{tx("מעוניין")}</option>
                                    <option value="booked" style={OPTION_STYLE}>{tx("נקבע תור")}</option>
                                    <option value="lost" style={OPTION_STYLE}>{tx("אבוד")}</option>
                                </select>
                            </div>

                            {/* Lead list */}
                            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pe-1">
                                {leadsLoading && <div className="text-slate-400 text-sm text-center py-8">{tx("טוען...")}</div>}
                                {!leadsLoading && leads.length === 0 && <div className="text-slate-500 text-sm text-center py-8">{tx("אין לידים")}</div>}
                                {leads.map(lead => {
                                    const srcIcon = lead.source === "whatsapp" ? "💬" : lead.source === "facebook" ? "📘" : lead.source === "instagram" ? "📸" : "✏️";
                                    const statusColor = lead.status === "new" ? "bg-blue-500/20 text-blue-300" : lead.status === "contacted" ? "bg-yellow-500/20 text-yellow-300" : lead.status === "interested" ? "bg-orange-500/20 text-orange-300" : lead.status === "booked" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300";
                                    const statusLabel = lead.status === "new" ? tx("חדש") : lead.status === "contacted" ? tx("נענה") : lead.status === "interested" ? tx("מעוניין") : lead.status === "booked" ? tx("נקבע תור") : tx("אבוד");
                                    return (
                                        <button key={lead.id} onClick={() => { setSelectedLead(lead); setLeadNote(lead.notes || ""); }}
                                            className={`w-full text-start rounded-xl p-3 border transition-all ${selectedLead?.id === lead.id ? "bg-white/15 border-white/30" : "bg-white/5 border-white/10 hover:bg-white/10"}`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs text-slate-400">{srcIcon} {lead.studio_name}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>{statusLabel}</span>
                                            </div>
                                            <div className="font-semibold text-sm text-white truncate">{lead.name}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">{lead.phone || lead.email || "—"}</div>
                                            <div className="text-xs text-slate-600 mt-0.5">{new Date(lead.created_at).toLocaleDateString(intl())}</div>
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
                                    <p className="text-sm">{tx("בחר ליד מהרשימה לצפייה בפרטים")}</p>
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    {/* Header */}
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h2 className="text-xl font-bold text-white">{selectedLead.name}</h2>
                                            <p className="text-sm text-slate-400 mt-0.5">
                                                {selectedLead.source === "whatsapp" ? "💬 WhatsApp" : selectedLead.source === "facebook" ? "📘 Facebook" : selectedLead.source === "instagram" ? "📸 Instagram" : tx("✏️ ידני")}
                                                {" · "}{tx("סטודיו: ")}<span className="text-slate-300">{selectedLead.studio_name}</span>
                                            </p>
                                        </div>
                                        <div className="text-xs text-slate-500">{new Date(selectedLead.created_at).toLocaleString(intl())}</div>
                                    </div>

                                    {/* Contact Info */}
                                    <div className="grid grid-cols-2 gap-3">
                                        {selectedLead.phone && (
                                            <div className="bg-white/5 rounded-xl px-4 py-3">
                                                <div className="text-xs text-slate-500 mb-1">{tx("טלפון")}</div>
                                                <div className="text-sm text-white font-mono">{selectedLead.phone}</div>
                                            </div>
                                        )}
                                        {selectedLead.email && (
                                            <div className="bg-white/5 rounded-xl px-4 py-3">
                                                <div className="text-xs text-slate-500 mb-1">{tx("אימייל")}</div>
                                                <div className="text-sm text-white">{selectedLead.email}</div>
                                            </div>
                                        )}
                                        {selectedLead.service_interest && (
                                            <div className="bg-white/5 rounded-xl px-4 py-3">
                                                <div className="text-xs text-slate-500 mb-1">{tx("עניין בשירות")}</div>
                                                <div className="text-sm text-white">{selectedLead.service_interest}</div>
                                            </div>
                                        )}
                                        {selectedLead.campaign_name && (
                                            <div className="bg-white/5 rounded-xl px-4 py-3">
                                                <div className="text-xs text-slate-500 mb-1">{tx("קמפיין")}</div>
                                                <div className="text-sm text-white">{selectedLead.campaign_name}</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Status */}
                                    <div>
                                        <div className="text-xs text-slate-400 mb-2">{tx("סטטוס טיפול")}</div>
                                        <div className="flex flex-wrap gap-2">
                                            {[
                                                { v: "new", label: tx("חדש"), color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
                                                { v: "contacted", label: tx("נענה"), color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
                                                { v: "interested", label: tx("מעוניין"), color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
                                                { v: "booked", label: tx("✅ נקבע תור"), color: "bg-green-500/20 text-green-300 border-green-500/30" },
                                                { v: "lost", label: tx("❌ אבוד"), color: "bg-red-500/20 text-red-300 border-red-500/30" },
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
                                        <div className="text-xs text-slate-400 mb-2">{tx("הערות פנימיות")}</div>
                                        <textarea
                                            value={leadNote}
                                            onChange={e => setLeadNote(e.target.value)}
                                            rows={4}
                                            placeholder={tx("הוסף הערה על הליד...")}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/30 resize-none"
                                        />
                                        <button
                                            onClick={handleLeadNoteSave}
                                            disabled={leadSaving || leadNote === (selectedLead.notes || "")}
                                            className="mt-2 px-4 py-2 bg-white text-slate-900 text-sm font-bold rounded-xl hover:bg-slate-100 disabled:opacity-40 transition-colors"
                                        >
                                            {leadSaving ? tx("שומר...") : tx("שמור הערה")}
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
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90dvh] flex flex-col">
                        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
                            <h3 className="font-bold text-lg">{tx("✏️ עריכת סטודיו — ")}{editModal.name}</h3>
                            <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>
                        {editErr && <div className="mx-6 mb-2 text-sm text-red-400 bg-red-900/30 border border-red-500/20 rounded-xl px-3 py-2 flex-shrink-0">⚠️ {editErr}</div>}
                        <div className="overflow-y-auto flex-1 min-h-0 px-6 pb-2 space-y-5">
                            <div>
                                <p className="text-xs text-slate-400 mb-3 font-semibold uppercase tracking-wide">{tx("פרטי הסטודיו")}</p>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("שם הסטודיו")}</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                            value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("Slug (מזהה ייחודי)")}</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30 font-mono" dir="ltr"
                                            value={editForm.slug} onChange={e => setEditForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s/g, "-") }))} />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 mb-3 font-semibold uppercase tracking-wide">{tx("פרטי בעל העסק")}</p>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("שם בעלים (השאר ריק לאי-שינוי)")}</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                            value={editForm.owner_display_name} onChange={e => setEditForm(f => ({ ...f, owner_display_name: e.target.value }))} placeholder={tx("שם נוכחי")} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("אימייל בעלים")}</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                            type="email" value={editForm.owner_email} onChange={e => setEditForm(f => ({ ...f, owner_email: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("טלפון בעלים (WhatsApp)")}</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                            type="tel" value={editForm.owner_phone} onChange={e => setEditForm(f => ({ ...f, owner_phone: e.target.value }))} placeholder="972521234567" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3 p-6 pt-4 flex-shrink-0">
                            <button onClick={handleEditSave} disabled={editSaving || !editForm.name || !editForm.slug}
                                className="flex-1 bg-white text-slate-900 font-bold py-2.5 rounded-xl hover:bg-slate-100 disabled:opacity-40 transition-colors">
                                {editSaving ? tx("שומר...") : tx("💾 שמור שינויים")}
                            </button>
                            <button onClick={() => setEditModal(null)} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors">{tx("ביטול")}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Users Management Modal */}
            {usersModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col">
                        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
                            <h3 className="font-bold text-lg">{tx("👤 משתמשי הסטודיו — ")}{usersModal.name}</h3>
                            <button onClick={() => { setUsersModal(null); setEditingUser(null); }} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>
                        <div className="overflow-y-auto flex-1 min-h-0 px-6 pb-6 space-y-5">
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
                                                        {u.role === "owner" ? tx("בעלים") : u.role === "admin" ? tx("מנהל") : u.role === "artist" ? tx("נותן/ת שירות") : tx("צוות")}
                                                    </span>
                                                    {!u.is_active && <span className="text-xs text-red-400">{tx("מושבת")}</span>}
                                                </div>
                                                <div className="text-xs text-slate-400 mt-0.5" dir="ltr">{u.email}</div>
                                                {u.phone && <div className="text-xs text-slate-500 font-mono">{u.phone}</div>}
                                            </div>
                                            <div className="flex gap-1.5 flex-shrink-0">
                                                <button onClick={() => { setEditingUser(u); setEditUserForm({ display_name: u.display_name, email: u.email, role: u.role, phone: u.phone || "", is_active: u.is_active }); }}
                                                    className="text-xs bg-indigo-600/30 hover:bg-indigo-600/60 text-indigo-300 px-2.5 py-1.5 rounded-lg transition-colors">{tx("ערוך")}</button>
                                                <button onClick={() => handleResetPassword(u)} disabled={resetingPw === u.id}
                                                    className="text-xs bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40">
                                                    {resetingPw === u.id ? "..." : tx("🔑 סיסמה")}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Edit user inline */}
                            {editingUser && (
                                <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-xl p-4 space-y-3">
                                    <p className="text-sm font-bold text-indigo-300">{tx("עריכת ")}{editingUser.display_name}</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs text-slate-400 mb-1 block">{tx("שם")}</label>
                                            <input className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30"
                                                value={editUserForm.display_name} onChange={e => setEditUserForm(f => ({ ...f, display_name: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 mb-1 block">{tx("אימייל")}</label>
                                            <input className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30" dir="ltr"
                                                value={editUserForm.email} onChange={e => setEditUserForm(f => ({ ...f, email: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 mb-1 block">{tx("תפקיד")}</label>
                                            <select className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none scheme-dark"
                                                value={editUserForm.role} onChange={e => setEditUserForm(f => ({ ...f, role: e.target.value }))}>
                                                <option value="owner" style={OPTION_STYLE}>{tx("בעלים")}</option>
                                                <option value="admin" style={OPTION_STYLE}>{tx("מנהל")}</option>
                                                <option value="artist" style={OPTION_STYLE}>{tx("נותן/ת שירות")}</option>
                                                <option value="staff" style={OPTION_STYLE}>{tx("צוות")}</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 mb-1 block">{tx("טלפון")}</label>
                                            <input className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30" dir="ltr"
                                                value={editUserForm.phone} onChange={e => setEditUserForm(f => ({ ...f, phone: e.target.value }))} />
                                        </div>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input type="checkbox" checked={editUserForm.is_active} onChange={e => setEditUserForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 accent-indigo-400" />
                                        <span className="text-slate-300">{tx("משתמש פעיל")}</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <button onClick={handleSaveUser} disabled={savingUser}
                                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-2 rounded-lg transition-colors disabled:opacity-40">
                                            {savingUser ? tx("שומר...") : tx("💾 שמור")}
                                        </button>
                                        <button onClick={() => setEditingUser(null)} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors">{tx("ביטול")}</button>
                                    </div>
                                </div>
                            )}

                            {/* Add new user */}
                            <div className="border-t border-white/10 pt-4 space-y-3">
                                <p className="text-sm font-bold text-slate-300">{tx("+ הוסף משתמש חדש")}</p>
                                {addUserErr && <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2">⚠️ {addUserErr}</div>}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("שם")}</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white/30"
                                            value={addUserForm.display_name} onChange={e => setAddUserForm(f => ({ ...f, display_name: e.target.value }))} placeholder={tx("ישראל ישראלי")} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("אימייל")}</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white/30" dir="ltr"
                                            type="email" value={addUserForm.email} onChange={e => setAddUserForm(f => ({ ...f, email: e.target.value }))} placeholder="user@studio.com" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("תפקיד")}</label>
                                        <select className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none scheme-dark"
                                            value={addUserForm.role} onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value }))}>
                                            <option value="admin" style={OPTION_STYLE}>{tx("מנהל")}</option>
                                            <option value="artist" style={OPTION_STYLE}>{tx("נותן/ת שירות")}</option>
                                            <option value="staff" style={OPTION_STYLE}>{tx("צוות")}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 mb-1 block">{tx("טלפון (אופציונלי)")}</label>
                                        <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white/30" dir="ltr"
                                            type="tel" value={addUserForm.phone} onChange={e => setAddUserForm(f => ({ ...f, phone: e.target.value }))} placeholder="972521234567" />
                                    </div>
                                </div>
                                <button onClick={handleAddUser} disabled={addingUser || !addUserForm.email || !addUserForm.display_name}
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-2.5 rounded-xl transition-colors disabled:opacity-40">
                                    {addingUser ? tx("מוסיף...") : tx("✅ הוסף משתמש ושלח הזמנה")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center text-xl">🗑️</div>
                            <div>
                                <h3 className="font-bold text-lg text-white">{tx("מחיקת סטודיו")}</h3>
                                <p className="text-sm text-slate-400">{deleteModal.name}</p>
                            </div>
                        </div>
                        <p className="text-sm text-slate-300 mb-5 leading-relaxed">
                            {tx("פעולה זו")} <strong className="text-red-400">{tx("בלתי הפיכה")}</strong> {tx("— כל הנתונים, הלקוחות, התורים וההיסטוריה של הסטודיו יימחקו לצמיתות.")}
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
                                {deleting ? tx("מוחק...") : tx("כן, מחק לצמיתות")}
                            </button>
                            <button
                                onClick={() => { setDeleteModal(null); setDeleteErr(null); }}
                                disabled={deleting}
                                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors disabled:opacity-50"
                            >
                                {tx("ביטול")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Extend / Trial Modal */}
            {extendModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm p-6">
                        <div className="flex items-center justify-between mb-1">
                            <h3 className="font-bold text-lg">{tx("הארכת מנוי")}</h3>
                            <button onClick={() => setExtendModal(null)} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>
                        <p className="text-slate-400 text-sm mb-5">{extendModal.studio.name}{tx(" — בחר לכמה ימים מהיום")}</p>

                        <div className="grid grid-cols-4 gap-2 mb-4">
                            {[7, 14, 30, 90].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setExtendDays(d)}
                                    className={`py-3 rounded-xl text-sm font-bold transition-all ${extendDays === d ? "bg-white text-slate-900" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}
                                >
                                    {d} {tx("ימים")}
                                </button>
                            ))}
                        </div>

                        <div className="mb-4">
                            <label className="text-xs text-slate-400 mb-1 block">{tx("מספר ימים מותאם:")}</label>
                            <input
                                type="number" min={1} max={365} dir="ltr"
                                value={extendDays}
                                onChange={e => setExtendDays(Number(e.target.value))}
                                className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                            />
                        </div>

                        <div className="bg-white/5 rounded-xl px-4 py-3 mb-5 text-sm">
                            <div className="text-slate-400 text-xs mb-1">{tx("תאריך פקיעה חדש:")}</div>
                            <div className="font-bold text-emerald-400">
                                {new Date(Date.now() + extendDays * 86400000).toLocaleDateString(intl(), { day: "numeric", month: "long", year: "numeric" })}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleExtendSubmit}
                                disabled={extending || extendDays < 1}
                                className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl transition-colors"
                            >
                                {extending ? tx("מעדכן...") : tx("✅ הענק {0} ימים", { 0: extendDays })}
                            </button>
                            <button onClick={() => setExtendModal(null)} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors">
                                {tx("ביטול")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Studio Modal */}
            {showNew && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90dvh] flex flex-col">
                        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
                            <h3 className="font-bold text-lg">{tx("הקמת סטודיו חדש")}</h3>
                            <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>

                        {createErr && (
                            <div className="mx-6 mb-2 text-sm text-red-400 bg-red-900/30 border border-red-500/20 rounded-xl px-3 py-2 flex-shrink-0">⚠️ {createErr}</div>
                        )}

                        <div className="overflow-y-auto flex-1 min-h-0 px-6 pb-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">{tx("שם הסטודיו")}</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                        value={form.studio_name} onChange={e => setForm(f => ({ ...f, studio_name: e.target.value }))} placeholder={tx("סטודיו XYZ")} />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">{tx("Slug (ייחודי)")}</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30 font-mono" dir="ltr"
                                        value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s/g, "-") }))} placeholder="studio-xyz" />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">{tx("שם בעל העסק")}</label>
                                <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
                                    value={form.owner_display_name} onChange={e => setForm(f => ({ ...f, owner_display_name: e.target.value }))} placeholder={tx("ישראל ישראלי")} />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">{tx("מייל בעלים")}</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                        type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="owner@studio.com" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">{tx("סיסמה ראשונית")}</label>
                                    <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                        type="text" value={form.owner_password} onChange={e => setForm(f => ({ ...f, owner_password: e.target.value }))} placeholder="password123" />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">{tx("טלפון בעלים (WhatsApp) — אופציונלי")}</label>
                                <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30" dir="ltr"
                                    type="tel" value={form.owner_phone} onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))} placeholder="972521234567" />
                                <p className="text-xs text-slate-500 mt-0.5">{tx("פורמט בינלאומי ללא + (לשליחת פרטי כניסה ב-WhatsApp)")}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">{tx("תוכנית")}</label>
                                    <select className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30 scheme-dark"
                                        value={form.subscription_plan} onChange={e => setForm(f => ({ ...f, subscription_plan: e.target.value }))}>
                                        <option value="starter" style={OPTION_STYLE}>{tx("Starter — 99₪/חודש")}</option>
                                        <option value="pro" style={OPTION_STYLE}>{tx("Pro — 199₪/חודש")}</option>
                                        <option value="studio" style={OPTION_STYLE}>{tx("Studio — 349₪/חודש")}</option>
                                        <option value="free" style={OPTION_STYLE}>{tx("חינמי")}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 mb-1 block">{tx("ימי מנוי ראשוניים")}</label>
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
                                {creating ? tx("יוצר...") : tx("צור סטודיו")}
                            </button>
                            <button onClick={() => setShowNew(false)} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors">
                                {tx("ביטול")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

                {/* ── Health Alerts Tab ── */}
                {tab === "health" && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-white">{tx("🚨 התראות מערכת")}</h2>
                            <button
                                onClick={() => { setHealthData(null); setHealthLoading(true); apiFetch<typeof healthData>("/api/admin/health").then(d => setHealthData(d)).catch(() => {}).finally(() => setHealthLoading(false)); }}
                                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-xl transition-colors"
                            >
                                {tx("🔄 רענן")}
                            </button>
                        </div>
                        {/* Manual birthday sweep */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-4 space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-3">
                                <div>
                                    <div className="font-bold text-white text-sm">{tx("🎂 שליחת הודעות יומולדת ידנית")}</div>
                                    <div className="text-xs text-slate-400 mt-0.5">{tx("שולח לכל חברי מועדון עם יומולדת בחודש הבא (מונע כפילויות)")}</div>
                                </div>
                                <button
                                    type="button"
                                    disabled={birthdaySweeping}
                                    onClick={async () => {
                                        setBirthdaySweeping(true);
                                        setBirthdaySweepResult(null);
                                        try {
                                            const res = await apiFetch<{ ok: boolean; messages_enqueued: number }>("/api/admin/sweep-birthday-messages", { method: "POST" });
                                            setBirthdaySweepResult(res);
                                        } catch {
                                            setBirthdaySweepResult({ ok: false, messages_enqueued: 0 });
                                        } finally {
                                            setBirthdaySweeping(false);
                                        }
                                    }}
                                    className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
                                >
                                    {birthdaySweeping ? tx("שולח...") : tx("שלח עכשיו")}
                                </button>
                            </div>
                            {birthdaySweepResult && (
                                <div className={`text-sm font-semibold ${birthdaySweepResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                                    {birthdaySweepResult.ok
                                        ? tx("✅ נשלחו {0} הודעות בהצלחה", { 0: birthdaySweepResult.messages_enqueued })
                                        : tx("❌ שגיאה בשליחה")}
                                </div>
                            )}
                        </div>

                        {healthLoading && <p className="text-slate-400 text-sm">{tx("בודק סטטוס...")}</p>}
                        {healthData && (
                            <>
                                {healthData.filter(s => s.has_alert).length === 0 && (
                                    <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-2xl px-6 py-4 text-emerald-300 font-semibold">
                                        {tx("✅ כל המערכות תקינות — אין התראות פעילות")}
                                    </div>
                                )}
                                <div className="space-y-3">
                                    {healthData.map(s => (
                                        <div key={s.studio_id} className={`rounded-2xl border px-5 py-4 ${s.has_alert ? "bg-red-900/30 border-red-500/30" : "bg-white/5 border-white/10"}`}>
                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                                <div>
                                                    <span className="font-bold text-white text-sm">{s.studio_name}</span>
                                                    {/* WhatsApp connection details */}
                                                    {(s.wa_instance_id || s.wa_phone_id) && (
                                                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                                            {s.wa_provider === "green_api" && s.wa_instance_id && `🔗 Instance: ${s.wa_instance_id}`}
                                                            {s.wa_provider === "meta" && s.wa_phone_id && `📞 Phone ID: ${s.wa_phone_id}`}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex gap-2 flex-wrap items-center">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${s.wa_status === "connected" ? "bg-emerald-700/50 text-emerald-300" : s.wa_status === "not_configured" ? "bg-slate-700/50 text-slate-400" : "bg-red-700/50 text-red-300"}`}>
                                                        📱 {s.wa_status === "connected" ? tx("WhatsApp מחובר") : s.wa_status === "not_configured" ? tx("WhatsApp לא מוגדר") : tx("WhatsApp מנותק: {0}", { 0: s.wa_status.replace("disconnected:", "") })}
                                                    </span>
                                                    {s.failed_jobs_24h > 0 && (
                                                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-orange-700/50 text-orange-300">
                                                            ⚠️ {s.failed_jobs_24h} {tx("הודעות נכשלו (24ש׳)")}
                                                        </span>
                                                    )}
                                                    {s.stuck_pending_jobs > 0 && (
                                                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-yellow-700/50 text-yellow-300">
                                                            ⏳ {s.stuck_pending_jobs} {tx("הודעות תקועות")}
                                                        </span>
                                                    )}
                                                    {!s.has_alert && (
                                                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-700/50 text-emerald-300">{tx("✅ תקין")}</span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => router.push(`/admin/studios/${s.studio_id}`)}
                                                        className="text-xs px-2 py-1 rounded-full bg-white/10 text-slate-300 hover:bg-white/20 transition-colors"
                                                    >
                                                        {tx("⚙️ ערוך")}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

        </div>
    );
}

