"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";

interface StudioInfo { name: string; slug: string; subscription_plan: string; }
interface BookingReq {
    id: string; client_name: string; client_phone: string;
    service_note: string | null; requested_at: string; status: string;
    artist_name?: string;
}
interface Me { display_name: string; email: string; role: string; studio_id: string; }

function getStudioToken() {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("biz_studio_token");
}

async function studioFetch<T>(path: string): Promise<T> {
    const token = getStudioToken();
    const res = await fetch(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.status === 401) { localStorage.removeItem("biz_studio_token"); throw new Error("401"); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
    pending:  { label: "ממתין",    bg: "#fef9c3", color: "#92400e" },
    approved: { label: "אושר ✅",  bg: "#dcfce7", color: "#166534" },
    rejected: { label: "נדחה",     bg: "#fee2e2", color: "#991b1b" },
};

export default function StudioDashboard() {
    const router = useRouter();
    const [me, setMe] = useState<Me | null>(null);
    const [studio, setStudio] = useState<StudioInfo | null>(null);
    const [bookings, setBookings] = useState<BookingReq[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"bookings" | "profile">("bookings");
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Profile edit form
    const [profileForm, setProfileForm] = useState({ description: "", city: "", phone: "", marketplace_visible: false });
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileSaved, setProfileSaved] = useState(false);

    useEffect(() => {
        if (!getStudioToken()) { router.replace("/studio/login"); return; }
        Promise.all([
            studioFetch<Me>("/api/auth/me"),
            studioFetch<BookingReq[]>("/api/booking-requests?status=pending&limit=50"),
        ]).then(([m, reqs]) => {
            setMe(m);
            setBookings(reqs);
            // Load studio name
            studioFetch<{ name: string; slug: string; subscription_plan: string }>("/api/automation/settings")
                .then(s => {
                    setStudio({ name: (s as any).studio_name || "", slug: (s as any).studio_slug || "", subscription_plan: (s as any).subscription_plan || "free" });
                    setProfileForm({
                        description: (s as any).marketplace_description || "",
                        city: (s as any).marketplace_city || "",
                        phone: (s as any).marketplace_phone || "",
                        marketplace_visible: (s as any).marketplace_visible ?? false,
                    });
                }).catch(() => {});
        }).catch(e => {
            if (e.message === "401") router.replace("/studio/login");
        }).finally(() => setLoading(false));
    }, [router]);

    const handleApprove = async (id: string) => {
        setActionLoading(id);
        try {
            await studioFetch(`/api/booking-requests/${id}/approve`);
            setBookings(bs => bs.filter(b => b.id !== id));
        } catch { } finally { setActionLoading(null); }
    };

    const handleReject = async (id: string) => {
        setActionLoading(id + "_r");
        try {
            await fetch(`${API}/api/booking-requests/${id}/reject`, {
                method: "POST", headers: { Authorization: `Bearer ${getStudioToken()}`, "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "לא מתאים" }),
            });
            setBookings(bs => bs.filter(b => b.id !== id));
        } catch { } finally { setActionLoading(null); }
    };

    const saveProfile = async () => {
        setProfileSaving(true);
        try {
            await fetch(`${API}/api/automation/settings`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${getStudioToken()}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    marketplace_description: profileForm.description,
                    marketplace_city: profileForm.city,
                    marketplace_phone: profileForm.phone,
                    marketplace_visible: profileForm.marketplace_visible,
                }),
            });
            setProfileSaved(true);
            setTimeout(() => setProfileSaved(false), 3000);
        } catch { } finally { setProfileSaving(false); }
    };

    const logout = () => {
        localStorage.removeItem("biz_studio_token");
        router.replace("/studio/login");
    };

    if (loading) return (
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8faff" }}>
            <div style={{ width: 44, height: 44, border: "4px solid #ede9fe", borderTopColor: "#7c3aed", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        </div>
    );

    const isPro = studio?.subscription_plan && !["free"].includes(studio.subscription_plan);
    const fmtDate = (s: string) => new Date(s).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#f8faff", fontFamily: "system-ui,sans-serif", color: "#1e293b" }}>

            {/* Header */}
            <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 1.5rem", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "0.82rem" }}>B</div>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: "0.95rem", lineHeight: 1.2 }}>{studio?.name || me?.display_name}</div>
                        <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>לוח בקרה · {me?.role}</div>
                    </div>
                </div>
                <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                    {studio?.slug && (
                        <Link href={`/b/${studio.slug}`} target="_blank"
                            style={{ fontSize: "0.78rem", color: "#7c3aed", textDecoration: "none", background: "#f5f3ff", padding: "0.35rem 0.7rem", borderRadius: 8, fontWeight: 600 }}>
                            👁️ הפרופיל שלי ↗
                        </Link>
                    )}
                    {isPro && (
                        <a href="https://www.biz-control.com/calendar" target="_blank" rel="noopener"
                            style={{ fontSize: "0.78rem", color: "#fff", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", padding: "0.35rem 0.7rem", borderRadius: 8, fontWeight: 700, textDecoration: "none" }}>
                            🚀 BizControl
                        </a>
                    )}
                    <button onClick={logout} style={{ fontSize: "0.78rem", color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>יציאה</button>
                </div>
            </header>

            {/* BizControl upgrade banner (free only) */}
            {!isPro && (
                <div style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", padding: "0.75rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
                    <div style={{ color: "#fff", fontSize: "0.88rem" }}>
                        <strong>🚀 שדרגו ל-BizControl</strong> — יומן, תשלומים, WhatsApp, AI ועוד
                    </div>
                    <a href="https://www.biz-control.com" target="_blank" rel="noopener"
                        style={{ background: "#fff", color: "#7c3aed", padding: "0.4rem 1rem", borderRadius: 8, fontWeight: 800, fontSize: "0.82rem", textDecoration: "none", whiteSpace: "nowrap" }}>
                        נסו בחינם ←
                    </a>
                </div>
            )}

            <div style={{ maxWidth: 860, margin: "0 auto", padding: "1.5rem 1.25rem" }}>

                {/* KPI row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
                    {[
                        { icon: "📥", label: "בקשות ממתינות", value: bookings.filter(b => b.status === "pending").length, color: "#7c3aed" },
                        { icon: "✅", label: "אושרו הכי בסוף", value: "—", color: "#16a34a" },
                        { icon: "👁️", label: "פרופיל פעיל", value: profileForm.marketplace_visible ? "כן" : "לא", color: profileForm.marketplace_visible ? "#16a34a" : "#94a3b8" },
                    ].map(k => (
                        <div key={k.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "1.1rem" }}>
                            <div style={{ fontSize: "1.5rem", marginBottom: "0.4rem" }}>{k.icon}</div>
                            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: k.color }}>{k.value}</div>
                            <div style={{ fontSize: "0.76rem", color: "#94a3b8", marginTop: "0.1rem" }}>{k.label}</div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: "0.4rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "0.3rem", width: "fit-content", marginBottom: "1.25rem" }}>
                    {([["bookings", "📥 בקשות תורים"], ["profile", "⚙️ פרופיל"]] as const).map(([id, label]) => (
                        <button key={id} onClick={() => setTab(id)} type="button"
                            style={{ padding: "0.5rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.85rem", transition: "all .2s", background: tab === id ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "transparent", color: tab === id ? "#fff" : "#64748b" }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* Bookings tab */}
                {tab === "bookings" && (
                    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, overflow: "hidden" }}>
                        <div style={{ padding: "1.1rem 1.25rem", borderBottom: "1px solid #f1f5f9" }}>
                            <h2 style={{ fontWeight: 800, fontSize: "1rem", margin: 0 }}>בקשות תורים ממתינות</h2>
                        </div>
                        {bookings.length === 0 ? (
                            <div style={{ padding: "3rem", textAlign: "center", color: "#94a3b8" }}>
                                <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✅</div>
                                <div>אין בקשות ממתינות כרגע</div>
                            </div>
                        ) : (
                            <div style={{ divide: "y" }}>
                                {bookings.map((b, i) => {
                                    const st = STATUS_STYLE[b.status] || STATUS_STYLE.pending;
                                    return (
                                        <div key={b.id} style={{ padding: "1rem 1.25rem", borderBottom: i < bookings.length - 1 ? "1px solid #f1f5f9" : "none", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                                            <div style={{ flex: 1, minWidth: 200 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
                                                    <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{b.client_name}</span>
                                                    <span style={{ background: st.bg, color: st.color, fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: 6 }}>{st.label}</span>
                                                </div>
                                                <div style={{ fontSize: "0.8rem", color: "#64748b" }}>📅 {fmtDate(b.requested_at)}</div>
                                                {b.service_note && <div style={{ fontSize: "0.8rem", color: "#7c3aed", marginTop: "0.2rem" }}>🛎️ {b.service_note}</div>}
                                                <a href={`tel:${b.client_phone}`} style={{ fontSize: "0.8rem", color: "#0ea5e9", textDecoration: "none", display: "block", marginTop: "0.2rem" }}>📞 {b.client_phone}</a>
                                            </div>
                                            {b.status === "pending" && (
                                                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                                                    <button onClick={() => handleApprove(b.id)} disabled={!!actionLoading} type="button"
                                                        style={{ background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.45rem 0.9rem", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
                                                        {actionLoading === b.id ? "..." : "✅ אשר"}
                                                    </button>
                                                    <button onClick={() => handleReject(b.id)} disabled={!!actionLoading} type="button"
                                                        style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 10, padding: "0.45rem 0.9rem", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
                                                        {actionLoading === b.id + "_r" ? "..." : "❌ דחה"}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Profile tab */}
                {tab === "profile" && (
                    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "1.5rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "1.25rem" }}>הגדרות פרופיל ציבורי</h2>

                        {/* Visible toggle */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem", background: "#f8faff", borderRadius: 14, marginBottom: "1.25rem", border: "1px solid #e2e8f0" }}>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>הפרופיל מוצג לציבור</div>
                                <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>כשמופעל — לקוחות יוכלו למצוא אתכם בחיפוש</div>
                            </div>
                            <button type="button" onClick={() => setProfileForm(f => ({ ...f, marketplace_visible: !f.marketplace_visible }))}
                                style={{ width: 48, height: 26, borderRadius: 13, border: "none", cursor: "pointer", position: "relative", background: profileForm.marketplace_visible ? "#7c3aed" : "#e2e8f0", transition: "background .2s", flexShrink: 0 }}>
                                <span style={{ position: "absolute", top: 2, right: profileForm.marketplace_visible ? 2 : "calc(100% - 24px)", width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "right .2s", boxShadow: "0 1px 4px rgba(0,0,0,.15)", display: "block" }} />
                            </button>
                        </div>

                        {[
                            { label: "עיר", key: "city", placeholder: "תל אביב", type: "text" },
                            { label: "טלפון לתצוגה ציבורית", key: "phone", placeholder: "050-0000000", type: "tel" },
                        ].map(f => (
                            <div key={f.key} style={{ marginBottom: "1rem" }}>
                                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: "0.35rem" }}>{f.label}</label>
                                <input type={f.type} value={(profileForm as any)[f.key]} placeholder={f.placeholder}
                                    onChange={e => setProfileForm(pf => ({ ...pf, [f.key]: e.target.value }))}
                                    style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.7rem 0.9rem", fontSize: "0.9rem", outline: "none", boxSizing: "border-box", background: "#fafafa" }}
                                    onFocus={e => (e.target.style.borderColor = "#7c3aed")}
                                    onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                                />
                            </div>
                        ))}

                        <div style={{ marginBottom: "1.25rem" }}>
                            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: "0.35rem" }}>תיאור הסטודיו</label>
                            <textarea value={profileForm.description} rows={4}
                                onChange={e => setProfileForm(pf => ({ ...pf, description: e.target.value }))}
                                placeholder="ספר על העסק שלכם — סגנון, ניסיון, מה מייחד אתכם..."
                                style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.7rem 0.9rem", fontSize: "0.9rem", outline: "none", boxSizing: "border-box", resize: "vertical", background: "#fafafa", lineHeight: 1.6 }}
                                onFocus={e => (e.target.style.borderColor = "#7c3aed")}
                                onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                            />
                        </div>

                        {profileSaved && (
                            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.6rem 0.9rem", color: "#166534", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                                ✅ הפרופיל עודכן בהצלחה!
                            </div>
                        )}

                        <button type="button" onClick={saveProfile} disabled={profileSaving}
                            style={{ background: profileSaving ? "#c4b5fd" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", borderRadius: 12, padding: "0.8rem 1.75rem", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer" }}>
                            {profileSaving ? "שומר..." : "שמור שינויים"}
                        </button>

                        {/* Link to full settings */}
                        {isPro && (
                            <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid #f1f5f9", textAlign: "center" }}>
                                <p style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: "0.6rem" }}>להגדרות מלאות (גלריה, שירותים, WhatsApp):</p>
                                <a href="https://www.biz-control.com/automation" target="_blank" rel="noopener"
                                    style={{ color: "#7c3aed", fontWeight: 700, fontSize: "0.85rem", textDecoration: "none" }}>
                                    פתח ב-BizControl ↗
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
