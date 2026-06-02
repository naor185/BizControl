"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

function imgUrl(url: string) {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${API}${url}`;
}

interface Profile {
    slug: string; name: string; business_type_label: string; business_type_icon: string;
    logo_url?: string; cover_url?: string; primary_color: string;
    description?: string; city?: string; address?: string; map_link?: string;
    phone?: string; portfolio_link?: string; review_link_google?: string;
    self_booking_enabled: boolean;
    services: { id: string; name: string; duration_minutes: number; price_ils: number; color: string; description?: string; is_bookable_online: boolean }[];
    artists: { id: string; name: string }[];
    reviews: { id: string; client_name: string; rating: number; comment?: string; created_at: string }[];
    avg_rating?: number; review_count: number;
    gallery: string[];
}

function Stars({ n, size = "1rem" }: { n: number; size?: string }) {
    return <span style={{ color: "#fbbf24", fontSize: size }}>{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}

function durLabel(m: number) {
    if (m === 0) return "";
    return m < 60 ? `${m} דק׳` : m % 60 === 0 ? `${m / 60} שע׳` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} שע׳`;
}

export default function ProfilePage() {
    const { slug } = useParams() as { slug: string };
    const [profile, setProfile] = useState<Profile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [reviewForm, setReviewForm] = useState({ client_name: "", rating: 5, comment: "" });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [lightbox, setLightbox] = useState<string | null>(null);

    useEffect(() => {
        fetch(`${API}/api/marketplace/${slug}`)
            .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || "Not found")))
            .then(setProfile)
            .catch(e => setError(typeof e === "string" ? e : "הפרופיל לא נמצא"));
    }, [slug]);

    const submitReview = async () => {
        if (!reviewForm.client_name) return;
        setSubmitting(true);
        try {
            await fetch(`${API}/api/marketplace/${slug}/reviews`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(reviewForm),
            });
            setSubmitted(true);
            setShowReviewForm(false);
        } catch { }
        finally { setSubmitting(false); }
    };

    if (!profile && !error) return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" }}>
            <div style={{ width: 48, height: 48, border: "4px solid rgba(167,139,250,.3)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
    if (error) return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#f87171", textAlign: "center", padding: "2rem" }} dir="rtl">
            <div><div style={{ fontSize: "4rem", marginBottom: "1rem" }}>😔</div><p>{error}</p><Link href="/explore" style={{ color: "#a78bfa", marginTop: "1rem", display: "block" }}>← חזרה לחיפוש</Link></div>
        </div>
    );

    const p = profile!;
    const primary = p.primary_color || "#7c3aed";

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", fontFamily: "system-ui,sans-serif" }}>

            {/* Lightbox */}
            {lightbox && (
                <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
                    <img src={lightbox} alt="" style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }} />
                </div>
            )}

            {/* Hero / Cover */}
            <div style={{ height: 280, position: "relative", overflow: "hidden" }}>
                {p.cover_url ? (
                    <img src={imgUrl(p.cover_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg,${primary}88,#1e1b4b)` }} />
                )}
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,rgba(15,23,42,.3) 0%,rgba(15,23,42,.95) 100%)" }} />
                <Link href="/explore" style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,.5)", backdropFilter: "blur(8px)", color: "#fff", textDecoration: "none", padding: "0.45rem 1rem", borderRadius: 12, fontSize: "0.85rem", border: "1px solid rgba(255,255,255,.15)" }}>
                    ← חזרה
                </Link>
            </div>

            {/* Content */}
            <div style={{ maxWidth: 820, margin: "-80px auto 0", padding: "0 1.25rem 4rem", position: "relative" }}>

                {/* Studio header card */}
                <div style={{ background: "rgba(30,27,74,.9)", backdropFilter: "blur(12px)", border: "1px solid rgba(167,139,250,.2)", borderRadius: 24, padding: "1.5rem", marginBottom: "1.5rem" }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "1.25rem", marginBottom: "1.25rem" }}>
                        {p.logo_url ? (
                            <img src={imgUrl(p.logo_url)} alt="" style={{ width: 80, height: 80, borderRadius: 18, objectFit: "cover", border: "3px solid rgba(167,139,250,.4)", flexShrink: 0 }} />
                        ) : (
                            <div style={{ width: 80, height: 80, borderRadius: 18, background: `${primary}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.2rem", border: "3px solid rgba(167,139,250,.3)", flexShrink: 0 }}>
                                {p.business_type_icon}
                            </div>
                        )}
                        <div style={{ flex: 1, paddingBottom: "0.25rem" }}>
                            <h1 style={{ fontSize: "1.75rem", fontWeight: 900, margin: "0 0 0.2rem", color: "#f1f5f9" }}>{p.name}</h1>
                            <div style={{ color: "#94a3b8", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                <span>{p.business_type_icon} {p.business_type_label}</span>
                                {p.city && <span>· 📍 {p.city}</span>}
                            </div>
                            {p.avg_rating != null && (
                                <div style={{ marginTop: "0.3rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                    <Stars n={Math.round(p.avg_rating)} size="0.9rem" />
                                    <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: "0.85rem" }}>{p.avg_rating.toFixed(1)}</span>
                                    <span style={{ color: "#64748b", fontSize: "0.8rem" }}>({p.review_count} ביקורות)</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* CTA buttons */}
                    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                        {p.self_booking_enabled && (
                            <Link href={`/book/${slug}`} style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", textDecoration: "none", padding: "0.7rem 1.4rem", borderRadius: 14, fontWeight: 700, fontSize: "0.9rem", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                                📅 קבע תור
                            </Link>
                        )}
                        {p.phone && (
                            <a href={`tel:${p.phone}`} style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.2rem", borderRadius: 14, fontWeight: 600, fontSize: "0.88rem" }}>
                                📞 התקשר
                            </a>
                        )}
                        {p.map_link && (
                            <a href={p.map_link} target="_blank" rel="noopener" style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.2rem", borderRadius: 14, fontWeight: 600, fontSize: "0.88rem" }}>
                                🗺️ ניווט
                            </a>
                        )}
                        {p.portfolio_link && (
                            <a href={p.portfolio_link} target="_blank" rel="noopener" style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.2rem", borderRadius: 14, fontWeight: 600, fontSize: "0.88rem" }}>
                                🖼️ פורטפוליו
                            </a>
                        )}
                    </div>

                    {/* Description */}
                    {p.description && (
                        <p style={{ marginTop: "1rem", color: "#94a3b8", lineHeight: 1.75, fontSize: "0.92rem", borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: "1rem", marginBottom: 0 }}>
                            {p.description}
                        </p>
                    )}
                </div>

                {/* Gallery */}
                {p.gallery.length > 0 && (
                    <div style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.85rem", color: "#e2e8f0" }}>🖼️ גלריה</h2>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: "0.6rem" }}>
                            {p.gallery.map((url, i) => (
                                <div key={i} onClick={() => setLightbox(imgUrl(url))} style={{ cursor: "zoom-in", borderRadius: 14, overflow: "hidden", aspectRatio: "1", background: "#1e293b" }}>
                                    <img src={imgUrl(url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform .2s" }}
                                        onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
                                        onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Services */}
                {p.services.length > 0 && (
                    <div style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.85rem", color: "#e2e8f0" }}>🛎️ שירותים</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {p.services.map(s => (
                                <div key={s.id} style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${s.color}33`, borderRight: `3px solid ${s.color}`, borderRadius: 14, padding: "0.85rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{s.name}</div>
                                        {s.description && <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.15rem" }}>{s.description}</div>}
                                    </div>
                                    <div style={{ textAlign: "left", flexShrink: 0, marginRight: "0.5rem" }}>
                                        {s.duration_minutes > 0 && <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{durLabel(s.duration_minutes)}</div>}
                                        {s.price_ils > 0 && <div style={{ color: "#4ade80", fontWeight: 800, fontSize: "0.95rem" }}>₪{s.price_ils}</div>}
                                        {s.price_ils === 0 && <div style={{ color: "#64748b", fontSize: "0.8rem" }}>חינם</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Team */}
                {p.artists.length > 0 && (
                    <div style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.85rem", color: "#e2e8f0" }}>👥 הצוות</h2>
                        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                            {p.artists.map(a => (
                                <div key={a.id} style={{ background: "rgba(167,139,250,.1)", border: "1px solid rgba(167,139,250,.25)", borderRadius: 12, padding: "0.6rem 1rem", fontWeight: 600, fontSize: "0.88rem", color: "#c4b5fd" }}>
                                    {a.name}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Reviews */}
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1.1rem", color: "#e2e8f0", margin: 0 }}>⭐ ביקורות</h2>
                        {!submitted && (
                            <button onClick={() => setShowReviewForm(v => !v)} style={{ background: `${primary}22`, border: `1px solid ${primary}55`, borderRadius: 10, color: "#a78bfa", padding: "0.4rem 0.9rem", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}>
                                + כתוב ביקורת
                            </button>
                        )}
                    </div>

                    {submitted && (
                        <div style={{ background: "rgba(74,222,128,.08)", border: "1px solid rgba(74,222,128,.3)", borderRadius: 12, padding: "0.75rem 1rem", color: "#4ade80", marginBottom: "1rem", fontSize: "0.88rem" }}>
                            ✅ תודה! הביקורת נשלחה לאישור.
                        </div>
                    )}

                    {showReviewForm && (
                        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.25rem", marginBottom: "1.25rem" }}>
                            <div style={{ marginBottom: "0.75rem" }}>
                                <label style={{ color: "#94a3b8", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>שם *</label>
                                <input value={reviewForm.client_name} onChange={e => setReviewForm(f => ({ ...f, client_name: e.target.value }))}
                                    style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.6rem 0.9rem", color: "#fff", width: "100%", boxSizing: "border-box", outline: "none", fontSize: "0.9rem" }} />
                            </div>
                            <div style={{ marginBottom: "0.75rem" }}>
                                <label style={{ color: "#94a3b8", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>דירוג</label>
                                <div style={{ display: "flex", gap: "0.3rem" }}>
                                    {[1, 2, 3, 4, 5].map(n => (
                                        <button key={n} type="button" onClick={() => setReviewForm(f => ({ ...f, rating: n }))}
                                            style={{ background: "none", border: "none", fontSize: "1.8rem", cursor: "pointer", color: n <= reviewForm.rating ? "#fbbf24" : "#334155", padding: 0 }}>★</button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ marginBottom: "1rem" }}>
                                <label style={{ color: "#94a3b8", fontSize: "0.8rem", display: "block", marginBottom: "0.3rem" }}>תגובה (אופציונלי)</label>
                                <textarea value={reviewForm.comment} onChange={e => setReviewForm(f => ({ ...f, comment: e.target.value }))} rows={3}
                                    style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.6rem 0.9rem", color: "#fff", width: "100%", boxSizing: "border-box", resize: "vertical", fontSize: "0.9rem", outline: "none" }} />
                            </div>
                            <button type="button" onClick={submitReview} disabled={submitting || !reviewForm.client_name}
                                style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, border: "none", borderRadius: 12, color: "#fff", padding: "0.65rem 1.4rem", fontWeight: 700, cursor: "pointer", opacity: submitting ? 0.7 : 1, fontSize: "0.9rem" }}>
                                {submitting ? "שולח..." : "📤 שלח ביקורת"}
                            </button>
                        </div>
                    )}

                    {p.reviews.length === 0 ? (
                        <div style={{ color: "#64748b", textAlign: "center", padding: "2.5rem", background: "rgba(255,255,255,.03)", borderRadius: 16, border: "1px dashed rgba(255,255,255,.08)" }}>
                            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>💬</div>
                            <div>אין ביקורות עדיין — היה ראשון!</div>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                            {p.reviews.map(r => (
                                <div key={r.id} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, padding: "1rem 1.1rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                                        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{r.client_name}</span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                            <Stars n={r.rating} size="0.85rem" />
                                            <span style={{ color: "#475569", fontSize: "0.75rem" }}>{new Date(r.created_at).toLocaleDateString("he-IL")}</span>
                                        </div>
                                    </div>
                                    {r.comment && <div style={{ color: "#94a3b8", fontSize: "0.86rem", lineHeight: 1.65 }}>{r.comment}</div>}
                                </div>
                            ))}
                        </div>
                    )}

                    {p.review_link_google && (
                        <a href={p.review_link_google} target="_blank" rel="noopener" style={{ display: "block", marginTop: "1rem", textAlign: "center", color: "#a78bfa", fontSize: "0.85rem", textDecoration: "none" }}>
                            ⭐ כתוב ביקורת ב-Google ↗
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
