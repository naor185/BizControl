"use client";
import { useState, useEffect, useCallback, useRef } from "react";
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

const CAT_GRADIENTS: Record<string, string> = {
    barber:  "linear-gradient(135deg,#0ea5e9,#0284c7)",
    tattoo:  "linear-gradient(135deg,#7c3aed,#4c1d95)",
    nails:   "linear-gradient(135deg,#ec4899,#be185d)",
    spa:     "linear-gradient(135deg,#10b981,#065f46)",
    pilates: "linear-gradient(135deg,#f59e0b,#b45309)",
    laser:   "linear-gradient(135deg,#6366f1,#4338ca)",
    medical: "linear-gradient(135deg,#14b8a6,#0f766e)",
    other:   "linear-gradient(135deg,#64748b,#334155)",
};

export default function HomePage() {
    const [studios, setStudios] = useState<StudioCard[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [q, setQ] = useState("");
    const [city, setCity] = useState("");
    const [selectedType, setSelectedType] = useState("");
    const [loading, setLoading] = useState(false);
    const [initialLoaded, setInitialLoaded] = useState(false);
    const [locating, setLocating] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async (sq = q, sc = city, st = selectedType) => {
        setLoading(true);
        try {
            const p = new URLSearchParams();
            if (sq) p.set("q", sq);
            if (sc) p.set("city", sc);
            if (st) p.set("business_type", st);
            const r = await fetch(`${API}/api/marketplace?${p}`);
            const d = await r.json();
            setStudios(d.studios || []);
        } catch { setStudios([]); }
        finally { setLoading(false); setInitialLoaded(true); }
    }, [q, city, selectedType]);

    useEffect(() => {
        fetch(`${API}/api/marketplace/categories`).then(r => r.json()).then(setCategories).catch(() => {});
        load("", "", "");
    }, []); // eslint-disable-line

    useEffect(() => {
        if (!initialLoaded) return;
        const t = setTimeout(() => load(q, city, selectedType), 300);
        return () => clearTimeout(t);
    }, [q, city, selectedType]); // eslint-disable-line

    const locateMe = () => {
        if (!navigator.geolocation) return;
        setLocating(true);
        navigator.geolocation.getCurrentPosition(async pos => {
            try {
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`);
                const d = await r.json();
                const cityName = d.address?.city || d.address?.town || d.address?.village || "";
                if (cityName) setCity(cityName);
            } catch { }
            finally { setLocating(false); }
        }, () => setLocating(false));
    };

    const selectType = (id: string) => setSelectedType(prev => prev === id ? "" : id);
    const isSearching = !!(q || city || selectedType);
    const showResults = isSearching || initialLoaded;

    return (
        <div style={{ minHeight: "100vh", background: "#0f172a" }}>

            {/* Hero */}
            <div style={{ background: "linear-gradient(160deg,#1e1b4b 0%,#312e81 40%,#0f172a 100%)", padding: "3.5rem 1.25rem 2.5rem", position: "relative", overflow: "hidden" }}>
                {/* Decorative blobs */}
                <div style={{ position: "absolute", top: -60, right: -60, width: 300, height: 300, borderRadius: "50%", background: "rgba(124,58,237,.15)", filter: "blur(60px)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", bottom: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(79,70,229,.12)", filter: "blur(40px)", pointerEvents: "none" }} />

                <div style={{ maxWidth: 700, margin: "0 auto", position: "relative" }}>
                    <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                        <div style={{ display: "inline-block", background: "rgba(167,139,250,.15)", border: "1px solid rgba(167,139,250,.25)", color: "#a78bfa", fontSize: "0.78rem", fontWeight: 700, padding: "0.3rem 0.85rem", borderRadius: 20, marginBottom: "1rem" }}>
                            🗺️ גלה עסקים סביבך
                        </div>
                        <h1 style={{ fontSize: "clamp(1.9rem,5vw,3rem)", fontWeight: 900, color: "#f1f5f9", lineHeight: 1.2, marginBottom: "0.65rem" }}>
                            כל מה שאתה מחפש,<br />
                            <span style={{ background: "linear-gradient(135deg,#a78bfa,#60a5fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>קרוב אליך.</span>
                        </h1>
                        <p style={{ color: "#94a3b8", fontSize: "0.95rem", lineHeight: 1.65 }}>
                            ספרים, סטודיואים, ציפורניים, ספא ועוד — מצא וקבע תור בשניות
                        </p>
                    </div>

                    {/* Search box */}
                    <div style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 20, padding: "0.75rem", backdropFilter: "blur(12px)", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                        <div style={{ flex: "2 1 200px", position: "relative" }}>
                            <span style={{ position: "absolute", right: "0.9rem", top: "50%", transform: "translateY(-50%)", fontSize: "1rem", pointerEvents: "none" }}>🔍</span>
                            <input
                                ref={searchRef}
                                value={q} onChange={e => setQ(e.target.value)}
                                placeholder="חפש שירות או עסק..."
                                style={{ width: "100%", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "0.75rem 2.5rem 0.75rem 0.9rem", color: "#f1f5f9", fontSize: "0.95rem", outline: "none", boxSizing: "border-box" }}
                                onFocus={e => (e.target.style.borderColor = "rgba(167,139,250,.6)")}
                                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,.12)")}
                            />
                        </div>
                        <div style={{ flex: "1 1 130px", position: "relative" }}>
                            <span style={{ position: "absolute", right: "0.9rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.9rem", pointerEvents: "none" }}>📍</span>
                            <input
                                value={city} onChange={e => setCity(e.target.value)}
                                placeholder="עיר"
                                style={{ width: "100%", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "0.75rem 2.5rem 0.75rem 0.9rem", color: "#f1f5f9", fontSize: "0.95rem", outline: "none", boxSizing: "border-box" }}
                                onFocus={e => (e.target.style.borderColor = "rgba(167,139,250,.6)")}
                                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,.12)")}
                            />
                        </div>
                        <button
                            type="button" onClick={locateMe} disabled={locating}
                            title="קרוב אליי"
                            style={{ padding: "0.75rem 1rem", background: "rgba(124,58,237,.3)", border: "1px solid rgba(124,58,237,.4)", borderRadius: 12, cursor: "pointer", fontSize: "1.1rem", flexShrink: 0, color: "#a78bfa" }}>
                            {locating ? "⏳" : "🎯"}
                        </button>
                    </div>

                    {/* Active filters */}
                    {(q || city) && (
                        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                            {q && <Chip label={`"${q}"`} onRemove={() => setQ("")} />}
                            {city && <Chip label={`📍 ${city}`} onRemove={() => setCity("")} />}
                        </div>
                    )}
                </div>
            </div>

            {/* Category cards */}
            <div style={{ padding: "1.5rem 1.25rem 0.5rem", overflowX: "auto" }}>
                <div style={{ display: "flex", gap: "0.65rem", minWidth: "max-content" }}>
                    <button type="button" onClick={() => setSelectedType("")}
                        style={{ padding: "0.5rem 1.1rem", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", background: !selectedType ? "#7c3aed" : "rgba(255,255,255,.08)", color: !selectedType ? "#fff" : "#94a3b8", transition: "all .2s" }}>
                        🌐 הכל
                    </button>
                    {categories.map(cat => (
                        <button key={cat.id} type="button" onClick={() => selectType(cat.id)}
                            style={{ padding: "0.5rem 1.1rem", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", background: selectedType === cat.id ? "#7c3aed" : "rgba(255,255,255,.08)", color: selectedType === cat.id ? "#fff" : "#94a3b8", transition: "all .2s", whiteSpace: "nowrap" }}>
                            {cat.icon} {cat.label}
                            <span style={{ opacity: 0.6, marginRight: "0.3rem", fontSize: "0.72rem" }}>({cat.count})</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Visual category grid (show only when not searching) */}
            {!isSearching && categories.length > 0 && (
                <section style={{ padding: "1.5rem 1.25rem" }}>
                    <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#e2e8f0", marginBottom: "1rem" }}>
                        גלה לפי קטגוריה
                    </h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "0.75rem" }}>
                        {categories.slice(0, 8).map(cat => (
                            <button key={cat.id} type="button" onClick={() => selectType(cat.id)}
                                style={{ background: CAT_GRADIENTS[cat.id] || CAT_GRADIENTS.other, border: "none", borderRadius: 18, padding: "1.25rem 0.75rem", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", transition: "transform .2s, box-shadow .2s", boxShadow: "0 2px 12px rgba(0,0,0,.2)" }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 24px rgba(0,0,0,.3)"; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ""; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 12px rgba(0,0,0,.2)"; }}>
                                <span style={{ fontSize: "1.8rem" }}>{cat.icon}</span>
                                <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.82rem" }}>{cat.label}</span>
                                <span style={{ color: "rgba(255,255,255,.7)", fontSize: "0.7rem" }}>{cat.count} עסקים</span>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {/* Results */}
            <section style={{ padding: "0 1.25rem 2rem" }}>
                {showResults && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#e2e8f0" }}>
                            {isSearching ? `${studios.length} תוצאות` : "🌟 עסקים מובילים"}
                        </h2>
                        {loading && <div style={{ width: 18, height: 18, border: "2px solid rgba(167,139,250,.3)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin .7s linear infinite" }} />}
                    </div>
                )}

                {!loading && studios.length === 0 && initialLoaded && (
                    <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🔍</div>
                        <div>לא נמצאו עסקים. נסה חיפוש אחר.</div>
                        {isSearching && (
                            <button type="button" onClick={() => { setQ(""); setCity(""); setSelectedType(""); }} style={{ marginTop: "1rem", background: "rgba(124,58,237,.2)", border: "1px solid rgba(124,58,237,.3)", color: "#a78bfa", padding: "0.5rem 1.1rem", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
                                נקה חיפוש
                            </button>
                        )}
                    </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "1rem" }}>
                    {studios.map(s => <StudioCard key={s.id} s={s} />)}
                </div>
            </section>
        </div>
    );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "rgba(124,58,237,.2)", border: "1px solid rgba(124,58,237,.35)", color: "#c4b5fd", padding: "0.25rem 0.6rem", borderRadius: 20, fontSize: "0.78rem", fontWeight: 600 }}>
            {label}
            <button type="button" onClick={onRemove} style={{ background: "none", border: "none", color: "#a78bfa", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: "0.85rem" }}>×</button>
        </span>
    );
}

function StudioCard({ s }: { s: StudioCard }) {
    const [hovered, setHovered] = useState(false);
    const gradient = CAT_GRADIENTS[s.business_type] || CAT_GRADIENTS.other;

    return (
        <Link href={`/b/${s.slug}`} style={{ textDecoration: "none", display: "block" }}>
            <div
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{
                    background: "rgba(255,255,255,.04)",
                    border: `1px solid ${hovered ? "rgba(167,139,250,.4)" : "rgba(255,255,255,.08)"}`,
                    borderRadius: 20, overflow: "hidden",
                    transform: hovered ? "translateY(-4px)" : "none",
                    transition: "all .25s",
                    boxShadow: hovered ? "0 12px 32px rgba(0,0,0,.3)" : "none",
                }}
            >
                {/* Cover */}
                <div style={{ height: 140, position: "relative", overflow: "hidden", background: s.cover_url ? undefined : gradient }}>
                    {s.cover_url && (
                        <img src={imgUrl(s.cover_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transition: "transform .3s", transform: hovered ? "scale(1.05)" : "scale(1)" }} />
                    )}
                    {!s.cover_url && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {s.logo_url
                                ? <img src={imgUrl(s.logo_url)} alt="" style={{ width: 72, height: 72, borderRadius: 16, objectFit: "cover", boxShadow: "0 4px 16px rgba(0,0,0,.3)" }} />
                                : <span style={{ fontSize: "3.5rem" }}>{s.business_type_icon}</span>
                            }
                        </div>
                    )}
                    {/* Gradient overlay */}
                    {s.cover_url && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,transparent 40%,rgba(0,0,0,.6))" }} />}

                    {/* Badge */}
                    {s.self_booking_enabled && (
                        <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(74,222,128,.92)", color: "#052e16", fontSize: "0.68rem", fontWeight: 800, padding: "0.22rem 0.6rem", borderRadius: 8, backdropFilter: "blur(4px)" }}>
                            📅 הזמנה אונליין
                        </div>
                    )}
                    {s.cover_url && s.logo_url && (
                        <img src={imgUrl(s.logo_url)} alt="" style={{ position: "absolute", bottom: 10, right: 10, width: 36, height: 36, borderRadius: 10, objectFit: "cover", border: "2px solid rgba(255,255,255,.4)" }} />
                    )}
                </div>

                {/* Info */}
                <div style={{ padding: "1rem" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f1f5f9", marginBottom: "0.2rem" }}>{s.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", color: "#64748b", marginBottom: "0.4rem" }}>
                        <span>{s.business_type_icon} {s.business_type_label}</span>
                        {s.city && <><span>·</span><span>📍 {s.city}</span></>}
                    </div>
                    {s.description && (
                        <div style={{ color: "#94a3b8", fontSize: "0.78rem", lineHeight: 1.55, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", marginBottom: "0.5rem" }}>
                            {s.description}
                        </div>
                    )}
                    {s.avg_rating != null && s.review_count > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            <span style={{ color: "#fbbf24", fontSize: "0.78rem" }}>{"★".repeat(Math.round(s.avg_rating))}</span>
                            <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: "0.78rem" }}>{s.avg_rating.toFixed(1)}</span>
                            <span style={{ color: "#475569", fontSize: "0.72rem" }}>({s.review_count})</span>
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
}
