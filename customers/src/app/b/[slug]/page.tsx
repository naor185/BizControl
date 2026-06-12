"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API, imgUrl } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

interface Profile {
    slug: string; name: string; business_type_label: string; business_type_icon: string;
    logo_url?: string; cover_url?: string; primary_color: string;
    description?: string; city?: string; address?: string; map_link?: string;
    phone?: string; whatsapp?: string; instagram?: string; hours?: string;
    portfolio_link?: string; review_link_google?: string;
    self_booking_enabled: boolean;
    services: { id: string; name: string; duration_minutes: number; price_ils: number; color: string; description?: string; is_bookable_online: boolean }[];
    artists: { id: string; name: string }[];
    reviews: { id: string; client_name: string; rating: number; comment?: string; created_at: string }[];
    avg_rating?: number; review_count: number;
    gallery: string[];
}

type Day = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
interface DayHours { open: string; close: string; closed: boolean; }
type Hours = Record<Day, DayHours>;

const DAYS: Day[] = ["sun","mon","tue","wed","thu","fri","sat"];
const DAY_LABELS: Record<Day, string> = { sun:"ראשון", mon:"שני", tue:"שלישי", wed:"רביעי", thu:"חמישי", fri:"שישי", sat:"שבת" };

function dur(m: number) {
    if (m <= 0) return "";
    return m < 60 ? `${m} דק׳` : m % 60 === 0 ? `${m / 60} שע׳` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} שע׳`;
}

function isOpenNow(hours: Hours): { open: boolean; label: string } {
    const now = new Date();
    const dayIndex = now.getDay();
    const dayKey = DAYS[dayIndex];
    const day = hours[dayKey];
    if (!day || day.closed) return { open: false, label: "סגור כעת" };
    const [oh, om] = day.open.split(":").map(Number);
    const [ch, cm] = day.close.split(":").map(Number);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const openMin = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    if (nowMin >= openMin && nowMin < closeMin) return { open: true, label: `פתוח · סוגר ${day.close}` };
    if (nowMin < openMin) return { open: false, label: `נפתח ב-${day.open}` };
    return { open: false, label: "סגור כעת" };
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function BusinessPage() {
    const { slug } = useParams() as { slug: string };
    const [p, setP] = useState<Profile | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<{ url: string; index: number } | null>(null);
    const [showReview, setShowReview] = useState(false);
    const [reviewForm, setReviewForm] = useState({ client_name: "", rating: 5, comment: "" });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [activeTab, setActiveTab] = useState<"about" | "services" | "gallery" | "reviews">("about");
    const [showRequestModal, setShowRequestModal] = useState(false);

    useEffect(() => {
        fetch(`${API}/api/marketplace/${slug}`)
            .then(r => r.ok ? r.json() : Promise.reject("לא נמצא"))
            .then(setP).catch(() => setErr("העסק לא נמצא"));
        // Track page view (fire-and-forget)
        fetch(`${API}/api/marketplace/${slug}/view`, { method: "POST" }).catch(() => {});
    }, [slug]);

    const submitReview = async () => {
        if (!reviewForm.client_name) return;
        setSubmitting(true);
        try {
            await fetch(`${API}/api/marketplace/${slug}/reviews`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(reviewForm),
            });
            setSubmitted(true); setShowReview(false);
        } catch { } finally { setSubmitting(false); }
    };

    const navLightbox = (dir: 1 | -1) => {
        if (!lightbox || !p) return;
        const next = lightbox.index + dir;
        if (next >= 0 && next < p.gallery.length)
            setLightbox({ url: imgUrl(p.gallery[next]), index: next });
    };

    if (!p && !err) return (
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" }}>
            <div style={{ width: 48, height: 48, border: "4px solid rgba(167,139,250,.25)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        </div>
    );
    if (err) return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", background: "#0f172a", color: "#f1f5f9" }}>
            <div style={{ fontSize: "3.5rem" }}>😔</div>
            <div style={{ color: "#f87171", fontWeight: 700 }}>{err}</div>
            <Link href="/" style={{ color: "#a78bfa", textDecoration: "none", fontSize: "0.9rem" }}>← חזרה לחיפוש</Link>
        </div>
    );

    const primary = p!.primary_color || "#7c3aed";
    let hours: Hours | null = null;
    if (p!.hours) { try { hours = JSON.parse(p!.hours); } catch {} }
    const openStatus = hours ? isOpenNow(hours) : null;
    const bookableServices = p!.services.filter(s => s.is_bookable_online);
    const hasGallery = p!.gallery.length > 0;

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", fontFamily: "system-ui,sans-serif" }}>

            {/* ── Lightbox ── */}
            {lightbox && (
                <div onClick={() => setLightbox(null)}
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.95)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <button onClick={e => { e.stopPropagation(); navLightbox(-1); }}
                        style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.12)", border: "none", color: "#fff", fontSize: "1.5rem", width: 44, height: 44, borderRadius: "50%", cursor: "pointer" }}>›</button>
                    <img src={lightbox.url} alt="" onClick={e => e.stopPropagation()}
                        style={{ maxWidth: "88vw", maxHeight: "88vh", borderRadius: 16, objectFit: "contain", boxShadow: "0 20px 60px rgba(0,0,0,.6)" }} />
                    <button onClick={e => { e.stopPropagation(); navLightbox(1); }}
                        style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.12)", border: "none", color: "#fff", fontSize: "1.5rem", width: 44, height: 44, borderRadius: "50%", cursor: "pointer" }}>‹</button>
                    <button onClick={() => setLightbox(null)}
                        style={{ position: "absolute", top: 16, left: 16, background: "rgba(255,255,255,.12)", border: "none", color: "#fff", fontSize: "1.1rem", width: 36, height: 36, borderRadius: "50%", cursor: "pointer" }}>✕</button>
                    <div style={{ position: "absolute", bottom: 16, color: "rgba(255,255,255,.5)", fontSize: "0.8rem" }}>{lightbox.index + 1} / {p!.gallery.length}</div>
                </div>
            )}

            {/* ── Hero ── */}
            <div style={{ position: "relative", height: 300, overflow: "hidden" }}>
                {p!.cover_url ? (
                    <img src={imgUrl(p!.cover_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg,${primary}cc 0%,#1e1b4b 100%)` }} />
                )}
                {/* Gradient overlay */}
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,rgba(15,23,42,.15) 0%,rgba(15,23,42,.85) 70%,#0f172a 100%)" }} />

                {/* Back */}
                <Link href="/" style={{ position: "absolute", top: 14, right: 14, background: "rgba(0,0,0,.45)", backdropFilter: "blur(8px)", color: "#fff", textDecoration: "none", padding: "0.4rem 0.85rem", borderRadius: 10, fontSize: "0.82rem", border: "1px solid rgba(255,255,255,.15)", fontWeight: 600 }}>
                    ← חזרה
                </Link>

                {/* Share */}
                <button type="button" onClick={() => navigator.share?.({ title: p!.name, url: window.location.href })}
                    style={{ position: "absolute", top: 14, left: 14, background: "rgba(0,0,0,.45)", backdropFilter: "blur(8px)", color: "#fff", border: "1px solid rgba(255,255,255,.15)", padding: "0.4rem 0.85rem", borderRadius: 10, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}>
                    ⬆️ שתף
                </button>

                {/* Gallery preview strip (bottom of hero) */}
                {hasGallery && (
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 1rem 0.5rem", display: "flex", gap: "0.4rem", overflowX: "hidden" }}>
                        {p!.gallery.slice(0, 5).map((url, i) => (
                            <div key={i} onClick={() => setLightbox({ url: imgUrl(url), index: i })}
                                style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 10, overflow: "hidden", border: "2px solid rgba(255,255,255,.3)", cursor: "zoom-in", opacity: 0.85 }}>
                                <img src={imgUrl(url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            </div>
                        ))}
                        {p!.gallery.length > 5 && (
                            <button type="button" onClick={() => setActiveTab("gallery")}
                                style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 10, border: "2px solid rgba(255,255,255,.3)", background: "rgba(0,0,0,.5)", color: "#fff", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", backdropFilter: "blur(4px)" }}>
                                +{p!.gallery.length - 5}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── Main content ── */}
            <div style={{ maxWidth: 840, margin: "0 auto", padding: "0 1.25rem 6rem" }}>

                {/* ── Identity card ── */}
                <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", marginTop: "1.25rem", marginBottom: "1.25rem" }}>
                    {/* Logo */}
                    {p!.logo_url ? (
                        <img src={imgUrl(p!.logo_url)} alt="" style={{ width: 80, height: 80, borderRadius: 20, objectFit: "cover", border: `3px solid ${primary}66`, flexShrink: 0, boxShadow: `0 4px 24px ${primary}44` }} />
                    ) : (
                        <div style={{ width: 80, height: 80, borderRadius: 20, background: `${primary}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem", border: `2px solid ${primary}44`, flexShrink: 0 }}>{p!.business_type_icon}</div>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h1 style={{ fontSize: "1.55rem", fontWeight: 900, color: "#f1f5f9", margin: "0 0 0.25rem", lineHeight: 1.2 }}>{p!.name}</h1>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
                            <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{p!.business_type_icon} {p!.business_type_label}</span>
                            {p!.city && <><span style={{ color: "#475569" }}>·</span><span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>📍 {p!.city}</span></>}
                            {openStatus && (
                                <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "0.18rem 0.55rem", borderRadius: 20, background: openStatus.open ? "rgba(74,222,128,.12)" : "rgba(239,68,68,.1)", color: openStatus.open ? "#4ade80" : "#f87171", border: `1px solid ${openStatus.open ? "rgba(74,222,128,.3)" : "rgba(239,68,68,.25)"}` }}>
                                    {openStatus.open ? "🟢" : "🔴"} {openStatus.label}
                                </span>
                            )}
                        </div>
                        {p!.avg_rating != null && p!.review_count > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.35rem" }}>
                                <span style={{ color: "#fbbf24" }}>{"★".repeat(Math.round(p!.avg_rating))}</span>
                                <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: "0.85rem" }}>{p!.avg_rating.toFixed(1)}</span>
                                <span style={{ color: "#475569", fontSize: "0.78rem" }}>({p!.review_count} ביקורות)</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── CTA buttons ── */}
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
                    {p!.self_booking_enabled ? (
                        <Link href={`/b/${slug}/book`}
                            style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", textDecoration: "none", padding: "0.7rem 1.3rem", borderRadius: 14, fontWeight: 800, fontSize: "0.9rem", boxShadow: `0 4px 16px ${primary}44` }}>
                            📅 קביעת תור
                        </Link>
                    ) : (
                        <button type="button" onClick={() => setShowRequestModal(true)}
                            style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", border: "none", padding: "0.7rem 1.3rem", borderRadius: 14, fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", boxShadow: `0 4px 16px ${primary}44` }}>
                            📋 בקש תור
                        </button>
                    )}
                    {p!.whatsapp && (
                        <a href={`https://wa.me/${p!.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener"
                            style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(37,211,102,.12)", border: "1px solid rgba(37,211,102,.3)", color: "#25d366", textDecoration: "none", padding: "0.7rem 1.1rem", borderRadius: 14, fontWeight: 700, fontSize: "0.86rem" }}>
                            💬 WhatsApp
                        </a>
                    )}
                    {p!.phone && (
                        <a href={`tel:${p!.phone}`}
                            style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.1rem", borderRadius: 14, fontWeight: 600, fontSize: "0.86rem" }}>
                            📞 התקשר
                        </a>
                    )}
                    {p!.map_link && (
                        <a href={p!.map_link} target="_blank" rel="noopener"
                            style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.1rem", borderRadius: 14, fontWeight: 600, fontSize: "0.86rem" }}>
                            🗺️ ניווט
                        </a>
                    )}
                    {p!.instagram && (
                        <a href={p!.instagram} target="_blank" rel="noopener"
                            style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(236,72,153,.1)", border: "1px solid rgba(236,72,153,.25)", color: "#f472b6", textDecoration: "none", padding: "0.7rem 1.1rem", borderRadius: 14, fontWeight: 600, fontSize: "0.86rem" }}>
                            📸 Instagram
                        </a>
                    )}
                    {p!.portfolio_link && (
                        <a href={p!.portfolio_link} target="_blank" rel="noopener"
                            style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.1rem", borderRadius: 14, fontWeight: 600, fontSize: "0.86rem" }}>
                            🖼️ תיק עבודות
                        </a>
                    )}
                </div>

                {/* ── Tabs ── */}
                <div style={{ display: "flex", gap: "0.25rem", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "0.3rem", marginBottom: "1.5rem", overflowX: "auto" }}>
                    {([
                        ["about",    "ℹ️ אודות"],
                        ["services", `🛎️ שירותים${p!.services.length > 0 ? ` (${p!.services.length})` : ""}`],
                        ...(hasGallery ? [["gallery", `🖼️ גלריה (${p!.gallery.length})`]] as const : []),
                        ["reviews",  `⭐ ביקורות${p!.review_count > 0 ? ` (${p!.review_count})` : ""}`],
                    ] as [string, string][]).map(([id, label]) => (
                        <button key={id} type="button" onClick={() => setActiveTab(id as any)}
                            style={{ padding: "0.5rem 1rem", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", whiteSpace: "nowrap", transition: "all .15s", background: activeTab === id ? `linear-gradient(135deg,${primary},#4c1d95)` : "transparent", color: activeTab === id ? "#fff" : "#64748b" }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── Tab: About ── */}
                {activeTab === "about" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        {/* Description */}
                        {p!.description && (
                            <Card>
                                <SectionTitle>📖 אודות</SectionTitle>
                                <p style={{ color: "#94a3b8", lineHeight: 1.8, fontSize: "0.9rem", margin: 0 }}>{p!.description}</p>
                            </Card>
                        )}

                        {/* Address */}
                        {p!.address && (
                            <Card>
                                <SectionTitle>📍 כתובת</SectionTitle>
                                <div style={{ color: "#94a3b8", fontSize: "0.88rem", marginBottom: "0.6rem" }}>{p!.address}</div>
                                {p!.map_link && (
                                    <a href={p!.map_link} target="_blank" rel="noopener"
                                        style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "#a78bfa", fontSize: "0.82rem", fontWeight: 600, textDecoration: "none" }}>
                                        פתח ב-Google Maps ↗
                                    </a>
                                )}
                            </Card>
                        )}

                        {/* Hours */}
                        {hours && (
                            <Card>
                                <SectionTitle>🕐 שעות פתיחה</SectionTitle>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                                    {DAYS.map(day => {
                                        const d = hours![day];
                                        const todayIdx = new Date().getDay();
                                        const isToday = DAYS[todayIdx] === day;
                                        return (
                                            <div key={day} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.45rem 0.75rem", borderRadius: 10, background: isToday ? `${primary}18` : "rgba(255,255,255,.03)", border: isToday ? `1px solid ${primary}44` : "1px solid transparent" }}>
                                                <span style={{ fontSize: "0.84rem", fontWeight: isToday ? 800 : 500, color: isToday ? "#c4b5fd" : "#94a3b8" }}>{DAY_LABELS[day]}{isToday ? " ← היום" : ""}</span>
                                                <span style={{ fontSize: "0.82rem", fontWeight: 600, color: d.closed ? "#f87171" : "#4ade80" }}>
                                                    {d.closed ? "סגור" : `${d.open} – ${d.close}`}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </Card>
                        )}

                        {/* Team */}
                        {p!.artists.length > 0 && (
                            <Card>
                                <SectionTitle>👥 הצוות</SectionTitle>
                                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                                    {p!.artists.map(a => (
                                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: `${primary}18`, border: `1px solid ${primary}33`, borderRadius: 12, padding: "0.45rem 0.85rem" }}>
                                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${primary}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800, color: "#c4b5fd" }}>
                                                {a.name.charAt(0)}
                                            </div>
                                            <span style={{ fontWeight: 600, fontSize: "0.86rem", color: "#c4b5fd" }}>{a.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                    </div>
                )}

                {/* ── Tab: Services ── */}
                {activeTab === "services" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                        {p!.services.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>אין שירותים להצגה</div>
                        ) : p!.services.map(s => (
                            <div key={s.id} style={{ background: "rgba(255,255,255,.04)", border: `1px solid rgba(255,255,255,.07)`, borderRadius: 18, padding: "1rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", position: "relative", overflow: "hidden" }}>
                                {/* Color stripe */}
                                <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 4, background: s.color || primary, borderRadius: "0 18px 18px 0" }} />
                                <div style={{ flex: 1, paddingRight: "0.5rem" }}>
                                    <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#f1f5f9", marginBottom: "0.2rem" }}>{s.name}</div>
                                    {s.description && <div style={{ color: "#64748b", fontSize: "0.78rem", lineHeight: 1.5 }}>{s.description}</div>}
                                    {s.is_bookable_online && <span style={{ display: "inline-block", marginTop: "0.35rem", fontSize: "0.68rem", fontWeight: 700, color: "#4ade80", background: "rgba(74,222,128,.1)", border: "1px solid rgba(74,222,128,.25)", borderRadius: 6, padding: "0.15rem 0.5rem" }}>📅 ניתן להזמנה</span>}
                                </div>
                                <div style={{ textAlign: "left", flexShrink: 0 }}>
                                    {s.duration_minutes > 0 && <div style={{ color: "#64748b", fontSize: "0.78rem", marginBottom: "0.2rem" }}>⏱ {dur(s.duration_minutes)}</div>}
                                    {s.price_ils > 0 && <div style={{ color: "#4ade80", fontWeight: 900, fontSize: "1.05rem" }}>₪{s.price_ils}</div>}
                                </div>
                            </div>
                        ))}

                        {p!.self_booking_enabled && bookableServices.length > 0 && (
                            <Link href={`/b/${slug}/book`}
                                style={{ display: "block", marginTop: "0.5rem", textAlign: "center", background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", textDecoration: "none", padding: "0.9rem", borderRadius: 16, fontWeight: 800, fontSize: "0.95rem", boxShadow: `0 4px 20px ${primary}44` }}>
                                📅 קביעת תור עכשיו
                            </Link>
                        )}
                    </div>
                )}

                {/* ── Tab: Gallery ── */}
                {activeTab === "gallery" && hasGallery && (
                    <div>
                        {/* Masonry-style: first photo big, rest smaller */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
                            {p!.gallery.map((url, i) => (
                                <div key={i}
                                    onClick={() => setLightbox({ url: imgUrl(url), index: i })}
                                    style={{
                                        gridColumn: i === 0 ? "1 / 3" : undefined,
                                        gridRow: i === 0 ? "1 / 3" : undefined,
                                        borderRadius: 14, overflow: "hidden",
                                        aspectRatio: i === 0 ? "1.2" : "1",
                                        cursor: "zoom-in", background: "#1e293b",
                                    }}>
                                    <img src={imgUrl(url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform .25s" }}
                                        onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
                                        onMouseLeave={e => (e.currentTarget.style.transform = "")}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Tab: Reviews ── */}
                {activeTab === "reviews" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                        {/* Summary bar */}
                        {p!.avg_rating != null && p!.review_count > 0 && (
                            <Card>
                                <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
                                    <div style={{ textAlign: "center" }}>
                                        <div style={{ fontSize: "2.8rem", fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>{p!.avg_rating.toFixed(1)}</div>
                                        <div style={{ color: "#fbbf24", fontSize: "1rem" }}>{"★".repeat(Math.round(p!.avg_rating))}</div>
                                        <div style={{ color: "#64748b", fontSize: "0.72rem", marginTop: "0.2rem" }}>{p!.review_count} ביקורות</div>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        {[5,4,3,2,1].map(n => {
                                            const cnt = p!.reviews.filter(r => r.rating === n).length;
                                            const pct = p!.review_count > 0 ? (cnt / p!.review_count) * 100 : 0;
                                            return (
                                                <div key={n} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
                                                    <span style={{ fontSize: "0.72rem", color: "#64748b", width: 8, flexShrink: 0 }}>{n}</span>
                                                    <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,.08)", borderRadius: 3, overflow: "hidden" }}>
                                                        <div style={{ height: "100%", width: `${pct}%`, background: "#fbbf24", borderRadius: 3, transition: "width .4s" }} />
                                                    </div>
                                                    <span style={{ fontSize: "0.68rem", color: "#64748b", width: 20, textAlign: "left" }}>{cnt}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </Card>
                        )}

                        {/* Add review */}
                        {!submitted && (
                            <button type="button" onClick={() => setShowReview(v => !v)}
                                style={{ background: `${primary}18`, border: `1px solid ${primary}44`, borderRadius: 14, color: "#c4b5fd", padding: "0.7rem", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", width: "100%", textAlign: "center" }}>
                                {showReview ? "ביטול" : "✏️ כתוב ביקורת"}
                            </button>
                        )}
                        {submitted && (
                            <div style={{ background: "rgba(74,222,128,.08)", border: "1px solid rgba(74,222,128,.25)", borderRadius: 14, padding: "0.9rem 1rem", color: "#4ade80", fontSize: "0.88rem", textAlign: "center" }}>
                                ✅ תודה! הביקורת נשלחה לאישור.
                            </div>
                        )}
                        {showReview && (
                            <Card>
                                <SectionTitle>כתוב ביקורת</SectionTitle>
                                <div style={{ marginBottom: "0.75rem" }}>
                                    <label style={labelStyle}>שם מלא *</label>
                                    <input value={reviewForm.client_name} onChange={e => setReviewForm(f => ({ ...f, client_name: e.target.value }))}
                                        style={reviewInputStyle}
                                        onFocus={e => e.target.style.borderColor = primary}
                                        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,.12)"}
                                        placeholder="השם שיופיע בביקורת" />
                                </div>
                                <div style={{ marginBottom: "0.75rem" }}>
                                    <label style={labelStyle}>דירוג</label>
                                    <div style={{ display: "flex", gap: "0.1rem" }}>
                                        {[1,2,3,4,5].map(n => (
                                            <button key={n} type="button" onClick={() => setReviewForm(f => ({ ...f, rating: n }))}
                                                style={{ background: "none", border: "none", fontSize: "1.9rem", cursor: "pointer", color: n <= reviewForm.rating ? "#fbbf24" : "#334155", padding: "0 0.1rem", transition: "color .1s" }}>★</button>
                                        ))}
                                    </div>
                                </div>
                                <div style={{ marginBottom: "1rem" }}>
                                    <label style={labelStyle}>תגובה (אופציונלי)</label>
                                    <textarea value={reviewForm.comment} onChange={e => setReviewForm(f => ({ ...f, comment: e.target.value }))}
                                        rows={3} placeholder="שתפו את החוויה שלכם..."
                                        style={{ ...reviewInputStyle, resize: "vertical", lineHeight: 1.6 }}
                                        onFocus={e => e.target.style.borderColor = primary}
                                        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,.12)"}
                                    />
                                </div>
                                <button type="button" onClick={submitReview} disabled={submitting || !reviewForm.client_name}
                                    style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, border: "none", borderRadius: 12, color: "#fff", padding: "0.65rem 1.4rem", fontWeight: 800, cursor: "pointer", opacity: submitting || !reviewForm.client_name ? 0.6 : 1, fontSize: "0.9rem" }}>
                                    {submitting ? "שולח..." : "📤 שלח ביקורת"}
                                </button>
                            </Card>
                        )}

                        {/* Reviews list */}
                        {p!.reviews.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "2.5rem", color: "#475569", border: "1px dashed rgba(255,255,255,.07)", borderRadius: 16 }}>
                                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>💬</div>
                                <div>אין ביקורות עדיין — היה ראשון!</div>
                            </div>
                        ) : p!.reviews.map(r => (
                            <div key={r.id} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 16, padding: "1rem 1.1rem" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${primary}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.78rem", fontWeight: 800, color: "#c4b5fd" }}>
                                            {r.client_name.charAt(0)}
                                        </div>
                                        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{r.client_name}</span>
                                    </div>
                                    <div style={{ color: "#fbbf24", fontSize: "0.82rem" }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                                </div>
                                {r.comment && <p style={{ color: "#94a3b8", fontSize: "0.84rem", lineHeight: 1.65, margin: 0 }}>{r.comment}</p>}
                                <div style={{ color: "#334155", fontSize: "0.7rem", marginTop: "0.4rem" }}>
                                    {new Date(r.created_at).toLocaleDateString("he-IL")}
                                </div>
                            </div>
                        ))}

                        {p!.review_link_google && (
                            <a href={p!.review_link_google} target="_blank" rel="noopener"
                                style={{ display: "block", textAlign: "center", color: "#94a3b8", fontSize: "0.82rem", textDecoration: "none", padding: "0.5rem" }}>
                                ⭐ כתוב ביקורת ב-Google ↗
                            </a>
                        )}
                    </div>
                )}
            </div>

            {/* ── Floating bottom bar (mobile) ── */}
            {p!.self_booking_enabled && (
                <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "0.75rem 1.25rem", background: "rgba(15,23,42,.96)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", gap: "0.6rem", zIndex: 50 }}>
                    <Link href={`/b/${slug}/book`}
                        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", textDecoration: "none", padding: "0.8rem", borderRadius: 14, fontWeight: 800, fontSize: "0.92rem", boxShadow: `0 4px 16px ${primary}44` }}>
                        📅 קביעת תור
                    </Link>
                    {p!.whatsapp && (
                        <a href={`https://wa.me/${p!.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener"
                            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(37,211,102,.15)", border: "1px solid rgba(37,211,102,.35)", color: "#25d366", textDecoration: "none", padding: "0.8rem 1rem", borderRadius: 14, fontWeight: 700, fontSize: "0.86rem" }}>
                            💬
                        </a>
                    )}
                    {p!.phone && (
                        <a href={`tel:${p!.phone}`}
                            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", color: "#e2e8f0", textDecoration: "none", padding: "0.8rem 1rem", borderRadius: 14, fontWeight: 600, fontSize: "0.86rem" }}>
                            📞
                        </a>
                    )}
                </div>
            )}
        </div>

        {showRequestModal && (
            <RequestModal
                slug={slug}
                studioName={p!.name}
                services={p!.services.map(s => s.name)}
                primary={primary}
                onClose={() => setShowRequestModal(false)}
            />
        )}
    );
}

// ── Request Modal ─────────────────────────────────────────────────────────────

function RequestModal({ slug, studioName, services, primary, onClose }: {
    slug: string; studioName: string; services: string[]; primary: string; onClose: () => void;
}) {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [service, setService] = useState("");
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

    const submit = async () => {
        if (!name.trim() || !phone.trim()) { setErr("שם וטלפון נדרשים"); return; }
        setLoading(true); setErr(null);
        try {
            const r = await fetch(`${API}/api/book/${slug}/request`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_name: name.trim(), client_phone: phone.trim(), service_name: service || undefined, notes: notes || undefined }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "שגיאה"); }
            setDone(true);
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setLoading(false); }
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
            onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={{ background: "#1e293b", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: "1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                    <div>
                        <div style={{ fontWeight: 900, fontSize: "1.1rem" }}>📋 בקשת תור</div>
                        <div style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "0.2rem" }}>{studioName} יחזור אליך בהקדם</div>
                    </div>
                    <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: "1.5rem", cursor: "pointer" }}>×</button>
                </div>

                {done ? (
                    <div style={{ textAlign: "center", padding: "2rem 0" }}>
                        <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>✅</div>
                        <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.5rem" }}>הבקשה נשלחה!</div>
                        <div style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: "1.5rem" }}>הסטודיו יצור איתך קשר בקרוב 📞</div>
                        <button type="button" onClick={onClose}
                            style={{ background: primary, color: "#fff", border: "none", borderRadius: 12, padding: "0.75rem 2rem", fontWeight: 800, cursor: "pointer" }}>
                            סגור
                        </button>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                            <div>
                                <label style={reqLabel}>שם מלא *</label>
                                <input value={name} onChange={e => setName(e.target.value)} placeholder="שם פרטי ומשפחה" style={reqInput} />
                            </div>
                            <div>
                                <label style={reqLabel}>טלפון *</label>
                                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="050..." type="tel" dir="ltr" style={reqInput} />
                            </div>
                        </div>
                        {services.length > 0 && (
                            <div>
                                <label style={reqLabel}>שירות מבוקש</label>
                                <select value={service} onChange={e => setService(e.target.value)} style={reqInput}>
                                    <option value="">בחר שירות...</option>
                                    {services.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        )}
                        <div>
                            <label style={reqLabel}>הערות (זמן מועדף, פרטים נוספים)</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                                placeholder="לדוגמה: מחפש תור בערב, עדיפות יום חמישי..."
                                style={{ ...reqInput, resize: "vertical", height: 72 }} />
                        </div>
                        {err && <p style={{ color: "#f87171", fontSize: "0.8rem", margin: 0 }}>{err}</p>}
                        <button type="button" onClick={submit} disabled={loading}
                            style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", border: "none", borderRadius: 14, padding: "0.9rem", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer", opacity: loading ? 0.7 : 1 }}>
                            {loading ? "שולח..." : "שלח בקשה 📋"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

const reqLabel: React.CSSProperties = { display: "block", color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.3rem" };
const reqInput: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, padding: "0.65rem 0.85rem", color: "#f1f5f9", fontSize: "0.9rem", outline: "none", boxSizing: "border-box" };

// ── UI helpers ────────────────────────────────────────────────────────────────

const reviewInputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.06)", border: "1.5px solid rgba(255,255,255,.12)",
    borderRadius: 12, padding: "0.65rem 0.85rem", color: "#f1f5f9", fontSize: "0.9rem",
    outline: "none", boxSizing: "border-box", transition: "border-color .2s",
};
const labelStyle: React.CSSProperties = {
    display: "block", color: "#64748b", fontSize: "0.78rem", marginBottom: "0.3rem", fontWeight: 600,
};

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 20, padding: "1.25rem" }}>
            {children}
        </div>
    );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
    return <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#e2e8f0", marginBottom: "0.85rem" }}>{children}</div>;
}
