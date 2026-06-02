"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API, imgUrl } from "@/lib/api";

interface Profile {
    slug: string; name: string; business_type_label: string; business_type_icon: string;
    logo_url?: string; cover_url?: string; primary_color: string;
    description?: string; city?: string; address?: string; map_link?: string;
    phone?: string; portfolio_link?: string; review_link_google?: string;
    self_booking_enabled: boolean;
    services: { id: string; name: string; duration_minutes: number; price_ils: number; color: string; description?: string }[];
    artists: { id: string; name: string }[];
    reviews: { id: string; client_name: string; rating: number; comment?: string; created_at: string }[];
    avg_rating?: number; review_count: number;
    gallery: string[];
}

function dur(m: number) { return m < 60 ? `${m} דק׳` : m % 60 === 0 ? `${m / 60} שע׳` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} שע׳`; }

export default function BusinessPage() {
    const { slug } = useParams() as { slug: string };
    const [p, setP] = useState<Profile | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<string | null>(null);
    const [showReview, setShowReview] = useState(false);
    const [reviewForm, setReviewForm] = useState({ client_name: "", rating: 5, comment: "" });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        fetch(`${API}/api/marketplace/${slug}`)
            .then(r => r.ok ? r.json() : Promise.reject("לא נמצא"))
            .then(setP).catch(() => setErr("העסק לא נמצא"));
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

    if (!p && !err) return (
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 44, height: 44, border: "4px solid rgba(167,139,250,.3)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        </div>
    );
    if (err) return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
            <div style={{ fontSize: "3rem" }}>😔</div>
            <div style={{ color: "#f87171" }}>{err}</div>
            <Link href="/" style={{ color: "#a78bfa", textDecoration: "none" }}>← חזרה</Link>
        </div>
    );

    const primary = p!.primary_color || "#7c3aed";

    return (
        <div style={{ minHeight: "100vh" }}>
            {/* Lightbox */}
            {lightbox && (
                <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
                    <img src={lightbox} alt="" style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }} />
                </div>
            )}

            {/* Hero */}
            <div style={{ height: 260, position: "relative", overflow: "hidden" }}>
                {p!.cover_url ? (
                    <img src={imgUrl(p!.cover_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg,${primary}99,#1e1b4b)` }} />
                )}
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,rgba(15,23,42,.2),rgba(15,23,42,.95))" }} />
                <Link href="/" style={{ position: "absolute", top: 14, right: 14, background: "rgba(0,0,0,.5)", backdropFilter: "blur(8px)", color: "#fff", textDecoration: "none", padding: "0.4rem 0.9rem", borderRadius: 12, fontSize: "0.82rem", border: "1px solid rgba(255,255,255,.15)" }}>← חזרה</Link>
            </div>

            {/* Content */}
            <div style={{ maxWidth: 820, margin: "-70px auto 0", padding: "0 1.25rem 4rem", position: "relative" }}>

                {/* Header card */}
                <div style={{ background: "rgba(30,27,74,.9)", backdropFilter: "blur(12px)", border: "1px solid rgba(167,139,250,.2)", borderRadius: 24, padding: "1.5rem", marginBottom: "1.25rem" }}>
                    <div style={{ display: "flex", gap: "1.1rem", marginBottom: "1.1rem", alignItems: "flex-end" }}>
                        {p!.logo_url ? (
                            <img src={imgUrl(p!.logo_url)} alt="" style={{ width: 76, height: 76, borderRadius: 16, objectFit: "cover", border: "3px solid rgba(167,139,250,.4)", flexShrink: 0 }} />
                        ) : (
                            <div style={{ width: 76, height: 76, borderRadius: 16, background: `${primary}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem", border: "3px solid rgba(167,139,250,.25)", flexShrink: 0 }}>{p!.business_type_icon}</div>
                        )}
                        <div style={{ flex: 1 }}>
                            <h1 style={{ fontSize: "1.65rem", fontWeight: 900, color: "#f1f5f9", marginBottom: "0.2rem" }}>{p!.name}</h1>
                            <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{p!.business_type_icon} {p!.business_type_label}{p!.city ? ` · 📍 ${p!.city}` : ""}</div>
                            {p!.avg_rating != null && p!.review_count > 0 && (
                                <div style={{ color: "#fbbf24", fontSize: "0.82rem", marginTop: "0.25rem" }}>
                                    {"★".repeat(Math.round(p!.avg_rating))}{"☆".repeat(5 - Math.round(p!.avg_rating))}
                                    <span style={{ color: "#64748b", marginRight: "0.3rem" }}>{p!.avg_rating.toFixed(1)} ({p!.review_count})</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* CTAs */}
                    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                        {p!.self_booking_enabled && (
                            <Link href={`/b/${slug}/book`} style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", textDecoration: "none", padding: "0.7rem 1.4rem", borderRadius: 14, fontWeight: 700, fontSize: "0.9rem" }}>
                                📅 קבע תור
                            </Link>
                        )}
                        {p!.phone && <a href={`tel:${p!.phone}`} style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.1rem", borderRadius: 14, fontWeight: 600, fontSize: "0.88rem" }}>📞 התקשר</a>}
                        {p!.map_link && <a href={p!.map_link} target="_blank" rel="noopener" style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.1rem", borderRadius: 14, fontWeight: 600, fontSize: "0.88rem" }}>🗺️ ניווט</a>}
                        {p!.portfolio_link && <a href={p!.portfolio_link} target="_blank" rel="noopener" style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#e2e8f0", textDecoration: "none", padding: "0.7rem 1.1rem", borderRadius: 14, fontWeight: 600, fontSize: "0.88rem" }}>🖼️ עבודות</a>}
                    </div>
                    {p!.description && <p style={{ marginTop: "1rem", color: "#94a3b8", lineHeight: 1.7, fontSize: "0.9rem", borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: "1rem" }}>{p!.description}</p>}
                </div>

                {/* Gallery */}
                {p!.gallery.length > 0 && (
                    <Section title="🖼️ גלריה">
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "0.5rem" }}>
                            {p!.gallery.map((url, i) => (
                                <div key={i} onClick={() => setLightbox(imgUrl(url))} style={{ cursor: "zoom-in", borderRadius: 12, overflow: "hidden", aspectRatio: "1", background: "#1e293b" }}>
                                    <img src={imgUrl(url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                </div>
                            ))}
                        </div>
                    </Section>
                )}

                {/* Services */}
                {p!.services.length > 0 && (
                    <Section title="🛎️ שירותים">
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {p!.services.map(s => (
                                <div key={s.id} style={{ background: "rgba(255,255,255,.04)", borderRight: `3px solid ${s.color}`, border: `1px solid ${s.color}22`, borderRadius: 14, padding: "0.8rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{s.name}</div>
                                        {s.description && <div style={{ color: "#64748b", fontSize: "0.76rem", marginTop: "0.1rem" }}>{s.description}</div>}
                                    </div>
                                    <div style={{ textAlign: "left", flexShrink: 0, marginRight: "0.5rem" }}>
                                        {s.duration_minutes > 0 && <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>{dur(s.duration_minutes)}</div>}
                                        {s.price_ils > 0 && <div style={{ color: "#4ade80", fontWeight: 800 }}>₪{s.price_ils}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                        {p!.self_booking_enabled && (
                            <Link href={`/b/${slug}/book`} style={{ display: "block", marginTop: "1rem", textAlign: "center", background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", textDecoration: "none", padding: "0.8rem", borderRadius: 14, fontWeight: 700 }}>
                                📅 קבע תור עכשיו
                            </Link>
                        )}
                    </Section>
                )}

                {/* Team */}
                {p!.artists.length > 0 && (
                    <Section title="👥 הצוות">
                        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                            {p!.artists.map(a => (
                                <div key={a.id} style={{ background: "rgba(167,139,250,.1)", border: "1px solid rgba(167,139,250,.25)", borderRadius: 12, padding: "0.55rem 0.9rem", fontWeight: 600, fontSize: "0.86rem", color: "#c4b5fd" }}>{a.name}</div>
                            ))}
                        </div>
                    </Section>
                )}

                {/* Reviews */}
                <Section title="⭐ ביקורות" action={!submitted ? <button type="button" onClick={() => setShowReview(v => !v)} style={{ background: `${primary}22`, border: `1px solid ${primary}44`, borderRadius: 10, color: "#a78bfa", padding: "0.35rem 0.85rem", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>+ כתוב ביקורת</button> : undefined}>
                    {submitted && <div style={{ background: "rgba(74,222,128,.08)", border: "1px solid rgba(74,222,128,.3)", borderRadius: 12, padding: "0.7rem 1rem", color: "#4ade80", marginBottom: "1rem", fontSize: "0.86rem" }}>✅ תודה! הביקורת נשלחה לאישור.</div>}
                    {showReview && (
                        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.1rem", marginBottom: "1rem" }}>
                            <Field label="שם *"><input value={reviewForm.client_name} onChange={e => setReviewForm(f => ({ ...f, client_name: e.target.value }))} /></Field>
                            <div style={{ marginBottom: "0.75rem" }}>
                                <div style={{ color: "#94a3b8", fontSize: "0.78rem", marginBottom: "0.25rem" }}>דירוג</div>
                                <div>{[1,2,3,4,5].map(n => <button key={n} type="button" onClick={() => setReviewForm(f => ({ ...f, rating: n }))} style={{ background: "none", border: "none", fontSize: "1.8rem", cursor: "pointer", color: n <= reviewForm.rating ? "#fbbf24" : "#334155", padding: 0 }}>★</button>)}</div>
                            </div>
                            <Field label="תגובה (אופציונלי)"><textarea value={reviewForm.comment} onChange={e => setReviewForm(f => ({ ...f, comment: e.target.value }))} rows={3} /></Field>
                            <button type="button" onClick={submitReview} disabled={submitting || !reviewForm.client_name} style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, border: "none", borderRadius: 12, color: "#fff", padding: "0.6rem 1.3rem", fontWeight: 700, cursor: "pointer", opacity: submitting ? 0.7 : 1 }}>{submitting ? "שולח..." : "📤 שלח"}</button>
                        </div>
                    )}
                    {p!.reviews.length === 0 ? (
                        <div style={{ color: "#64748b", textAlign: "center", padding: "2rem", background: "rgba(255,255,255,.03)", borderRadius: 14, border: "1px dashed rgba(255,255,255,.07)" }}>אין ביקורות עדיין — היה ראשון!</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                            {p!.reviews.map(r => (
                                <div key={r.id} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, padding: "0.9rem 1rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                                        <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{r.client_name}</span>
                                        <div style={{ color: "#fbbf24", fontSize: "0.8rem" }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                                    </div>
                                    {r.comment && <div style={{ color: "#94a3b8", fontSize: "0.84rem", lineHeight: 1.6 }}>{r.comment}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                    {p!.review_link_google && <a href={p!.review_link_google} target="_blank" rel="noopener" style={{ display: "block", marginTop: "0.75rem", textAlign: "center", color: "#a78bfa", fontSize: "0.82rem", textDecoration: "none" }}>⭐ כתוב ביקורת ב-Google ↗</a>}
                </Section>
            </div>
        </div>
    );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div style={{ marginBottom: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#e2e8f0" }}>{title}</h2>
                {action}
            </div>
            {children}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactElement }) {
    const styled = { ...children, props: { ...children.props, style: { background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.55rem 0.85rem", color: "#fff", width: "100%", boxSizing: "border-box" as const, outline: "none", fontSize: "0.9rem", resize: "vertical" as const, ...(children.props.style || {}) } } };
    return (
        <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ color: "#94a3b8", fontSize: "0.78rem", marginBottom: "0.25rem" }}>{label}</div>
            {styled}
        </div>
    );
}
