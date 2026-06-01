"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/^http:\/\//, "https://");

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

function Stars({ n }: { n: number }) {
    return <span style={{ color: "#fbbf24" }}>{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}

export default function ProfilePage() {
    const { slug } = useParams() as { slug: string };
    const [profile, setProfile] = useState<Profile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [reviewForm, setReviewForm] = useState({ client_name: "", rating: 5, comment: "" });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

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
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#fff", fontSize: "2rem" }}>⏳</div>
    );
    if (error) return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#f87171", textAlign: "center", padding: "2rem" }} dir="rtl">
            <div><div style={{ fontSize: "3rem", marginBottom: "1rem" }}>😔</div>{error}</div>
        </div>
    );

    const p = profile!;
    const primary = p.primary_color || "#7c3aed";

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#0f172a", color: "#fff", fontFamily: "sans-serif" }}>
            {/* Cover */}
            <div style={{ height: 240, background: p.cover_url ? `url(${p.cover_url}) center/cover` : `linear-gradient(135deg,${primary}66,${primary}22)`, position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,transparent 50%,#0f172a)" }} />
                <Link href="/explore" style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,.5)", color: "#fff", textDecoration: "none", padding: "0.4rem 0.9rem", borderRadius: 10, fontSize: "0.85rem" }}>
                    ← חזרה
                </Link>
            </div>

            {/* Header */}
            <div style={{ maxWidth: 800, margin: "-60px auto 0", padding: "0 1.5rem", position: "relative" }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: "1.25rem", marginBottom: "1.5rem" }}>
                    {p.logo_url ? (
                        <img src={p.logo_url} alt="" style={{ width: 90, height: 90, borderRadius: 20, objectFit: "cover", border: "3px solid #0f172a", flexShrink: 0 }} />
                    ) : (
                        <div style={{ width: 90, height: 90, borderRadius: 20, background: `${primary}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem", border: "3px solid #0f172a", flexShrink: 0 }}>
                            {p.business_type_icon}
                        </div>
                    )}
                    <div style={{ paddingBottom: "0.5rem" }}>
                        <h1 style={{ fontSize: "1.8rem", fontWeight: 900, margin: "0 0 0.25rem" }}>{p.name}</h1>
                        <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>{p.business_type_icon} {p.business_type_label}{p.city ? ` · 📍 ${p.city}` : ""}</div>
                        {p.avg_rating && (
                            <div style={{ marginTop: "0.25rem", fontSize: "0.85rem" }}>
                                <Stars n={Math.round(p.avg_rating)} />
                                <span style={{ color: "#64748b", marginRight: "0.4rem" }}>({p.review_count} ביקורות)</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* CTA */}
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "2rem" }}>
                    {p.self_booking_enabled && (
                        <Link href={`/book/${slug}`} style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", textDecoration: "none", padding: "0.75rem 1.5rem", borderRadius: 14, fontWeight: 700, fontSize: "0.95rem" }}>
                            📅 קבע תור
                        </Link>
                    )}
                    {p.phone && (
                        <a href={`tel:${p.phone}`} style={{ background: "rgba(255,255,255,.08)", color: "#fff", textDecoration: "none", padding: "0.75rem 1.2rem", borderRadius: 14, fontWeight: 600, fontSize: "0.9rem" }}>
                            📞 התקשר
                        </a>
                    )}
                    {p.map_link && (
                        <a href={p.map_link} target="_blank" rel="noopener" style={{ background: "rgba(255,255,255,.08)", color: "#fff", textDecoration: "none", padding: "0.75rem 1.2rem", borderRadius: 14, fontWeight: 600, fontSize: "0.9rem" }}>
                            🗺️ ניווט
                        </a>
                    )}
                    {p.portfolio_link && (
                        <a href={p.portfolio_link} target="_blank" rel="noopener" style={{ background: "rgba(255,255,255,.08)", color: "#fff", textDecoration: "none", padding: "0.75rem 1.2rem", borderRadius: 14, fontWeight: 600, fontSize: "0.9rem" }}>
                            🖼️ פורטפוליו
                        </a>
                    )}
                </div>

                {/* Description */}
                {p.description && (
                    <div style={{ background: "rgba(255,255,255,.05)", borderRadius: 16, padding: "1.25rem", marginBottom: "2rem", color: "#cbd5e1", lineHeight: 1.7 }}>
                        {p.description}
                    </div>
                )}

                {/* Gallery */}
                {p.gallery.length > 0 && (
                    <div style={{ marginBottom: "2rem" }}>
                        <h2 style={{ fontWeight: 800, marginBottom: "1rem" }}>🖼️ גלריה</h2>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: "0.75rem" }}>
                            {p.gallery.map((url, i) => (
                                <img key={i} src={`${API}/uploads/${url}`} alt="" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 14 }} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Services */}
                {p.services.length > 0 && (
                    <div style={{ marginBottom: "2rem" }}>
                        <h2 style={{ fontWeight: 800, marginBottom: "1rem" }}>🛎️ שירותים</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {p.services.map(s => (
                                <div key={s.id} style={{ background: "rgba(255,255,255,.05)", border: `1px solid ${s.color}33`, borderRadius: 14, padding: "0.9rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.color }} />
                                        <div>
                                            <div style={{ fontWeight: 600 }}>{s.name}</div>
                                            {s.description && <div style={{ color: "#64748b", fontSize: "0.78rem" }}>{s.description}</div>}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: "left", flexShrink: 0 }}>
                                        <div style={{ color: "#a78bfa", fontSize: "0.85rem" }}>
                                            {s.duration_minutes < 60 ? `${s.duration_minutes} דק׳` : `${s.duration_minutes/60} שע׳`}
                                        </div>
                                        {s.price_ils > 0 && <div style={{ color: "#4ade80", fontWeight: 700 }}>₪{s.price_ils}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Team */}
                {p.artists.length > 0 && (
                    <div style={{ marginBottom: "2rem" }}>
                        <h2 style={{ fontWeight: 800, marginBottom: "1rem" }}>👥 הצוות</h2>
                        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                            {p.artists.map(a => (
                                <div key={a.id} style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: "0.75rem 1.25rem", fontWeight: 600 }}>
                                    👤 {a.name}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Reviews */}
                <div style={{ marginBottom: "3rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                        <h2 style={{ fontWeight: 800 }}>⭐ ביקורות</h2>
                        {!submitted && (
                            <button onClick={() => setShowReviewForm(!showReviewForm)} style={{ background: `${primary}22`, border: `1px solid ${primary}44`, borderRadius: 10, color: "#a78bfa", padding: "0.4rem 0.9rem", cursor: "pointer", fontSize: "0.85rem" }}>
                                + כתוב ביקורת
                            </button>
                        )}
                    </div>

                    {submitted && <div style={{ background: "rgba(74,222,128,.1)", border: "1px solid rgba(74,222,128,.3)", borderRadius: 12, padding: "0.75rem 1rem", color: "#4ade80", marginBottom: "1rem", fontSize: "0.9rem" }}>✅ תודה! הביקורת נשלחה לאישור.</div>}

                    {showReviewForm && (
                        <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.25rem", marginBottom: "1.5rem" }}>
                            <div style={{ marginBottom: "0.75rem" }}>
                                <label style={{ color: "#94a3b8", fontSize: "0.82rem", display: "block", marginBottom: "0.3rem" }}>שם *</label>
                                <input value={reviewForm.client_name} onChange={e => setReviewForm(f => ({ ...f, client_name: e.target.value }))}
                                    style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.6rem 0.9rem", color: "#fff", width: "100%", boxSizing: "border-box" as const }} />
                            </div>
                            <div style={{ marginBottom: "0.75rem" }}>
                                <label style={{ color: "#94a3b8", fontSize: "0.82rem", display: "block", marginBottom: "0.3rem" }}>דירוג</label>
                                <div style={{ display: "flex", gap: "0.4rem" }}>
                                    {[1,2,3,4,5].map(n => (
                                        <button key={n} onClick={() => setReviewForm(f => ({ ...f, rating: n }))}
                                            style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: n <= reviewForm.rating ? "#fbbf24" : "#334155" }}>★</button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ marginBottom: "1rem" }}>
                                <label style={{ color: "#94a3b8", fontSize: "0.82rem", display: "block", marginBottom: "0.3rem" }}>תגובה (אופציונלי)</label>
                                <textarea value={reviewForm.comment} onChange={e => setReviewForm(f => ({ ...f, comment: e.target.value }))} rows={3}
                                    style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.6rem 0.9rem", color: "#fff", width: "100%", boxSizing: "border-box" as const, resize: "vertical" }} />
                            </div>
                            <button onClick={submitReview} disabled={submitting || !reviewForm.client_name}
                                style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, border: "none", borderRadius: 12, color: "#fff", padding: "0.65rem 1.4rem", fontWeight: 700, cursor: "pointer", opacity: submitting ? 0.7 : 1 }}>
                                {submitting ? "שולח..." : "📤 שלח ביקורת"}
                            </button>
                        </div>
                    )}

                    {p.reviews.length === 0 ? (
                        <div style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>אין ביקורות עדיין. היה ראשון!</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            {p.reviews.map(r => (
                                <div key={r.id} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "1rem 1.25rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                                        <span style={{ fontWeight: 700 }}>{r.client_name}</span>
                                        <Stars n={r.rating} />
                                    </div>
                                    {r.comment && <div style={{ color: "#94a3b8", fontSize: "0.88rem", lineHeight: 1.6 }}>{r.comment}</div>}
                                </div>
                            ))}
                        </div>
                    )}

                    {p.review_link_google && (
                        <a href={p.review_link_google} target="_blank" rel="noopener" style={{ display: "block", marginTop: "1rem", textAlign: "center", color: "#a78bfa", fontSize: "0.85rem" }}>
                            ⭐ כתוב ביקורת ב-Google
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
