"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");
function imgUrl(url?: string) { if (!url) return ""; return url.startsWith("http") ? url : `${API}${url}`; }

interface StudioCard {
    id: string; slug: string; name: string;
    business_type: string; business_type_label: string; business_type_icon: string;
    logo_url?: string; cover_url?: string; city?: string; description?: string;
    primary_color: string; self_booking_enabled: boolean;
    avg_rating?: number; review_count: number;
}

interface Category { id: string; label: string; icon: string; count: number; }

function Stars({ rating }: { rating?: number }) {
    if (!rating) return null;
    return (
        <span style={{ color: "#fbbf24", fontSize: "0.8rem" }}>
            {"★".repeat(Math.round(rating))}{"☆".repeat(5 - Math.round(rating))}
            <span style={{ color: "#94a3b8", marginRight: "0.25rem" }}>({rating.toFixed(1)})</span>
        </span>
    );
}

export default function ExplorePage() {
    const [studios, setStudios] = useState<StudioCard[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [selectedType, setSelectedType] = useState("");
    const [city, setCity] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (selectedType) params.set("business_type", selectedType);
            if (city) params.set("city", city);
            const r = await fetch(`${API}/api/marketplace?${params}`);
            const data = await r.json();
            setStudios(data.studios || []);
        } catch { setStudios([]); }
        finally { setLoading(false); }
    }, [q, selectedType, city]);

    useEffect(() => {
        fetch(`${API}/api/marketplace/categories`)
            .then(r => r.json()).then(setCategories).catch(() => {});
    }, []);

    useEffect(() => {
        const t = setTimeout(load, 300);
        return () => clearTimeout(t);
    }, [load]);

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#0f172a", color: "#fff", fontFamily: "sans-serif" }}>
            {/* Hero */}
            <div style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)", padding: "3rem 2rem", textAlign: "center" }}>
                <h1 style={{ fontSize: "2.5rem", fontWeight: 900, marginBottom: "0.5rem", background: "linear-gradient(135deg,#a78bfa,#60a5fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    🗺️ גלה עסקים
                </h1>
                <p style={{ color: "#94a3b8", fontSize: "1.1rem", marginBottom: "2rem" }}>
                    מצא ספר, סטודיו קעקועים, ציפורניים ועוד — וקבע תור אונליין
                </p>
                {/* Search */}
                <div style={{ display: "flex", gap: "0.75rem", maxWidth: 640, margin: "0 auto", flexWrap: "wrap" }}>
                    <input
                        value={q} onChange={e => setQ(e.target.value)}
                        placeholder="🔍 חפש לפי שם..."
                        style={{ flex: 2, minWidth: 200, background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 12, padding: "0.75rem 1rem", color: "#fff", fontSize: "0.95rem" }}
                    />
                    <input
                        value={city} onChange={e => setCity(e.target.value)}
                        placeholder="📍 עיר"
                        style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 12, padding: "0.75rem 1rem", color: "#fff", fontSize: "0.95rem" }}
                    />
                </div>
            </div>

            {/* Category filter */}
            <div style={{ padding: "1.5rem 2rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                <button onClick={() => setSelectedType("")}
                    style={{ padding: "0.4rem 1rem", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", background: !selectedType ? "#7c3aed" : "rgba(255,255,255,.08)", color: "#fff" }}>
                    🌐 הכל
                </button>
                {categories.map(cat => (
                    <button key={cat.id} onClick={() => setSelectedType(cat.id === selectedType ? "" : cat.id)}
                        style={{ padding: "0.4rem 1rem", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", background: selectedType === cat.id ? "#7c3aed" : "rgba(255,255,255,.08)", color: "#fff" }}>
                        {cat.icon} {cat.label} <span style={{ opacity: 0.6, fontSize: "0.75rem" }}>({cat.count})</span>
                    </button>
                ))}
            </div>

            {/* Results */}
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>
                {loading ? (
                    <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>⏳ מחפש...</div>
                ) : studios.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>
                        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
                        <div>לא נמצאו עסקים. נסה חיפוש אחר.</div>
                    </div>
                ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "1.5rem" }}>
                        {studios.map(s => (
                            <Link key={s.id} href={`/profile/${s.slug}`} style={{ textDecoration: "none" }}>
                                <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 20, overflow: "hidden", transition: "transform .2s, border-color .2s", cursor: "pointer" }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.borderColor = s.primary_color; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,.1)"; }}>
                                    {/* Cover */}
                                    <div style={{ height: 140, background: s.cover_url ? `url(${imgUrl(s.cover_url)}) center/cover` : `linear-gradient(135deg,${s.primary_color}44,${s.primary_color}22)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        {!s.cover_url && s.logo_url && (
                                            <img src={imgUrl(s.logo_url)} alt="" style={{ width: 70, height: 70, borderRadius: 16, objectFit: "cover" }} />
                                        )}
                                        {!s.cover_url && !s.logo_url && (
                                            <span style={{ fontSize: "3rem" }}>{s.business_type_icon}</span>
                                        )}
                                    </div>
                                    <div style={{ padding: "1.25rem" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                                            <div>
                                                <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#fff" }}>{s.name}</div>
                                                <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{s.business_type_icon} {s.business_type_label}</div>
                                            </div>
                                            {s.logo_url && s.cover_url && (
                                                <img src={imgUrl(s.logo_url)} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }} />
                                            )}
                                        </div>
                                        {s.city && <div style={{ color: "#64748b", fontSize: "0.8rem", marginBottom: "0.5rem" }}>📍 {s.city}</div>}
                                        {s.description && (
                                            <div style={{ color: "#94a3b8", fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.75rem", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                                                {s.description}
                                            </div>
                                        )}
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <Stars rating={s.avg_rating} />
                                            {s.self_booking_enabled && (
                                                <span style={{ background: "rgba(74,222,128,.15)", color: "#4ade80", fontSize: "0.72rem", padding: "0.2rem 0.6rem", borderRadius: 8, fontWeight: 600 }}>
                                                    📅 קביעה אונליין
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
