"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

interface StudioInfo { name: string; slug: string; subscription_plan: string; }
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

// ── Status styles ────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
    pending:  { label: "ממתין",   bg: "#fef9c3", color: "#92400e" },
    approved: { label: "אושר ✅", bg: "#dcfce7", color: "#166534" },
    rejected: { label: "נדחה",   bg: "#fee2e2", color: "#991b1b" },
};

// ── Input helpers ─────────────────────────────────────────────────────────────

function inputStyle(focus?: boolean) {
    return {
        width: "100%", border: `1.5px solid ${focus ? "#7c3aed" : "#e2e8f0"}`,
        borderRadius: 12, padding: "0.65rem 0.9rem", fontSize: "0.88rem",
        outline: "none", boxSizing: "border-box" as const, background: "#fafafa",
        transition: "border-color .2s",
    };
}
function labelStyle() {
    return { display: "block" as const, fontSize: "0.78rem", fontWeight: 700 as const, color: "#374151", marginBottom: "0.3rem" };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StudioDashboard() {
    const router = useRouter();
    const [me, setMe] = useState<Me | null>(null);
    const [studio, setStudio] = useState<StudioInfo | null>(null);
    const [bookings, setBookings] = useState<BookingReq[]>([]);
    const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"bookings" | "profile" | "gallery">("bookings");
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Profile form
    const [profile, setProfile] = useState({
        description: "", city: "", phone: "", address: "", map_link: "",
        instagram: "", whatsapp: "", marketplace_visible: false,
        hours: DEFAULT_HOURS as Hours,
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Gallery
    const [uploading, setUploading] = useState(false);
    const [coverUploading, setCoverUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const coverRef = useRef<HTMLInputElement>(null);

    // ── Load ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!getToken()) { router.replace("/studio/login"); return; }
        Promise.all([
            studioFetch<Me>("/api/auth/me"),
            studioFetch<BookingReq[]>("/api/booking-requests?status=pending&limit=50"),
            studioFetch<GalleryPhoto[]>("/api/studio/upload/gallery"),
        ]).then(([m, reqs, gal]) => {
            setMe(m); setBookings(reqs); setGallery(gal);
            studioFetch<any>("/api/studio/automation").then(s => {
                setStudio({ name: s.studio_name || "", slug: s.studio_slug || "", subscription_plan: s.subscription_plan || "free" });
                let parsedHours = DEFAULT_HOURS;
                if (s.marketplace_hours) {
                    try { parsedHours = { ...DEFAULT_HOURS, ...JSON.parse(s.marketplace_hours) }; } catch {}
                }
                setProfile({
                    description: s.marketplace_description || "",
                    city: s.marketplace_city || "",
                    phone: s.marketplace_phone || "",
                    address: s.studio_address || "",
                    map_link: s.studio_map_link || "",
                    instagram: s.marketplace_instagram || "",
                    whatsapp: s.marketplace_whatsapp || "",
                    marketplace_visible: s.marketplace_visible ?? false,
                    hours: parsedHours,
                });
            }).catch(() => {});
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

    // ── Profile save ──────────────────────────────────────────────────────────
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
                    marketplace_visible: profile.marketplace_visible,
                    marketplace_hours: JSON.stringify(profile.hours),
                }),
            });
            setSaved(true); setTimeout(() => setSaved(false), 3000);
        } catch { } finally { setSaving(false); }
    };

    // ── Gallery upload ────────────────────────────────────────────────────────
    const uploadPhoto = async (file: File) => {
        if (!file) return;
        setUploading(true);
        const fd = new FormData(); fd.append("file", file);
        try {
            const res = await fetch(`${API}/api/studio/upload/gallery`, {
                method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd,
            });
            const photo = await res.json();
            setGallery(g => [...g, photo]);
        } catch { } finally { setUploading(false); }
    };

    const deletePhoto = async (id: string) => {
        try {
            await fetch(`${API}/api/studio/upload/gallery/${id}`, {
                method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
            });
            setGallery(g => g.filter(p => p.id !== id));
        } catch { }
    };

    const uploadCover = async (file: File) => {
        setCoverUploading(true);
        const fd = new FormData(); fd.append("file", file);
        try {
            await fetch(`${API}/api/studio/upload/cover`, {
                method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd,
            });
        } catch { } finally { setCoverUploading(false); }
    };

    // ── Hours helpers ─────────────────────────────────────────────────────────
    const setHour = (day: Day, field: "open" | "close" | "closed", value: string | boolean) => {
        setProfile(p => ({ ...p, hours: { ...p.hours, [day]: { ...p.hours[day], [field]: value } } }));
    };

    const logout = () => { localStorage.removeItem("biz_studio_token"); router.replace("/studio/login"); };

    if (loading) return (
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8faff" }}>
            <div style={{ width: 44, height: 44, border: "4px solid #ede9fe", borderTopColor: "#7c3aed", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        </div>
    );

    const isPro = studio?.subscription_plan && !["free"].includes(studio.subscription_plan);
    const fmtDate = (s: string) => new Date(s).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const pendingCount = bookings.filter(b => b.status === "pending").length;

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#f8faff", fontFamily: "system-ui,sans-serif", color: "#1e293b" }}>
            {/* Hidden file inputs */}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
            <input ref={coverRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files?.[0] && uploadCover(e.target.files[0])} />

            {/* Header */}
            <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 1.5rem", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "0.85rem" }}>B</div>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: "0.95rem", lineHeight: 1.2 }}>{studio?.name || me?.display_name}</div>
                        <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>{me?.role} · {isPro ? "Pro ✨" : "Free"}</div>
                    </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {studio?.slug && (
                        <Link href={`/b/${studio.slug}`} target="_blank"
                            style={{ fontSize: "0.78rem", color: "#7c3aed", textDecoration: "none", background: "#f5f3ff", padding: "0.3rem 0.65rem", borderRadius: 8, fontWeight: 600, border: "1px solid #ede9fe" }}>
                            👁️ הפרופיל שלי ↗
                        </Link>
                    )}
                    <button onClick={logout} style={{ fontSize: "0.78rem", color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>יציאה</button>
                </div>
            </header>

            {/* Upgrade banner */}
            {!isPro && (
                <div style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", padding: "0.65rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div style={{ color: "#fff", fontSize: "0.85rem" }}>
                        <strong>🚀 שדרגו ל-BizControl Pro</strong> — יומן, תשלומים, WhatsApp, AI ועוד
                    </div>
                    <a href="https://www.biz-control.com" target="_blank" rel="noopener"
                        style={{ background: "#fff", color: "#7c3aed", padding: "0.35rem 0.9rem", borderRadius: 8, fontWeight: 800, fontSize: "0.8rem", textDecoration: "none" }}>
                        נסו בחינם ←
                    </a>
                </div>
            )}

            <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1.25rem" }}>

                {/* KPI row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: "0.85rem", marginBottom: "1.5rem" }}>
                    {[
                        { icon: "📥", label: "בקשות ממתינות", value: pendingCount, color: "#7c3aed", bg: "#f5f3ff" },
                        { icon: "🖼️", label: "תמונות בגלריה", value: gallery.length + "/20", color: "#0ea5e9", bg: "#f0f9ff" },
                        { icon: "👁️", label: "פרופיל גלוי", value: profile.marketplace_visible ? "כן ✅" : "לא", color: profile.marketplace_visible ? "#16a34a" : "#94a3b8", bg: profile.marketplace_visible ? "#f0fdf4" : "#f8fafc" },
                    ].map(k => (
                        <div key={k.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "1rem" }}>
                            <div style={{ fontSize: "1.4rem", marginBottom: "0.3rem" }}>{k.icon}</div>
                            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: k.color }}>{k.value}</div>
                            <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.1rem" }}>{k.label}</div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: "0.35rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "0.3rem", width: "fit-content", marginBottom: "1.25rem" }}>
                    {([
                        ["bookings", `📥 בקשות${pendingCount > 0 ? ` (${pendingCount})` : ""}`],
                        ["gallery",  "🖼️ גלריה"],
                        ["profile",  "⚙️ פרופיל"],
                    ] as const).map(([id, label]) => (
                        <button key={id} onClick={() => setTab(id)} type="button"
                            style={{ padding: "0.5rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.84rem", transition: "all .15s", background: tab === id ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "transparent", color: tab === id ? "#fff" : "#64748b", whiteSpace: "nowrap" }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── TAB: Bookings ── */}
                {tab === "bookings" && (
                    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, overflow: "hidden" }}>
                        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #f1f5f9" }}>
                            <h2 style={{ fontWeight: 800, fontSize: "1rem", margin: 0 }}>בקשות תורים ממתינות</h2>
                        </div>
                        {bookings.length === 0 ? (
                            <div style={{ padding: "3rem", textAlign: "center", color: "#94a3b8" }}>
                                <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✅</div>
                                <div>אין בקשות ממתינות כרגע</div>
                            </div>
                        ) : bookings.map((b, i) => {
                            const st = STATUS_STYLE[b.status] || STATUS_STYLE.pending;
                            return (
                                <div key={b.id} style={{ padding: "1rem 1.25rem", borderBottom: i < bookings.length - 1 ? "1px solid #f1f5f9" : "none", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                                    <div style={{ flex: 1, minWidth: 200 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                                            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{b.client_name}</span>
                                            <span style={{ background: st.bg, color: st.color, fontSize: "0.68rem", fontWeight: 700, padding: "0.12rem 0.45rem", borderRadius: 6 }}>{st.label}</span>
                                        </div>
                                        <div style={{ fontSize: "0.78rem", color: "#64748b" }}>📅 {fmtDate(b.requested_at)}</div>
                                        {b.service_note && <div style={{ fontSize: "0.78rem", color: "#7c3aed", marginTop: "0.15rem" }}>🛎️ {b.service_note}</div>}
                                        <a href={`tel:${b.client_phone}`} style={{ fontSize: "0.78rem", color: "#0ea5e9", textDecoration: "none", display: "block", marginTop: "0.15rem" }}>📞 {b.client_phone}</a>
                                    </div>
                                    {b.status === "pending" && (
                                        <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                                            <button onClick={() => handleApprove(b.id)} disabled={!!actionLoading} type="button"
                                                style={{ background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.4rem 0.85rem", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
                                                {actionLoading === b.id ? "⏳" : "✅ אשר"}
                                            </button>
                                            <button onClick={() => handleReject(b.id)} disabled={!!actionLoading} type="button"
                                                style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 10, padding: "0.4rem 0.85rem", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
                                                {actionLoading === b.id + "_r" ? "⏳" : "❌ דחה"}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ── TAB: Gallery ── */}
                {tab === "gallery" && (
                    <div>
                        {/* Cover photo */}
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "1.25rem", marginBottom: "1rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>📸 תמונת כיסוי</div>
                                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.15rem" }}>תמונת הרקע שתוצג בפרופיל הציבורי</div>
                                </div>
                                <button type="button" onClick={() => coverRef.current?.click()} disabled={coverUploading}
                                    style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 12, padding: "0.55rem 1.1rem", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", opacity: coverUploading ? 0.7 : 1 }}>
                                    {coverUploading ? "⏳ מעלה..." : "⬆️ העלה כיסוי"}
                                </button>
                            </div>
                        </div>

                        {/* Gallery grid */}
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "1.25rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>🖼️ גלריה ({gallery.length}/20)</div>
                                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.15rem" }}>תמונות עבודות שיוצגו בפרופיל הציבורי</div>
                                </div>
                                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || gallery.length >= 20}
                                    style={{ background: gallery.length >= 20 ? "#e2e8f0" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: gallery.length >= 20 ? "#94a3b8" : "#fff", border: "none", borderRadius: 12, padding: "0.55rem 1.1rem", fontWeight: 700, fontSize: "0.82rem", cursor: gallery.length >= 20 ? "not-allowed" : "pointer", opacity: uploading ? 0.7 : 1 }}>
                                    {uploading ? "⏳ מעלה..." : "+ הוסף תמונה"}
                                </button>
                            </div>

                            {gallery.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", border: "2px dashed #e2e8f0", borderRadius: 16 }}>
                                    <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>🖼️</div>
                                    <div style={{ fontWeight: 600, marginBottom: "0.4rem" }}>אין תמונות עדיין</div>
                                    <div style={{ fontSize: "0.8rem" }}>לחץ "הוסף תמונה" להעלאת התמונה הראשונה</div>
                                </div>
                            ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "0.75rem" }}>
                                    {gallery.map(p => (
                                        <div key={p.id} style={{ position: "relative", borderRadius: 14, overflow: "hidden", aspectRatio: "1", background: "#f1f5f9", group: true } as any}>
                                            <img src={`${API}${p.url}`} alt={p.caption || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                            <button type="button" onClick={() => deletePhoto(p.id)}
                                                style={{ position: "absolute", top: 6, left: 6, background: "rgba(239,68,68,.85)", border: "none", borderRadius: "50%", width: 26, height: 26, cursor: "pointer", color: "#fff", fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                    {/* Upload placeholder */}
                                    {gallery.length < 20 && (
                                        <button type="button" onClick={() => fileRef.current?.click()}
                                            style={{ aspectRatio: "1", border: "2px dashed #c4b5fd", borderRadius: 14, background: "#faf5ff", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.35rem", color: "#7c3aed" }}>
                                            <span style={{ fontSize: "1.5rem" }}>+</span>
                                            <span style={{ fontSize: "0.7rem", fontWeight: 600 }}>הוסף</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── TAB: Profile ── */}
                {tab === "profile" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

                        {/* Visibility toggle */}
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "1.1rem 1.25rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>הפרופיל מוצג לציבור</div>
                                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.15rem" }}>לקוחות יוכלו למצוא אתכם בחיפוש</div>
                                </div>
                                <button type="button" onClick={() => setProfile(p => ({ ...p, marketplace_visible: !p.marketplace_visible }))}
                                    style={{ width: 50, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative", background: profile.marketplace_visible ? "#7c3aed" : "#e2e8f0", transition: "background .2s", flexShrink: 0 }}>
                                    <span style={{ position: "absolute", top: 3, right: profile.marketplace_visible ? 3 : "calc(100% - 25px)", width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "right .2s", boxShadow: "0 1px 4px rgba(0,0,0,.15)", display: "block" }} />
                                </button>
                            </div>
                        </div>

                        {/* Basic info */}
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "1.25rem" }}>
                            <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: "1rem", color: "#1e293b" }}>📋 פרטים בסיסיים</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem" }}>
                                {[
                                    { label: "עיר", key: "city", placeholder: "תל אביב" },
                                    { label: "טלפון לתצוגה", key: "phone", placeholder: "050-0000000" },
                                    { label: "כתובת", key: "address", placeholder: "רחוב ראשי 1, עיר" },
                                    { label: "קישור למפה (Google Maps)", key: "map_link", placeholder: "https://maps.google.com/..." },
                                ].map(f => (
                                    <Field key={f.key} label={f.label}>
                                        <input type="text" value={(profile as any)[f.key]} placeholder={f.placeholder}
                                            onChange={e => setProfile(p => ({ ...p, [f.key]: e.target.value }))}
                                            style={inputStyle()}
                                            onFocus={e => e.target.style.borderColor = "#7c3aed"}
                                            onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                                        />
                                    </Field>
                                ))}
                            </div>
                            <div style={{ marginTop: "0.85rem" }}>
                                <label style={labelStyle()}>תיאור הסטודיו</label>
                                <textarea value={profile.description} rows={4}
                                    onChange={e => setProfile(p => ({ ...p, description: e.target.value }))}
                                    placeholder="ספרו על העסק — סגנון, ניסיון, מה מייחד אתכם..."
                                    style={{ ...inputStyle(), resize: "vertical", lineHeight: 1.6 }}
                                    onFocus={e => e.target.style.borderColor = "#7c3aed"}
                                    onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                                />
                            </div>
                        </div>

                        {/* Social */}
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "1.25rem" }}>
                            <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: "1rem", color: "#1e293b" }}>🔗 רשתות חברתיות</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem" }}>
                                <Field label="📸 Instagram (קישור)">
                                    <input type="url" value={profile.instagram} placeholder="https://instagram.com/..."
                                        onChange={e => setProfile(p => ({ ...p, instagram: e.target.value }))}
                                        style={inputStyle()}
                                        onFocus={e => e.target.style.borderColor = "#7c3aed"}
                                        onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                                    />
                                </Field>
                                <Field label="💬 WhatsApp (מספר)">
                                    <input type="tel" value={profile.whatsapp} placeholder="972501234567"
                                        onChange={e => setProfile(p => ({ ...p, whatsapp: e.target.value }))}
                                        style={inputStyle()}
                                        onFocus={e => e.target.style.borderColor = "#7c3aed"}
                                        onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                                    />
                                </Field>
                            </div>
                        </div>

                        {/* Hours */}
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "1.25rem" }}>
                            <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: "1rem", color: "#1e293b" }}>🕐 שעות פתיחה</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                {DAYS.map(day => (
                                    <div key={day} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.55rem 0.75rem", borderRadius: 12, background: profile.hours[day].closed ? "#f8fafc" : "#faf5ff", border: "1px solid #f1f5f9" }}>
                                        <div style={{ width: 52, fontWeight: 700, fontSize: "0.82rem", color: "#374151", flexShrink: 0 }}>{DAY_LABELS[day]}</div>
                                        {profile.hours[day].closed ? (
                                            <div style={{ color: "#94a3b8", fontSize: "0.8rem", flex: 1 }}>סגור</div>
                                        ) : (
                                            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flex: 1 }}>
                                                <input type="time" value={profile.hours[day].open}
                                                    onChange={e => setHour(day, "open", e.target.value)}
                                                    style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.3rem 0.5rem", fontSize: "0.82rem", outline: "none", background: "#fff" }}
                                                />
                                                <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>—</span>
                                                <input type="time" value={profile.hours[day].close}
                                                    onChange={e => setHour(day, "close", e.target.value)}
                                                    style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.3rem 0.5rem", fontSize: "0.82rem", outline: "none", background: "#fff" }}
                                                />
                                            </div>
                                        )}
                                        <button type="button" onClick={() => setHour(day, "closed", !profile.hours[day].closed)}
                                            style={{ fontSize: "0.72rem", padding: "0.25rem 0.6rem", borderRadius: 8, border: "1px solid #e2e8f0", background: profile.hours[day].closed ? "#e2e8f0" : "#faf5ff", color: profile.hours[day].closed ? "#64748b" : "#7c3aed", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                                            {profile.hours[day].closed ? "פתח" : "סגור"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Save */}
                        {saved && (
                            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "0.65rem 1rem", color: "#166534", fontSize: "0.85rem" }}>
                                ✅ הפרופיל עודכן בהצלחה!
                            </div>
                        )}
                        <button type="button" onClick={saveProfile} disabled={saving}
                            style={{ background: saving ? "#c4b5fd" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 14, padding: "0.85rem", fontWeight: 800, fontSize: "0.92rem", cursor: "pointer", width: "100%" }}>
                            {saving ? "שומר..." : "💾 שמור שינויים"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: "0.3rem" }}>{label}</label>
            {children}
        </div>
    );
}
