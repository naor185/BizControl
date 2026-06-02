"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { API, imgUrl } from "@/lib/api";

interface StudioCard {
    id: string; slug: string; name: string;
    business_type: string; business_type_label: string; business_type_icon: string;
    logo_url?: string; cover_url?: string; city?: string; description?: string;
    primary_color: string; self_booking_enabled: boolean;
    avg_rating?: number; review_count: number;
}
interface Category { id: string; label: string; icon: string; count: number; }

const FEATURED_TYPES = [
    { id: "barber", icon: "✂️", label: "ספר" },
    { id: "tattoo", icon: "🎨", label: "קעקועים" },
    { id: "nails", icon: "💅", label: "ציפורניים" },
    { id: "spa", icon: "🧖", label: "ספא" },
    { id: "pilates", icon: "🏃", label: "כושר" },
    { id: "laser", icon: "⚡", label: "לייזר" },
];

export default function HomePage() {
    const [studios, setStudios] = useState<StudioCard[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [q, setQ] = useState("");
    const [city, setCity] = useState("");
    const [selectedType, setSelectedType] = useState("");
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams();
            if (q) p.set("q", q);
            if (city) p.set("city", city);
            if (selectedType) p.set("business_type", selectedType);
            const r = await fetch(`${API}/api/marketplace?${p}`);
            const d = await r.json();
            setStudios(d.studios || []);
        } catch { setStudios([]); }
        finally { setLoading(false); }
    }, [q, city, selectedType]);

    useEffect(() => {
        fetch(`${API}/api/marketplace/categories`).then(r => r.json()).then(setCategories).catch(() => {});
    }, []);

    useEffect(() => {
        const t = setTimeout(load, 300);
        return () => clearTimeout(t);
    }, [load]);

    const isSearching = !!(q || city || selectedType);

    return (
        <div style={{ minHeight: "100vh" }}>

            {/* Hero */}
            <div style={{ background: "linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#1e3a5f 100%)", padding: "4rem 1.5rem 3rem", textAlign: "center" }}>
                <div style={{ maxWidth: 700, margin: "0 auto" }}>
                    <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🗺️</div>
                    <h1 style={{ fontSize: "clamp(2rem,5vw,3rem)", fontWeight: 900, marginBottom: "0.75rem", background: "linear-gradient(135deg,#a78bfa,#60a5fa,#34d399)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                        מצא עסק וקבע תור
                    </h1>
                    <p style={{ color: "#94a3b8", fontSize: "1.1rem", marginBottom: "2rem" }}>
                        ספרים, קעקועים, ציפורניים, ספא ועוד — הכל במקום אחד
                    </p>

                    {/* Search bar */}
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
                        <input
                            value={q} onChange={e => setQ(e.target.value)}
                            placeholder="🔍 חפש לפי שם..."
                            style={{ flex: "2 1 220px", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", borderRadius: 14, padding: "0.85rem 1.1rem", color: "#fff", fontSize: "1rem", outline: "none", backdropFilter: "blur(8px)" }}
                        />
                        <input
                            value={city} onChange={e => setCity(e.target.value)}
                            placeholder="📍 עיר"
                            style={{ flex: "1 1 130px", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", borderRadius: 14, padding: "0.85rem 1.1rem", color: "#fff", fontSize: "1rem", outline: "none", backdropFilter: "blur(8px)" }}
                        />
                    </div>

                    {/* Quick category pills */}
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", marginTop: "1.5rem" }}>
                        <button onClick={() => setSelectedType("")}
                            style={{ padding: "0.45rem 1rem", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", background: !selectedType ? "#7c3aed" : "rgba(255,255,255,.1)", color: "#fff", transition: "all .2s" }}>
                            🌐 הכל
                        </button>
                        {FEATURED_TYPES.map(t => (
                            <button key={t.id} onClick={() => setSelectedType(selectedType === t.id ? "" : t.id)}
                                style={{ padding: "0.45rem 1rem", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", background: selectedType === t.id ? "#7c3aed" : "rgba(255,255,255,.1)", color: "#fff", transition: "all .2s" }}>
                                {t.icon} {t.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Category stats bar */}
            {categories.length > 0 && !isSearching && (
                <div style={{ background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.06)", padding: "0.75rem 1.5rem", display: "flex", gap: "1.5rem", overflowX: "auto", justifyContent: "center" }}>
                    {categories.map(c => (
                        <button key={c.id} onClick={() => setSelectedType(c.id)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "0.82rem", whiteSpace: "nowrap", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem" }}>
                            <span style={{ fontSize: "1.4rem" }}>{c.icon}</span>
                            <span>{c.label}</span>
                            <span style={{ color: "#475569", fontSize: "0.72rem" }}>{c.count} עסקים</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Results grid */}
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.25rem" }}>
                {!isSearching && (
                    <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "1.25rem", color: "#e2e8f0" }}>
                        {selectedType ? `עסקים — ${FEATURED_TYPES.find(t => t.id === selectedType)?.label || selectedType}` : "🌟 עסקים מובילים"}
                    </h2>
                )}

                {loading ? (
                    <div style={{ textAlign: "center", padding: "4rem" }}>
                        <div style={{ width: 40, height: 40, border: "3px solid rgba(167,139,250,.3)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 1rem" }} />
                        <div style={{ color: "#64748b" }}>מחפש...</div>
                    </div>
                ) : studios.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>
                        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
                        <div>לא נמצאו עסקים. נסה חיפוש אחר.</div>
                    </div>
                ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", gap: "1.25rem" }}>
                        {studios.map(s => (
                            <StudioCard key={s.id} s={s} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function StudioCard({ s }: { s: StudioCard }) {
    const [hovered, setHovered] = useState(false);
    return (
        <Link href={`/b/${s.slug}`} style={{ textDecoration: "none", display: "block" }}>
            <div
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{
                    background: "rgba(255,255,255,.05)",
                    border: `1px solid ${hovered ? s.primary_color : "rgba(255,255,255,.09)"}`,
                    borderRadius: 20, overflow: "hidden",
                    transform: hovered ? "translateY(-4px)" : "none",
                    transition: "all .25s",
                    boxShadow: hovered ? `0 12px 32px ${s.primary_color}22` : "none",
                    animation: "fadeIn .3s ease",
                }}
            >
                {/* Cover */}
                <div style={{ height: 148, position: "relative", overflow: "hidden", background: `linear-gradient(135deg,${s.primary_color}44,${s.primary_color}11)` }}>
                    {s.cover_url && (
                        <img src={imgUrl(s.cover_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                    )}
                    {!s.cover_url && s.logo_url && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <img src={imgUrl(s.logo_url)} alt="" style={{ width: 72, height: 72, borderRadius: 16, objectFit: "cover" }} />
                        </div>
                    )}
                    {!s.cover_url && !s.logo_url && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3.5rem" }}>
                            {s.business_type_icon}
                        </div>
                    )}
                    {s.self_booking_enabled && (
                        <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(74,222,128,.9)", color: "#052e16", fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: 8 }}>
                            📅 קביעה אונליין
                        </div>
                    )}
                </div>

                {/* Info */}
                <div style={{ padding: "1.1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: "1rem", color: "#f1f5f9" }}>{s.name}</div>
                            <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.1rem" }}>{s.business_type_icon} {s.business_type_label}</div>
                        </div>
                        {s.logo_url && s.cover_url && (
                            <img src={imgUrl(s.logo_url)} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                        )}
                    </div>
                    {s.city && <div style={{ color: "#475569", fontSize: "0.78rem", marginBottom: "0.4rem" }}>📍 {s.city}</div>}
                    {s.description && (
                        <div style={{ color: "#94a3b8", fontSize: "0.8rem", lineHeight: 1.55, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", marginBottom: "0.5rem" }}>
                            {s.description}
                        </div>
                    )}
                    {s.avg_rating != null && s.review_count > 0 && (
                        <div style={{ color: "#fbbf24", fontSize: "0.78rem" }}>
                            {"★".repeat(Math.round(s.avg_rating))}{"☆".repeat(5 - Math.round(s.avg_rating))}
                            <span style={{ color: "#64748b", marginRight: "0.3rem" }}>{s.avg_rating.toFixed(1)} ({s.review_count})</span>
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
}
