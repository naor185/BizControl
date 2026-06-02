"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { API, imgUrl } from "@/lib/api";

const DEFAULT_SLIDES = [
    { url: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=1400&q=85", label: "מסעדות ואוכל" },
    { url: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1400&q=85", label: "ספא וטיפולים" },
    { url: "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1400&q=85", label: "פילאטיס וכושר" },
    { url: "https://images.unsplash.com/photo-1487530811015-780d4c13f2e3?w=1400&q=85", label: "פרחים ומתנות" },
    { url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1400&q=85", label: "תזונה בריאה" },
    { url: "https://images.unsplash.com/photo-1546833998-877b37c2e5c6?w=1400&q=85", label: "מסעדות בשר" },
    { url: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=1400&q=85", label: "טיפול ורפואה" },
    { url: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=1400&q=85", label: "בריאות ואנרגיה" },
];

function HeroCarousel() {
    const [slides, setSlides] = useState(DEFAULT_SLIDES);
    const [current, setCurrent] = useState(0);
    const [paused, setPaused] = useState(false);
    const n = slides.length;

    useEffect(() => {
        fetch(`${API}/api/marketplace/hero-slides`)
            .then(r => r.json())
            .then((data: { url: string; label: string }[]) => {
                if (Array.isArray(data) && data.length > 0)
                    setSlides(data.map(s => ({ ...s, url: imgUrl(s.url) })));
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (paused) return;
        const t = setInterval(() => setCurrent(c => (c + 1) % n), 4500);
        return () => clearInterval(t);
    }, [paused, n]);

    return (
        <div
            style={{ position: "relative", width: "100%", height: "clamp(220px,40vw,480px)", overflow: "hidden" }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            {slides.map((slide, i) => (
                <div key={i} style={{
                    position: "absolute", inset: 0,
                    opacity: i === current ? 1 : 0,
                    transition: "opacity 1.2s ease",
                    zIndex: i === current ? 1 : 0,
                }}>
                    <img src={slide.url} alt={slide.label}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,.55) 0%, rgba(0,0,0,.1) 50%, transparent 100%)" }} />
                    <div style={{ position: "absolute", bottom: "1.5rem", right: "1.5rem", color: "#fff", fontWeight: 800, fontSize: "clamp(1rem,3vw,1.5rem)", textShadow: "0 2px 8px rgba(0,0,0,.5)", letterSpacing: "0.02em" }}>
                        {slide.label}
                    </div>
                </div>
            ))}

            {/* Navigation arrows */}
            <button onClick={() => { setCurrent(c => (c - 1 + n) % n); setPaused(true); }}
                style={{ position: "absolute", right: "1rem", top: "50%", transform: "translateY(-50%)", zIndex: 10, background: "rgba(255,255,255,.25)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,.4)", color: "#fff", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ‹
            </button>
            <button onClick={() => { setCurrent(c => (c + 1) % n); setPaused(true); }}
                style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", zIndex: 10, background: "rgba(255,255,255,.25)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,.4)", color: "#fff", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ›
            </button>

            {/* Dots */}
            <div style={{ position: "absolute", bottom: "0.65rem", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "0.4rem", zIndex: 10 }}>
                {slides.map((_, i) => (
                    <button key={i} type="button" aria-label={`שקופית ${i + 1}`} onClick={() => { setCurrent(i); setPaused(true); }}
                        style={{ width: i === current ? 20 : 7, height: 7, borderRadius: 4, border: "none", cursor: "pointer", background: i === current ? "#fff" : "rgba(255,255,255,.5)", transition: "all .3s", padding: 0 }} />
                ))}
            </div>
        </div>
    );
}

const MapView = dynamic(() => import("@/components/MapView"), {
    ssr: false,
    loading: () => (
        <div style={{ height: 340, background: "#f1f5f9", borderRadius: 20, border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
            🗺️ טוען מפה...
        </div>
    ),
});

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

const CAT_LIGHT: Record<string, { bg: string; color: string }> = {
    barber:  { bg: "#e0f2fe", color: "#0284c7" },
    tattoo:  { bg: "#ede9fe", color: "#7c3aed" },
    nails:   { bg: "#fce7f3", color: "#db2777" },
    spa:     { bg: "#d1fae5", color: "#059669" },
    pilates: { bg: "#fef3c7", color: "#d97706" },
    laser:   { bg: "#e0e7ff", color: "#4338ca" },
    medical: { bg: "#ccfbf1", color: "#0d9488" },
    other:   { bg: "#f1f5f9", color: "#475569" },
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
        <div dir="rtl" style={{ minHeight: "100vh", background: "#ffffff", fontFamily: "system-ui,sans-serif", color: "#1e293b" }}>

            {/* ── Header ── */}
            <header style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", padding: "0 1.25rem", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 8px rgba(0,0,0,.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#2563eb,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "0.8rem" }}>B</div>
                    <span style={{ fontWeight: 900, fontSize: "1.05rem", color: "#1e293b" }}>BizFind</span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <Link href="/explore" style={{ fontSize: "0.82rem", color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>חיפוש מתקדם</Link>
                    <Link href="/studio/login" style={{ fontSize: "0.82rem", background: "#2563eb", color: "#fff", textDecoration: "none", fontWeight: 700, padding: "0.35rem 0.85rem", borderRadius: 8 }}>כניסה לעסקים</Link>
                </div>
            </header>

            {/* ── Carousel ── */}
            <HeroCarousel />

            {/* ── Hero ── */}
            <div style={{ background: "linear-gradient(160deg,#eff6ff 0%,#dbeafe 50%,#eff6ff 100%)", padding: "3rem 1.25rem 2.5rem", position: "relative", overflow: "hidden" }}>
                {/* Blobs */}
                <div style={{ position: "absolute", top: -80, right: -80, width: 320, height: 320, borderRadius: "50%", background: "rgba(37,99,235,.08)", filter: "blur(60px)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", bottom: -60, left: -60, width: 240, height: 240, borderRadius: "50%", background: "rgba(99,102,241,.07)", filter: "blur(50px)", pointerEvents: "none" }} />

                <div style={{ maxWidth: 700, margin: "0 auto", position: "relative", textAlign: "center" }}>
                    <div style={{ display: "inline-block", background: "#dbeafe", border: "1px solid #bfdbfe", color: "#1d4ed8", fontSize: "0.78rem", fontWeight: 700, padding: "0.3rem 0.85rem", borderRadius: 20, marginBottom: "1rem" }}>
                        🗺️ גלה עסקים סביבך
                    </div>
                    <h1 style={{ fontSize: "clamp(1.9rem,5vw,3rem)", fontWeight: 900, color: "#0f172a", lineHeight: 1.2, marginBottom: "0.65rem" }}>
                        כל מה שאתה מחפש,<br />
                        <span style={{ background: "linear-gradient(135deg,#2563eb,#7c3aed)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>קרוב אליך.</span>
                    </h1>
                    <p style={{ color: "#475569", fontSize: "0.95rem", lineHeight: 1.65, marginBottom: "2rem" }}>
                        ספרים, סטודיואים, ציפורניים, ספא ועוד — מצא וקבע תור בשניות
                    </p>

                    {/* Search box */}
                    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "0.65rem", boxShadow: "0 4px 24px rgba(37,99,235,.1)", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <div style={{ flex: "2 1 200px", position: "relative" }}>
                            <span style={{ position: "absolute", right: "0.9rem", top: "50%", transform: "translateY(-50%)", fontSize: "1rem", pointerEvents: "none" }}>🔍</span>
                            <input
                                ref={searchRef}
                                value={q} onChange={e => setQ(e.target.value)}
                                placeholder="חפש שירות או עסק..."
                                style={{ width: "100%", background: "#f8faff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.75rem 2.5rem 0.75rem 0.9rem", color: "#1e293b", fontSize: "0.95rem", outline: "none", boxSizing: "border-box", transition: "border-color .2s" }}
                                onFocus={e => (e.target.style.borderColor = "#2563eb")}
                                onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                            />
                        </div>
                        <div style={{ flex: "1 1 130px", position: "relative" }}>
                            <span style={{ position: "absolute", right: "0.9rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.9rem", pointerEvents: "none" }}>📍</span>
                            <input
                                value={city} onChange={e => setCity(e.target.value)}
                                placeholder="עיר"
                                style={{ width: "100%", background: "#f8faff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "0.75rem 2.5rem 0.75rem 0.9rem", color: "#1e293b", fontSize: "0.95rem", outline: "none", boxSizing: "border-box", transition: "border-color .2s" }}
                                onFocus={e => (e.target.style.borderColor = "#2563eb")}
                                onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                            />
                        </div>
                        <button type="button" onClick={locateMe} disabled={locating} title="קרוב אליי"
                            style={{ padding: "0.75rem 1rem", background: "#dbeafe", border: "1.5px solid #bfdbfe", borderRadius: 12, cursor: "pointer", fontSize: "1.1rem", flexShrink: 0, color: "#2563eb", transition: "all .2s" }}>
                            {locating ? "⏳" : "🎯"}
                        </button>
                    </div>

                    {/* Active filters */}
                    {(q || city) && (
                        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "center" }}>
                            {q && <Chip label={`"${q}"`} onRemove={() => setQ("")} />}
                            {city && <Chip label={`📍 ${city}`} onRemove={() => setCity("")} />}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Category pills ── */}
            <div style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", padding: "0.85rem 1.25rem", overflowX: "auto" }}>
                <div style={{ display: "flex", gap: "0.5rem", minWidth: "max-content" }}>
                    <button type="button" onClick={() => setSelectedType("")}
                        style={{ padding: "0.45rem 1rem", borderRadius: 20, border: `1.5px solid ${!selectedType ? "#2563eb" : "#e2e8f0"}`, cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", background: !selectedType ? "#2563eb" : "#fff", color: !selectedType ? "#fff" : "#64748b", transition: "all .2s" }}>
                        🌐 הכל
                    </button>
                    {categories.map(cat => {
                        const light = CAT_LIGHT[cat.id] || CAT_LIGHT.other;
                        const active = selectedType === cat.id;
                        return (
                            <button key={cat.id} type="button" onClick={() => selectType(cat.id)}
                                style={{ padding: "0.45rem 1rem", borderRadius: 20, border: `1.5px solid ${active ? light.color : "#e2e8f0"}`, cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", background: active ? light.bg : "#fff", color: active ? light.color : "#64748b", transition: "all .2s", whiteSpace: "nowrap" }}>
                                {cat.icon} {cat.label}
                                <span style={{ opacity: 0.6, marginRight: "0.3rem", fontSize: "0.72rem" }}>({cat.count})</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 1.25rem" }}>

                {/* ── Category grid (no search) ── */}
                {!isSearching && categories.length > 0 && (
                    <section style={{ padding: "1.75rem 0 0.5rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#1e293b", marginBottom: "1rem" }}>גלה לפי קטגוריה</h2>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: "0.65rem" }}>
                            {categories.slice(0, 8).map(cat => {
                                const light = CAT_LIGHT[cat.id] || CAT_LIGHT.other;
                                return (
                                    <button key={cat.id} type="button" onClick={() => selectType(cat.id)}
                                        style={{ background: light.bg, border: `1.5px solid ${light.color}22`, borderRadius: 18, padding: "1.1rem 0.75rem", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", transition: "transform .2s, box-shadow .2s", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 8px 20px ${light.color}33`; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ""; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 4px rgba(0,0,0,.06)"; }}>
                                        <span style={{ fontSize: "1.75rem" }}>{cat.icon}</span>
                                        <span style={{ color: light.color, fontWeight: 700, fontSize: "0.8rem" }}>{cat.label}</span>
                                        <span style={{ color: `${light.color}99`, fontSize: "0.68rem" }}>{cat.count} עסקים</span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── Map ── */}
                {!isSearching && studios.length > 0 && (
                    <section style={{ padding: "1.5rem 0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem" }}>
                            <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#1e293b", margin: 0 }}>🗺️ עסקים על המפה</h2>
                            <Link href="/explore" style={{ fontSize: "0.78rem", color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                                explore מלא ←
                            </Link>
                        </div>
                        <MapView studios={studios} />
                    </section>
                )}

                {/* ── Results ── */}
                <section style={{ padding: "1.5rem 0 3rem" }}>
                    {showResults && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                            <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#1e293b" }}>
                                {isSearching ? `${studios.length} תוצאות` : "🌟 עסקים מובילים"}
                            </h2>
                            {loading && <div style={{ width: 18, height: 18, border: "2.5px solid #bfdbfe", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin .7s linear infinite" }} />}
                        </div>
                    )}

                    {!loading && studios.length === 0 && initialLoaded && (
                        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>
                            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🔍</div>
                            <div>לא נמצאו עסקים. נסה חיפוש אחר.</div>
                            {isSearching && (
                                <button type="button" onClick={() => { setQ(""); setCity(""); setSelectedType(""); }}
                                    style={{ marginTop: "1rem", background: "#dbeafe", border: "1px solid #bfdbfe", color: "#2563eb", padding: "0.5rem 1.1rem", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
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
        </div>
    );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "#dbeafe", border: "1px solid #bfdbfe", color: "#1d4ed8", padding: "0.25rem 0.6rem", borderRadius: 20, fontSize: "0.78rem", fontWeight: 600 }}>
            {label}
            <button type="button" onClick={onRemove} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: "0.85rem" }}>×</button>
        </span>
    );
}

function StudioCard({ s }: { s: StudioCard }) {
    const [hovered, setHovered] = useState(false);
    const gradient = CAT_GRADIENTS[s.business_type] || CAT_GRADIENTS.other;
    const light = CAT_LIGHT[s.business_type] || CAT_LIGHT.other;

    return (
        <Link href={`/b/${s.slug}`} style={{ textDecoration: "none", display: "block" }}>
            <div
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{
                    background: "#fff",
                    border: `1.5px solid ${hovered ? "#bfdbfe" : "#e2e8f0"}`,
                    borderRadius: 20, overflow: "hidden",
                    transform: hovered ? "translateY(-4px)" : "none",
                    transition: "all .25s",
                    boxShadow: hovered ? "0 12px 32px rgba(37,99,235,.12)" : "0 2px 8px rgba(0,0,0,.04)",
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
                                ? <img src={imgUrl(s.logo_url)} alt="" style={{ width: 72, height: 72, borderRadius: 16, objectFit: "cover", boxShadow: "0 4px 16px rgba(0,0,0,.2)" }} />
                                : <span style={{ fontSize: "3.5rem" }}>{s.business_type_icon}</span>
                            }
                        </div>
                    )}
                    {s.cover_url && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,transparent 40%,rgba(0,0,0,.5))" }} />}
                    {s.self_booking_enabled && (
                        <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(34,197,94,.95)", color: "#fff", fontSize: "0.68rem", fontWeight: 800, padding: "0.22rem 0.6rem", borderRadius: 8 }}>
                            📅 הזמנה אונליין
                        </div>
                    )}
                    {s.cover_url && s.logo_url && (
                        <img src={imgUrl(s.logo_url)} alt="" style={{ position: "absolute", bottom: 10, right: 10, width: 36, height: 36, borderRadius: 10, objectFit: "cover", border: "2px solid rgba(255,255,255,.6)" }} />
                    )}
                </div>

                {/* Info */}
                <div style={{ padding: "1rem" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0f172a", marginBottom: "0.2rem" }}>{s.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", marginBottom: "0.4rem" }}>
                        <span style={{ background: light.bg, color: light.color, padding: "0.15rem 0.5rem", borderRadius: 6, fontWeight: 600, fontSize: "0.72rem" }}>{s.business_type_icon} {s.business_type_label}</span>
                        {s.city && <span style={{ color: "#94a3b8" }}>📍 {s.city}</span>}
                    </div>
                    {s.description && (
                        <div style={{ color: "#64748b", fontSize: "0.78rem", lineHeight: 1.55, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", marginBottom: "0.5rem" }}>
                            {s.description}
                        </div>
                    )}
                    {s.avg_rating != null && s.review_count > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            <span style={{ color: "#f59e0b", fontSize: "0.78rem" }}>{"★".repeat(Math.round(s.avg_rating))}</span>
                            <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: "0.78rem" }}>{s.avg_rating.toFixed(1)}</span>
                            <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>({s.review_count})</span>
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
}
