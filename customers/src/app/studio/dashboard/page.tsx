"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

interface StudioProfile {
    studio_id: string; slug: string; name: string; business_type: string;
    logo_url?: string; primary_color: string; subscription_plan: string;
    cover_url?: string; gallery_count: number;
    marketplace_visible: boolean;
    description?: string; city?: string; phone?: string; address?: string;
    map_link?: string; instagram?: string; whatsapp?: string;
    facebook?: string; tiktok?: string; website?: string; youtube?: string;
    hours?: string;
    services: Service[];
}
interface Service {
    id: string; name: string; duration_minutes: number;
    price_ils: number; color: string; description?: string; is_bookable_online: boolean;
}
interface BookingReq {
    id: string; client_name: string; client_phone: string;
    service_note: string | null; requested_at: string; status: string;
}
interface Me { display_name: string; email: string; role: string; studio_id: string; }
interface GalleryPhoto { id: string; url: string; caption: string | null; sort_order: number; }

const DAYS = ["sun","mon","tue","wed","thu","fri","sat"] as const;
const DAY_LABELS: Record<string, string> = { sun:"ראשון", mon:"שני", tue:"שלישי", wed:"רביעי", thu:"חמישי", fri:"שישי", sat:"שבת" };
type Day = typeof DAYS[number];
interface DayHours { open: string; close: string; closed: boolean; }
type Hours = Record<Day, DayHours>;

const DEFAULT_HOURS: Hours = {
    sun: { open:"09:00", close:"20:00", closed:false },
    mon: { open:"09:00", close:"20:00", closed:false },
    tue: { open:"09:00", close:"20:00", closed:false },
    wed: { open:"09:00", close:"20:00", closed:false },
    thu: { open:"09:00", close:"20:00", closed:false },
    fri: { open:"09:00", close:"14:00", closed:false },
    sat: { open:"10:00", close:"14:00", closed:true },
};

// ── Auth helpers ─────────────────────────────────────────────────────────────

function getToken() { return typeof window !== "undefined" ? localStorage.getItem("biz_studio_token") : null; }

async function studioFetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json", ...(opts?.headers || {}) },
    });
    if (res.status === 401) { localStorage.removeItem("biz_studio_token"); throw new Error("401"); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── Completeness score ────────────────────────────────────────────────────────

function calcScore(p: typeof initialProfile, galleryCount: number, coverUrl?: string): number {
    let s = 0;
    if (p.city) s += 12;
    if (p.phone) s += 10;
    if (p.address) s += 10;
    if (p.description && p.description.length > 30) s += 15;
    if (coverUrl || galleryCount > 0) s += 12;
    if (galleryCount >= 3) s += 8;
    if (p.instagram || p.facebook) s += 10;
    if (p.whatsapp) s += 8;
    if (p.website || p.map_link) s += 8;
    if (p.marketplace_visible) s += 7;
    return Math.min(s, 100);
}

const initialProfile = {
    description: "", city: "", phone: "", address: "", map_link: "",
    instagram: "", whatsapp: "", facebook: "", tiktok: "", website: "", youtube: "",
    marketplace_visible: false,
    hours: DEFAULT_HOURS as Hours,
};

// ── Social icons ─────────────────────────────────────────────────────────────

const SOCIAL_FIELDS = [
    { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/username", icon: "📸", color: "#e1306c" },
    { key: "facebook",  label: "Facebook",  placeholder: "https://facebook.com/pagename",  icon: "👥", color: "#1877f2" },
    { key: "tiktok",    label: "TikTok",    placeholder: "https://tiktok.com/@username",    icon: "🎵", color: "#010101" },
    { key: "youtube",   label: "YouTube",   placeholder: "https://youtube.com/@channel",    icon: "▶️", color: "#ff0000" },
    { key: "website",   label: "אתר הבית",  placeholder: "https://www.mysite.co.il",        icon: "🌐", color: "#0ea5e9" },
    { key: "whatsapp",  label: "WhatsApp",  placeholder: "972501234567",                    icon: "💬", color: "#25d366" },
    { key: "map_link",  label: "Google Maps", placeholder: "https://maps.google.com/...",  icon: "📍", color: "#ea4335" },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function StudioDashboard() {
    const router = useRouter();
    const [me, setMe] = useState<Me | null>(null);
    const [studioData, setStudioData] = useState<StudioProfile | null>(null);
    const [bookings, setBookings] = useState<BookingReq[]>([]);
    const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"bookings" | "profile" | "gallery" | "services">("profile");
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [profile, setProfile] = useState(initialProfile);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [toast, setToast] = useState("");
    const [uploading, setUploading] = useState(false);
    const [coverUploading, setCoverUploading] = useState(false);
    const [logoUploading, setLogoUploading] = useState(false);
    const logoRef = useRef<HTMLInputElement>(null);
    const [importUrl, setImportUrl] = useState("");
    const [importLoading, setImportLoading] = useState(false);
    const [importError, setImportError] = useState("");
    const [openSection, setOpenSection] = useState<string[]>(["visibility", "basic", "social", "hours"]);
    const fileRef = useRef<HTMLInputElement>(null);
    const coverRef = useRef<HTMLInputElement>(null);

    // ── Load ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!getToken()) { router.replace("/studio/login"); return; }
        Promise.all([
            studioFetch<Me>("/api/auth/me"),
            studioFetch<BookingReq[]>("/api/booking-requests?status=pending&limit=50").catch(() => []),
            studioFetch<GalleryPhoto[]>("/api/studio/upload/gallery").catch(() => []),
            studioFetch<StudioProfile>("/api/marketplace/studio/me").catch(() => null),
        ]).then(([m, reqs, gal, sd]) => {
            setMe(m);
            setBookings(reqs as BookingReq[]);
            setGallery(gal as GalleryPhoto[]);
            if (sd) {
                setStudioData(sd);
                let parsedHours = DEFAULT_HOURS;
                if (sd.hours) {
                    try { parsedHours = { ...DEFAULT_HOURS, ...JSON.parse(sd.hours) }; } catch {}
                }
                setProfile({
                    description: sd.description || "",
                    city: sd.city || "",
                    phone: sd.phone || "",
                    address: sd.address || "",
                    map_link: sd.map_link || "",
                    instagram: sd.instagram || "",
                    whatsapp: sd.whatsapp || "",
                    facebook: sd.facebook || "",
                    tiktok: sd.tiktok || "",
                    website: sd.website || "",
                    youtube: sd.youtube || "",
                    marketplace_visible: sd.marketplace_visible ?? false,
                    hours: parsedHours,
                });
            }
        }).catch(e => {
            if (e.message === "401") router.replace("/studio/login");
        }).finally(() => setLoading(false));
    }, [router]);

    // ── Booking actions ───────────────────────────────────────────────────────
    const handleApprove = async (id: string) => {
        setActionLoading(id);
        try {
            await fetch(`${API}/api/booking-requests/${id}/approve`, {
                method: "POST", headers: { Authorization: `Bearer ${getToken()}` },
            });
            setBookings(bs => bs.filter(b => b.id !== id));
        } catch { } finally { setActionLoading(null); }
    };
    const handleReject = async (id: string) => {
        setActionLoading(id + "_r");
        try {
            await fetch(`${API}/api/booking-requests/${id}/reject`, {
                method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "לא מתאים" }),
            });
            setBookings(bs => bs.filter(b => b.id !== id));
        } catch { } finally { setActionLoading(null); }
    };

    // ── Save profile ──────────────────────────────────────────────────────────
    const saveProfile = async () => {
        setSaving(true);
        try {
            await fetch(`${API}/api/studio/automation`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    marketplace_description: profile.description,
                    marketplace_city: profile.city,
                    marketplace_phone: profile.phone,
                    studio_address: profile.address,
                    studio_map_link: profile.map_link,
                    marketplace_instagram: profile.instagram,
                    marketplace_whatsapp: profile.whatsapp,
                    marketplace_facebook: profile.facebook,
                    marketplace_tiktok: profile.tiktok,
                    marketplace_website: profile.website,
                    marketplace_youtube: profile.youtube,
                    marketplace_visible: profile.marketplace_visible,
                    marketplace_hours: JSON.stringify(profile.hours),
                }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
            // refresh studio data
            studioFetch<StudioProfile>("/api/marketplace/studio/me").then(sd => {
                if (sd) setStudioData(sd);
            }).catch(() => {});
        } catch { } finally { setSaving(false); }
    };

    // ── Gallery ───────────────────────────────────────────────────────────────
    const uploadPhoto = async (file: File) => {
        setUploading(true);
        const fd = new FormData(); fd.append("file", file);
        try {
            const res = await fetch(`${API}/api/studio/upload/gallery`, {
                method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd,
            });
            const photo = await res.json();
            setGallery(g => [...g, photo]);
            setStudioData(sd => sd ? { ...sd, gallery_count: sd.gallery_count + 1 } : sd);
        } catch { } finally { setUploading(false); }
    };
    const deletePhoto = async (id: string) => {
        try {
            await fetch(`${API}/api/studio/upload/gallery/${id}`, {
                method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
            });
            setGallery(g => g.filter(p => p.id !== id));
            setStudioData(sd => sd ? { ...sd, gallery_count: Math.max(0, sd.gallery_count - 1) } : sd);
        } catch { }
    };
    const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

    const uploadCover = async (file: File) => {
        setCoverUploading(true);
        const fd = new FormData(); fd.append("file", file);
        try {
            const res = await fetch(`${API}/api/studio/upload/cover`, {
                method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd,
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            const url = data.url || data.cover_url;
            setStudioData(sd => sd ? { ...sd, cover_url: url } : sd);
            showToast("✅ תמונת כיסוי עודכנה!");
        } catch { showToast("❌ שגיאה בהעלאת תמונת כיסוי"); } finally { setCoverUploading(false); }
    };
    const removeCover = async () => {
        try {
            const res = await fetch(`${API}/api/studio/upload/cover`, {
                method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
            });
            if (!res.ok) throw new Error();
            setStudioData(sd => sd ? { ...sd, cover_url: undefined } : sd);
            showToast("✅ תמונת כיסוי הוסרה");
        } catch { showToast("❌ שגיאה בהסרה"); }
    };
    const uploadLogo = async (file: File) => {
        setLogoUploading(true);
        const fd = new FormData(); fd.append("file", file);
        try {
            const res = await fetch(`${API}/api/studio/upload/logo`, {
                method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd,
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            const url = data.url || (data.filename?.startsWith("http") ? data.filename : `${API}/uploads/${data.filename}`);
            setStudioData(sd => sd ? { ...sd, logo_url: url } : sd);
            showToast("✅ לוגו עודכן בהצלחה!");
        } catch { showToast("❌ שגיאה בהעלאת לוגו"); } finally { setLogoUploading(false); }
    };
    const removeLogo = async () => {
        try {
            const res = await fetch(`${API}/api/studio/upload/logo`, {
                method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
            });
            if (!res.ok) throw new Error();
            setStudioData(sd => sd ? { ...sd, logo_url: undefined } : sd);
            showToast("✅ לוגו הוסר");
        } catch { showToast("❌ שגיאה בהסרה"); }
    };

    const importFromUrl = async () => {
        if (!importUrl.trim()) return;
        setImportLoading(true); setImportError("");
        try {
            const res = await fetch(`${API}/api/studio/upload/gallery-from-url`, {
                method: "POST",
                headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
                body: JSON.stringify({ url: importUrl.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "שגיאה");
            setGallery(g => [...g, data]);
            setStudioData(sd => sd ? { ...sd, gallery_count: sd.gallery_count + 1 } : sd);
            setImportUrl("");
        } catch (e: any) { setImportError(e.message); }
        finally { setImportLoading(false); }
    };

    const setHour = (day: Day, field: "open" | "close" | "closed", value: string | boolean) => {
        setProfile(p => ({ ...p, hours: { ...p.hours, [day]: { ...p.hours[day], [field]: value } } }));
    };
    const toggleSection = (s: string) => setOpenSection(prev =>
        prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
    const logout = () => { localStorage.removeItem("biz_studio_token"); router.replace("/studio/login"); };

    if (loading) return (
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8faff" }}>
            <div style={{ width: 44, height: 44, border: "4px solid #ede9fe", borderTopColor: "#7c3aed", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        </div>
    );

    const isPro = studioData?.subscription_plan && !["free"].includes(studioData.subscription_plan);
    const fmtDate = (s: string) => new Date(s).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const pendingCount = bookings.filter(b => b.status === "pending").length;
    const score = calcScore(profile, studioData?.gallery_count ?? gallery.length, studioData?.cover_url);
    const scoreColor = score >= 80 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "system-ui,sans-serif", color: "#1e293b" }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
            <input ref={coverRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files?.[0] && uploadCover(e.target.files[0])} />
            <input ref={logoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files?.[0] && uploadLogo(e.target.files[0])} />

            {/* Header */}
            <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 1.25rem", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 6px rgba(0,0,0,.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
                    {studioData?.logo_url
                        ? <img src={studioData.logo_url.startsWith("http") ? studioData.logo_url : `${API}${studioData.logo_url}`} alt="logo" style={{ width: 36, height: 36, borderRadius: 9, objectFit: "cover", border: "1.5px solid #e2e8f0" }} />
                        : <div style={{ width: 36, height: 36, borderRadius: 9, background: `linear-gradient(135deg,${studioData?.primary_color || "#7c3aed"},#4f46e5)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "0.85rem" }}>B</div>
                    }
                    <div>
                        <div style={{ fontWeight: 800, fontSize: "0.95rem", lineHeight: 1.2 }}>{studioData?.name || me?.display_name}</div>
                        <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>{me?.role} · {isPro ? "Pro ✨" : "Free"}</div>
                    </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {studioData?.slug && (
                        <Link href={`/b/${studioData.slug}`} target="_blank"
                            style={{ fontSize: "0.78rem", color: "#7c3aed", textDecoration: "none", background: "#f5f3ff", padding: "0.3rem 0.65rem", borderRadius: 8, fontWeight: 600, border: "1px solid #ede9fe" }}>
                            👁️ הפרופיל שלי ↗
                        </Link>
                    )}
                    <button onClick={logout} style={{ fontSize: "0.78rem", color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>יציאה</button>
                </div>
            </header>

            {/* Toast */}
            {toast && (
                <div style={{ position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)", background: toast.startsWith("✅") ? "#f0fdf4" : "#fef2f2", border: `1px solid ${toast.startsWith("✅") ? "#bbf7d0" : "#fecaca"}`, color: toast.startsWith("✅") ? "#166534" : "#dc2626", padding: "0.75rem 1.5rem", borderRadius: 14, fontWeight: 700, fontSize: "0.88rem", zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,.15)", whiteSpace: "nowrap" }}>
                    {toast}
                </div>
            )}

            {/* Upgrade banner */}
            {!isPro && (
                <div style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", padding: "0.6rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                    <span style={{ color: "#fff", fontSize: "0.82rem" }}>🚀 <strong>שדרגו ל-BizControl Pro</strong> — יומן, תשלומים, WhatsApp, AI ועוד</span>
                    <a href="https://www.biz-control.com" target="_blank" rel="noopener"
                        style={{ background: "#fff", color: "#7c3aed", padding: "0.3rem 0.8rem", borderRadius: 8, fontWeight: 800, fontSize: "0.78rem", textDecoration: "none" }}>נסו בחינם ←</a>
                </div>
            )}

            <div style={{ maxWidth: 860, margin: "0 auto", padding: "1.25rem 1rem" }}>

                {/* Completeness card */}
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "1.1rem 1.25rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                            <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>עדכניות הפרופיל</span>
                            <span style={{ fontWeight: 900, fontSize: "1rem", color: scoreColor }}>{score}%</span>
                        </div>
                        <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${score}%`, background: scoreColor, borderRadius: 4, transition: "width .5s" }} />
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.3rem" }}>
                            {score < 50 ? "הוסיפו פרטים בסיסיים כדי שלקוחות יוכלו למצוא אתכם" :
                             score < 80 ? "טוב! הוסיפו עוד פרטים לחשיפה מרבית" :
                             "מצוין! הפרופיל שלכם מלא ומקצועי 🎉"}
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                        {[
                            { label: "בקשות", value: pendingCount, icon: "📥", color: "#7c3aed", bg: "#f5f3ff", action: () => setTab("bookings") },
                            { label: "גלריה", value: `${studioData?.gallery_count ?? gallery.length}/20`, icon: "🖼️", color: "#0ea5e9", bg: "#f0f9ff", action: () => setTab("gallery") },
                            { label: "שירותים", value: studioData?.services?.length ?? 0, icon: "🛍️", color: "#10b981", bg: "#f0fdf4", action: () => setTab("services") },
                        ].map(k => (
                            <button key={k.label} onClick={k.action} style={{ background: k.bg, border: `1px solid ${k.bg}`, borderRadius: 12, padding: "0.55rem 0.85rem", cursor: "pointer", textAlign: "center", minWidth: 80 }}>
                                <div style={{ fontSize: "1.1rem" }}>{k.icon}</div>
                                <div style={{ fontSize: "1.1rem", fontWeight: 900, color: k.color, lineHeight: 1.2 }}>{k.value}</div>
                                <div style={{ fontSize: "0.65rem", color: "#94a3b8" }}>{k.label}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: "0.3rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "0.3rem", marginBottom: "1rem", overflowX: "auto" }}>
                    {([
                        ["profile",   "⚙️ פרופיל"],
                        ["gallery",   "🖼️ גלריה"],
                        ["bookings",  `📥 בקשות${pendingCount > 0 ? ` (${pendingCount})` : ""}`],
                        ["services",  "🛍️ שירותים"],
                    ] as const).map(([id, label]) => (
                        <button key={id} onClick={() => setTab(id)} type="button"
                            style={{ padding: "0.5rem 1rem", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", transition: "all .15s", background: tab === id ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "transparent", color: tab === id ? "#fff" : "#64748b", whiteSpace: "nowrap", flexShrink: 0 }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── PROFILE TAB ── */}
                {tab === "profile" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>

                        {/* Visibility */}
                        <Section title="👁️ ניראות בBizFind" open={openSection.includes("visibility")} onToggle={() => toggleSection("visibility")}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.2rem 0" }}>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                                        {profile.marketplace_visible ? "✅ הפרופיל גלוי ללקוחות" : "🔒 הפרופיל מוסתר"}
                                    </div>
                                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.15rem" }}>
                                        {profile.marketplace_visible ? "לקוחות יכולים למצוא אתכם בחיפוש" : "הפעילו כדי שלקוחות יוכלו למצוא אתכם"}
                                    </div>
                                </div>
                                <Toggle checked={profile.marketplace_visible} onChange={v => setProfile(p => ({ ...p, marketplace_visible: v }))} />
                            </div>
                        </Section>

                        {/* Basic info */}
                        <Section title="📋 פרטי העסק" open={openSection.includes("basic")} onToggle={() => toggleSection("basic")}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
                                <Inp label="שם העסק" value={studioData?.name || ""} readOnly hint="לשינוי שם — עדכן ב-BizControl" />
                                <Inp label="עיר" value={profile.city} onChange={v => setProfile(p => ({ ...p, city: v }))} placeholder="תל אביב" />
                                <Inp label="טלפון לתצוגה" value={profile.phone} onChange={v => setProfile(p => ({ ...p, phone: v }))} placeholder="050-0000000" />
                                <Inp label="כתובת" value={profile.address} onChange={v => setProfile(p => ({ ...p, address: v }))} placeholder="רחוב ראשי 1" />
                            </div>
                            <div style={{ marginTop: "0.8rem" }}>
                                <label style={LABEL_S}>תיאור העסק</label>
                                <textarea value={profile.description} rows={4}
                                    onChange={e => setProfile(p => ({ ...p, description: e.target.value }))}
                                    placeholder="ספרו על העסק — סגנון, ניסיון, מה מייחד אתכם..."
                                    style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.65rem 0.9rem", fontSize: "0.88rem", outline: "none", boxSizing: "border-box", background: "#fafafa", resize: "vertical", lineHeight: 1.6, transition: "border-color .2s" }}
                                    onFocus={e => e.target.style.borderColor = "#7c3aed"}
                                    onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                                />
                                <div style={{ fontSize: "0.7rem", color: "#94a3b8", textAlign: "left" }}>{profile.description.length}/600</div>
                            </div>
                        </Section>

                        {/* Social & Web */}
                        <Section title="🔗 נוכחות ברשת" open={openSection.includes("social")} onToggle={() => toggleSection("social")}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
                                {SOCIAL_FIELDS.map(f => (
                                    <div key={f.key}>
                                        <label style={LABEL_S}>
                                            <span style={{ marginLeft: "0.3rem" }}>{f.icon}</span>
                                            {f.label}
                                        </label>
                                        <div style={{ position: "relative" }}>
                                            <input
                                                type={f.key === "whatsapp" ? "tel" : "url"}
                                                value={(profile as any)[f.key]}
                                                placeholder={f.placeholder}
                                                onChange={e => setProfile(p => ({ ...p, [f.key]: e.target.value }))}
                                                dir="ltr"
                                                style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.6rem 0.85rem", fontSize: "0.83rem", outline: "none", boxSizing: "border-box", background: "#fafafa", transition: "border-color .2s" }}
                                                onFocus={e => e.target.style.borderColor = f.color}
                                                onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                                            />
                                            {(profile as any)[f.key] && (
                                                <a href={(profile as any)[f.key]} target="_blank" rel="noopener"
                                                    style={{ position: "absolute", top: "50%", left: 10, transform: "translateY(-50%)", fontSize: "0.7rem", color: f.color, textDecoration: "none" }}>↗</a>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div style={{ marginTop: "0.75rem", background: "#f8fafc", borderRadius: 10, padding: "0.65rem 0.9rem", fontSize: "0.78rem", color: "#64748b", border: "1px solid #f1f5f9" }}>
                                💡 הוסיפו את קישור האינסטגרם שלכם ולקוחות יוכלו לראות את העבודות שלכם ישירות מהפרופיל
                            </div>
                        </Section>

                        {/* Hours */}
                        <Section title="🕐 שעות פעילות" open={openSection.includes("hours")} onToggle={() => toggleSection("hours")}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                                {DAYS.map(day => (
                                    <div key={day} style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.5rem 0.75rem", borderRadius: 11, background: profile.hours[day].closed ? "#f8fafc" : "#faf5ff", border: "1px solid #f1f5f9" }}>
                                        <div style={{ width: 52, fontWeight: 700, fontSize: "0.81rem", color: profile.hours[day].closed ? "#94a3b8" : "#374151", flexShrink: 0 }}>{DAY_LABELS[day]}</div>
                                        {profile.hours[day].closed ? (
                                            <div style={{ color: "#94a3b8", fontSize: "0.8rem", flex: 1 }}>סגור</div>
                                        ) : (
                                            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flex: 1 }}>
                                                <input type="time" value={profile.hours[day].open} onChange={e => setHour(day, "open", e.target.value)}
                                                    style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.3rem 0.45rem", fontSize: "0.81rem", outline: "none" }} />
                                                <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>—</span>
                                                <input type="time" value={profile.hours[day].close} onChange={e => setHour(day, "close", e.target.value)}
                                                    style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.3rem 0.45rem", fontSize: "0.81rem", outline: "none" }} />
                                            </div>
                                        )}
                                        <button type="button" onClick={() => setHour(day, "closed", !profile.hours[day].closed)}
                                            style={{ fontSize: "0.7rem", padding: "0.22rem 0.55rem", borderRadius: 8, border: "1px solid #e2e8f0", background: profile.hours[day].closed ? "#e2e8f0" : "#faf5ff", color: profile.hours[day].closed ? "#64748b" : "#7c3aed", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                                            {profile.hours[day].closed ? "פתח" : "סגור"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {saved && (
                            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "0.65rem 1rem", color: "#166534", fontSize: "0.85rem" }}>
                                ✅ הפרופיל עודכן בהצלחה!
                            </div>
                        )}
                        <button type="button" onClick={saveProfile} disabled={saving}
                            style={{ background: saving ? "#c4b5fd" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 14, padding: "0.85rem", fontWeight: 800, fontSize: "0.92rem", cursor: "pointer", width: "100%", boxShadow: saving ? "none" : "0 4px 16px rgba(124,58,237,.3)" }}>
                            {saving ? "שומר..." : "💾 שמור שינויים"}
                        </button>
                    </div>
                )}

                {/* ── GALLERY TAB ── */}
                {tab === "gallery" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                        {/* Logo + Cover in 2 columns */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.85rem" }}>
                            {/* Logo */}
                            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "1.1rem" }}>
                                <div style={{ fontWeight: 800, fontSize: "0.88rem", marginBottom: "0.5rem" }}>🏷️ לוגו</div>
                                <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginBottom: "0.75rem" }}>יוצג על הפרופיל</div>
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem" }}>
                                    {studioData?.logo_url ? (
                                        <img src={studioData.logo_url.startsWith("http") ? studioData.logo_url : `${API}${studioData.logo_url}`} alt="logo"
                                            style={{ width: 80, height: 80, borderRadius: 14, objectFit: "cover", border: "2px solid #e2e8f0" }} />
                                    ) : (
                                        <div style={{ width: 80, height: 80, borderRadius: 14, background: "#f1f5f9", border: "2px dashed #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem" }}>🏷️</div>
                                    )}
                                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "center" }}>
                                        <button type="button" onClick={() => logoRef.current?.click()} disabled={logoUploading}
                                            style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 10, padding: "0.45rem 0.75rem", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", opacity: logoUploading ? 0.7 : 1 }}>
                                            {logoUploading ? "⏳" : "⬆️ שנה"}
                                        </button>
                                        {studioData?.logo_url && (
                                            <button type="button" onClick={removeLogo}
                                                style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 10, padding: "0.45rem 0.75rem", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer" }}>
                                                🗑️ הסר
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Cover */}
                            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "1.1rem" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                                    <div>
                                        <div style={{ fontWeight: 800, fontSize: "0.88rem" }}>📸 תמונת כיסוי</div>
                                        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.1rem" }}>רקע הפרופיל הציבורי</div>
                                    </div>
                                    <div style={{ display: "flex", gap: "0.4rem" }}>
                                        <button type="button" onClick={() => coverRef.current?.click()} disabled={coverUploading}
                                            style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 10, padding: "0.45rem 0.85rem", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", opacity: coverUploading ? 0.7 : 1 }}>
                                            {coverUploading ? "⏳" : "⬆️ שנה"}
                                        </button>
                                        {studioData?.cover_url && (
                                            <button type="button" onClick={removeCover}
                                                style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 10, padding: "0.45rem 0.75rem", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer" }}>
                                                🗑️ הסר
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {studioData?.cover_url ? (
                                    <img src={studioData.cover_url.startsWith("http") ? studioData.cover_url : `${API}${studioData.cover_url}`} alt="cover"
                                        style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 12, border: "1px solid #e2e8f0" }} />
                                ) : (
                                    <div style={{ width: "100%", height: 110, background: "#f1f5f9", borderRadius: 12, border: "2px dashed #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "0.8rem" }}>
                                        לחץ "שנה" להעלאת תמונת כיסוי
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Import from URL */}
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "1.1rem 1.25rem" }}>
                            <div style={{ fontWeight: 800, fontSize: "0.92rem", marginBottom: "0.6rem" }}>📲 ייבוא תמונה מאינסטגרם / כל קישור</div>
                            <div style={{ fontSize: "0.76rem", color: "#64748b", marginBottom: "0.75rem", background: "#f8fafc", borderRadius: 10, padding: "0.55rem 0.8rem", border: "1px solid #f1f5f9" }}>
                                <strong>איך לייבא מאינסטגרם:</strong> פתחו פוסט באינסטגרם ← לחצו על התמונה ← "העתק כתובת תמונה" ← הדביקו כאן
                            </div>
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                                <input
                                    type="url" value={importUrl} dir="ltr"
                                    onChange={e => { setImportUrl(e.target.value); setImportError(""); }}
                                    placeholder="https://scontent.cdninstagram.com/... או כל URL תמונה"
                                    style={{ flex: 1, border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.6rem 0.85rem", fontSize: "0.82rem", outline: "none" }}
                                    onKeyDown={e => e.key === "Enter" && importFromUrl()}
                                />
                                <button type="button" onClick={importFromUrl} disabled={importLoading || !importUrl.trim()}
                                    style={{ background: importLoading ? "#c4b5fd" : "linear-gradient(135deg,#e1306c,#f77737)", color: "#fff", border: "none", borderRadius: 12, padding: "0.6rem 1rem", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                                    {importLoading ? "⏳ מייבא..." : "📸 ייבא"}
                                </button>
                            </div>
                            {importError && <div style={{ color: "#dc2626", fontSize: "0.78rem", marginTop: "0.4rem" }}>⚠️ {importError}</div>}
                        </div>

                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "1.1rem 1.25rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>🖼️ גלריה ({gallery.length}/20)</div>
                                    <div style={{ fontSize: "0.74rem", color: "#94a3b8", marginTop: "0.15rem" }}>תמונות עבודות שיוצגו ללקוחות</div>
                                </div>
                                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || gallery.length >= 20}
                                    style={{ background: gallery.length >= 20 ? "#e2e8f0" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: gallery.length >= 20 ? "#94a3b8" : "#fff", border: "none", borderRadius: 12, padding: "0.5rem 1rem", fontWeight: 700, fontSize: "0.8rem", cursor: gallery.length >= 20 ? "not-allowed" : "pointer" }}>
                                    {uploading ? "⏳ מעלה..." : "+ הוסף תמונה"}
                                </button>
                            </div>
                            {gallery.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "2.5rem", color: "#94a3b8", border: "2px dashed #e2e8f0", borderRadius: 14 }}>
                                    <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🖼️</div>
                                    <div style={{ fontWeight: 600 }}>אין תמונות עדיין</div>
                                    <div style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>לחץ "הוסף תמונה" להעלאת הראשונה</div>
                                </div>
                            ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "0.65rem" }}>
                                    {gallery.map(p => (
                                        <div key={p.id} style={{ position: "relative", borderRadius: 12, overflow: "hidden", aspectRatio: "1", background: "#f1f5f9" }}>
                                            <img src={`${API}${p.url}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                            <button type="button" onClick={() => deletePhoto(p.id)}
                                                style={{ position: "absolute", top: 5, left: 5, background: "rgba(239,68,68,.85)", border: "none", borderRadius: "50%", width: 24, height: 24, cursor: "pointer", color: "#fff", fontSize: "0.7rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                    {gallery.length < 20 && (
                                        <button type="button" onClick={() => fileRef.current?.click()}
                                            style={{ aspectRatio: "1", border: "2px dashed #c4b5fd", borderRadius: 12, background: "#faf5ff", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.3rem", color: "#7c3aed" }}>
                                            <span style={{ fontSize: "1.4rem" }}>+</span>
                                            <span style={{ fontSize: "0.68rem", fontWeight: 600 }}>הוסף</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── BOOKINGS TAB ── */}
                {tab === "bookings" && (
                    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden" }}>
                        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ fontWeight: 800, fontSize: "1rem" }}>📥 בקשות תורים ממתינות</div>
                        </div>
                        {bookings.length === 0 ? (
                            <div style={{ padding: "3rem", textAlign: "center", color: "#94a3b8" }}>
                                <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>✅</div>
                                <div>אין בקשות ממתינות כרגע</div>
                            </div>
                        ) : bookings.map((b, i) => (
                            <div key={b.id} style={{ padding: "1rem 1.25rem", borderBottom: i < bookings.length - 1 ? "1px solid #f1f5f9" : "none", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                                <div style={{ flex: 1, minWidth: 180 }}>
                                    <div style={{ fontWeight: 700, fontSize: "0.92rem", marginBottom: "0.2rem" }}>{b.client_name}</div>
                                    <div style={{ fontSize: "0.76rem", color: "#64748b" }}>📅 {fmtDate(b.requested_at)}</div>
                                    {b.service_note && <div style={{ fontSize: "0.76rem", color: "#7c3aed", marginTop: "0.15rem" }}>🛎️ {b.service_note}</div>}
                                    <a href={`tel:${b.client_phone}`} style={{ fontSize: "0.76rem", color: "#0ea5e9", textDecoration: "none", display: "block", marginTop: "0.15rem" }}>📞 {b.client_phone}</a>
                                </div>
                                {b.status === "pending" && (
                                    <div style={{ display: "flex", gap: "0.4rem" }}>
                                        <button onClick={() => handleApprove(b.id)} disabled={!!actionLoading} type="button"
                                            style={{ background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.38rem 0.8rem", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>
                                            {actionLoading === b.id ? "⏳" : "✅ אשר"}
                                        </button>
                                        <button onClick={() => handleReject(b.id)} disabled={!!actionLoading} type="button"
                                            style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 10, padding: "0.38rem 0.8rem", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>
                                            {actionLoading === b.id + "_r" ? "⏳" : "❌ דחה"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* ── SERVICES TAB ── */}
                {tab === "services" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden" }}>
                            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: "1rem" }}>🛍️ שירותים</div>
                                    <div style={{ fontSize: "0.74rem", color: "#94a3b8", marginTop: "0.15rem" }}>שירותים מ-BizControl שיוצגו בפרופיל הציבורי</div>
                                </div>
                                <a href="https://www.biz-control.com/services" target="_blank" rel="noopener"
                                    style={{ fontSize: "0.78rem", color: "#7c3aed", textDecoration: "none", background: "#f5f3ff", padding: "0.3rem 0.65rem", borderRadius: 8, fontWeight: 600, border: "1px solid #ede9fe" }}>
                                    ✏️ עריכה ב-BizControl ↗
                                </a>
                            </div>
                            {!studioData?.services?.length ? (
                                <div style={{ padding: "2.5rem", textAlign: "center", color: "#94a3b8" }}>
                                    <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🛍️</div>
                                    <div style={{ fontWeight: 600 }}>אין שירותים מוגדרים</div>
                                    <div style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>הוסיפו שירותים ב-BizControl והם יופיעו כאן אוטומטית</div>
                                    <a href="https://www.biz-control.com/services" target="_blank" rel="noopener"
                                        style={{ display: "inline-block", marginTop: "0.75rem", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", padding: "0.5rem 1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.8rem", textDecoration: "none" }}>
                                        הוסף שירותים ←
                                    </a>
                                </div>
                            ) : studioData.services.map((s, i) => (
                                <div key={s.id} style={{ padding: "0.85rem 1.25rem", borderBottom: i < studioData.services.length - 1 ? "1px solid #f1f5f9" : "none", display: "flex", alignItems: "center", gap: "1rem" }}>
                                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{s.name}</div>
                                        {s.description && <div style={{ fontSize: "0.74rem", color: "#64748b", marginTop: "0.1rem" }}>{s.description}</div>}
                                    </div>
                                    <div style={{ textAlign: "left", flexShrink: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1e293b" }}>₪{s.price_ils}</div>
                                        <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>{s.duration_minutes} דק׳</div>
                                    </div>
                                    {s.is_bookable_online && (
                                        <span style={{ background: "#f0fdf4", color: "#16a34a", fontSize: "0.65rem", fontWeight: 700, padding: "0.2rem 0.5rem", borderRadius: 6, border: "1px solid #bbf7d0" }}>ניתן לקביעה</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}

// ── Small components ──────────────────────────────────────────────────────────

const LABEL_S: React.CSSProperties = { display: "block", fontSize: "0.76rem", fontWeight: 700, color: "#374151", marginBottom: "0.28rem" };

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
    return (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden" }}>
            <button type="button" onClick={onToggle}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.9rem 1.25rem", background: "none", border: "none", cursor: "pointer", fontWeight: 800, fontSize: "0.92rem", color: "#1e293b" }}>
                <span>{title}</span>
                <span style={{ color: "#94a3b8", fontSize: "0.8rem", transition: "transform .2s", transform: open ? "rotate(180deg)" : "none" }}>▼</span>
            </button>
            {open && <div style={{ padding: "0 1.25rem 1.1rem" }}>{children}</div>}
        </div>
    );
}

function Inp({ label, value, onChange, placeholder, readOnly, hint }: { label: string; value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean; hint?: string }) {
    return (
        <div>
            <label style={LABEL_S}>{label}</label>
            <input type="text" value={value} readOnly={readOnly}
                onChange={e => onChange?.(e.target.value)}
                placeholder={placeholder}
                style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.6rem 0.85rem", fontSize: "0.85rem", outline: "none", boxSizing: "border-box", background: readOnly ? "#f8fafc" : "#fafafa", color: readOnly ? "#94a3b8" : "#1e293b", cursor: readOnly ? "not-allowed" : "text", transition: "border-color .2s" }}
                onFocus={e => { if (!readOnly) e.target.style.borderColor = "#7c3aed"; }}
                onBlur={e => { e.target.style.borderColor = "#e2e8f0"; }}
            />
            {hint && <div style={{ fontSize: "0.68rem", color: "#94a3b8", marginTop: "0.2rem" }}>💡 {hint}</div>}
        </div>
    );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button type="button" onClick={() => onChange(!checked)}
            style={{ width: 52, height: 30, borderRadius: 15, border: "none", cursor: "pointer", position: "relative", background: checked ? "#7c3aed" : "#e2e8f0", transition: "background .2s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 4, right: checked ? 4 : "calc(100% - 26px)", width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "right .2s", boxShadow: "0 1px 4px rgba(0,0,0,.2)", display: "block" }} />
        </button>
    );
}
