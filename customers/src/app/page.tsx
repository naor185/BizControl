"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { API, imgUrl } from "@/lib/api";
import { CalendarDays, LoaderCircle, LocateFixed, MapPin, Search, Star, X } from "lucide-react";
import BusinessTypeIcon from "@/components/BusinessTypeIcon";
import { GLASS_BTN, GLASS_CARD, PRIMARY_BTN } from "@/lib/look";

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

interface HeroProps {
    q: string; city: string;
    setQ: (v: string) => void; setCity: (v: string) => void;
    locating: boolean; onLocate: () => void;
    searchRef: React.RefObject<HTMLInputElement>;
}

function HeroSection({ q, city, setQ, setCity, locating, onLocate, searchRef }: HeroProps) {
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
            style={{ position: "relative", width: "100%", height: "clamp(480px,70vh,720px)", overflow: "hidden" }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            {/* ── Background images ── */}
            {slides.map((slide, i) => (
                <div key={i} style={{
                    position: "absolute", inset: 0,
                    opacity: i === current ? 1 : 0,
                    transition: "opacity 1.4s ease",
                    zIndex: 0,
                }}>
                    <img
                        src={slide.url} alt={slide.label}
                        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%", display: "block" }}
                    />
                </div>
            ))}

            {/* ── Gradient overlay ── */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,.45) 0%, rgba(0,0,0,.55) 55%, #000 100%)", zIndex: 1 }} />

            {/* ── Text + Search overlay ── */}
            <div style={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem 1.25rem", textAlign: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", background: "rgba(255,255,255,.12)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.28)", color: "#fff", fontSize: "0.78rem", fontWeight: 700, padding: "0.3rem 0.85rem", borderRadius: 20, marginBottom: "1.1rem" }}>
                    <MapPin size={14} aria-hidden /> גלה עסקים סביבך
                </div>
                <h1 style={{ fontSize: "clamp(2rem,5.5vw,3.4rem)", fontWeight: 900, color: "#fff", lineHeight: 1.15, marginBottom: "0.6rem", textShadow: "0 2px 20px rgba(0,0,0,.4)" }}>
                    <span style={{ color: "rgba(255,255,255,.72)" }}>כל מה שאתה מחפש,</span><br />
                    קרוב אליך.
                </h1>
                <p style={{ color: "rgba(255,255,255,.85)", fontSize: "clamp(0.88rem,2vw,1.05rem)", lineHeight: 1.6, marginBottom: "2rem", maxWidth: 520, textShadow: "0 1px 8px rgba(0,0,0,.4)" }}>
                    ספרים, סטודיואים, ציפורניים, ספא ועוד — מצא וקבע תור בשניות
                </p>

                {/* Search box */}
                <div style={{ width: "100%", maxWidth: 680, background: "rgba(0,0,0,.5)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,.22)", borderRadius: 20, padding: "0.6rem", boxShadow: "0 8px 40px rgba(0,0,0,.45)", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <div style={{ flex: "2 1 200px", position: "relative" }}>
                        <Search size={17} color="rgba(255,255,255,.6)" aria-hidden style={{ position: "absolute", right: "0.9rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                        <input
                            ref={searchRef}
                            value={q} onChange={e => setQ(e.target.value)}
                            placeholder="חפש שירות או עסק..."
                            style={SEARCH_INPUT}
                            onFocus={e => (e.target.style.borderColor = "#fff")}
                            onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,.16)")}
                        />
                    </div>
                    <div style={{ flex: "1 1 120px", position: "relative" }}>
                        <MapPin size={16} color="rgba(255,255,255,.6)" aria-hidden style={{ position: "absolute", right: "0.9rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                        <input
                            value={city} onChange={e => setCity(e.target.value)}
                            placeholder="עיר"
                            style={SEARCH_INPUT}
                            onFocus={e => (e.target.style.borderColor = "#fff")}
                            onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,.16)")}
                        />
                    </div>
                    <button type="button" onClick={onLocate} disabled={locating} title="קרוב אליי"
                        aria-label="קרוב אליי" style={{ padding: "0.75rem 1rem", background: "#fff", border: "none", borderRadius: 12, cursor: "pointer", flexShrink: 0, color: "#000", display: "flex", alignItems: "center" }}>
                        {locating ? <LoaderCircle size={18} style={{ animation: "spin .8s linear infinite" }} aria-hidden /> : <LocateFixed size={18} aria-hidden />}
                    </button>
                </div>

                {/* Current slide label */}
                {slides[current]?.label && (
                    <div style={{ marginTop: "1.25rem", color: "rgba(255,255,255,.7)", fontSize: "0.82rem", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                        {slides[current].label}
                    </div>
                )}
            </div>

            {/* ── Arrows ── */}
            <button onClick={() => { setCurrent(c => (c - 1 + n) % n); setPaused(true); }}
                style={{ position: "absolute", right: "1rem", top: "50%", transform: "translateY(-50%)", zIndex: 10, background: "rgba(255,255,255,.2)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,.35)", color: "#fff", width: 40, height: 40, borderRadius: "50%", cursor: "pointer", fontSize: "1.2rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ‹
            </button>
            <button onClick={() => { setCurrent(c => (c + 1) % n); setPaused(true); }}
                style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", zIndex: 10, background: "rgba(255,255,255,.2)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,.35)", color: "#fff", width: 40, height: 40, borderRadius: "50%", cursor: "pointer", fontSize: "1.2rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ›
            </button>

            {/* ── Dots ── */}
            <div style={{ position: "absolute", bottom: "1.1rem", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "0.4rem", zIndex: 10 }}>
                {slides.map((_, i) => (
                    <button key={i} type="button" aria-label={`שקופית ${i + 1}`} onClick={() => { setCurrent(i); setPaused(true); }}
                        style={{ width: i === current ? 24 : 7, height: 7, borderRadius: 4, border: "none", cursor: "pointer", background: i === current ? "#fff" : "rgba(255,255,255,.45)", transition: "all .3s", padding: 0 }} />
                ))}
            </div>
        </div>
    );
}


interface StudioCard {
    id: string; slug: string; name: string;
    business_type: string; business_type_label: string; business_type_icon: string; business_type_color: string;
    logo_url?: string; cover_url?: string; city?: string; description?: string;
    primary_color: string; self_booking_enabled: boolean;
    avg_rating?: number; review_count: number;
}
interface Category { id: string; label: string; icon: string; color: string; count: number; }


export default function HomePage() {
    const [studios, setStudios] = useState<StudioCard[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [q, setQ] = useState("");
    const [city, setCity] = useState("");
    const [selectedType, setSelectedType] = useState("");
    const [loading, setLoading] = useState(false);
    const [initialLoaded, setInitialLoaded] = useState(false);
    const [locating, setLocating] = useState(false);
    const [showLocationModal, setShowLocationModal] = useState(false);
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
        fetch(`${API}/api/marketplace/categories`).then(r => r.json()).then(d => setCategories(Array.isArray(d) ? d : [])).catch(() => {});   // an error must not blank the page
        const savedCity = localStorage.getItem("bizfind_city") || "";
        if (savedCity) setCity(savedCity);
        load("", savedCity, "");
        const asked = localStorage.getItem("bizfind_location_asked");
        if (!asked) { setTimeout(() => setShowLocationModal(true), 900); }
    }, []); // eslint-disable-line

    useEffect(() => {
        if (!initialLoaded) return;
        const t = setTimeout(() => load(q, city, selectedType), 300);
        return () => clearTimeout(t);
    }, [q, city, selectedType]); // eslint-disable-line

    const resolveCity = async (lat: number, lon: number) => {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const d = await r.json();
        return d.address?.city || d.address?.town || d.address?.village || "";
    };

    const locateMe = () => {
        if (!navigator.geolocation) return;
        setLocating(true);
        navigator.geolocation.getCurrentPosition(async pos => {
            try {
                const cityName = await resolveCity(pos.coords.latitude, pos.coords.longitude);
                if (cityName) { setCity(cityName); localStorage.setItem("bizfind_city", cityName); }
            } catch { }
            finally { setLocating(false); }
        }, () => setLocating(false));
    };

    const requestLocationFromModal = () => {
        setShowLocationModal(false);
        localStorage.setItem("bizfind_location_asked", "yes");
        if (!navigator.geolocation) return;
        setLocating(true);
        navigator.geolocation.getCurrentPosition(async pos => {
            try {
                const cityName = await resolveCity(pos.coords.latitude, pos.coords.longitude);
                if (cityName) { setCity(cityName); localStorage.setItem("bizfind_city", cityName); }
            } catch { }
            finally { setLocating(false); }
        }, () => setLocating(false));
    };

    const dismissLocationModal = () => {
        setShowLocationModal(false);
        localStorage.setItem("bizfind_location_asked", "dismissed");
    };

    const selectType = (id: string) => setSelectedType(prev => prev === id ? "" : id);
    const isSearching = !!(q || city || selectedType);
    const showResults = isSearching || initialLoaded;

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "var(--bf-bg)", color: "var(--bf-text)" }}>

            {/* ── Location Permission Modal ── */}
            {showLocationModal && (
                <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,.55)", backdropFilter: "blur(4px)", animation: "fadeIn .25s ease" }}
                    onClick={e => { if (e.target === e.currentTarget) dismissLocationModal(); }}>
                    <div style={{ background: "#0c0c0c", border: "1px solid var(--bf-line)", borderBottom: "none", borderRadius: "28px 28px 0 0", padding: "2.25rem 2rem 2.5rem", width: "100%", maxWidth: 520, textAlign: "center", animation: "slideUp .3s ease" }}>
                        <style>{`@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: none; opacity: 1; } }`}</style>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#fff", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.25rem" }}><MapPin size={32} aria-hidden /></div>
                        <div style={{ fontWeight: 800, fontSize: "1.25rem", color: "var(--bf-text)", marginBottom: "0.6rem" }}>BizFind רוצה לגשת למיקום שלך</div>
                        <div style={{ color: "var(--bf-muted)", fontSize: "0.92rem", lineHeight: 1.65, marginBottom: "2rem" }}>
                            כדי להציג עסקים, ספרים, סטודיואים וספא<br />
                            <strong>קרובים אליך</strong> — בדיוק כמו Wolt.
                        </div>
                        <button type="button" onClick={requestLocationFromModal}
                            style={{ ...PRIMARY_BTN, width: "100%", justifyContent: "center", borderRadius: 16, padding: "1rem", fontSize: "1rem", marginBottom: "0.85rem" }}>
                            <MapPin size={18} aria-hidden /> אפשר גישה למיקום
                        </button>
                        <button type="button" onClick={dismissLocationModal}
                            style={{ background: "none", border: "none", color: "var(--bf-faint)", fontSize: "0.88rem", cursor: "pointer", fontWeight: 600 }}>
                            אחר כך
                        </button>
                    </div>
                </div>
            )}

            {/* ── Header ── */}
            <header style={{ background: "rgba(0,0,0,.85)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--bf-line)", padding: "0 1.25rem", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <img src="/logo.png" alt="BizControl" style={{ width: 32, height: 32, objectFit: "contain" }} />
                    <span style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--bf-text)" }}>BizFind</span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <Link href="/explore" style={{ fontSize: "0.82rem", color: "var(--bf-muted)", textDecoration: "none", fontWeight: 600 }}>חיפוש מתקדם</Link>
                    <Link href="/studio/login" style={{ fontSize: "0.82rem", background: "#fff", color: "#000", textDecoration: "none", fontWeight: 700, padding: "0.38rem 0.9rem", borderRadius: 10 }}>כניסה לעסקים</Link>
                </div>
            </header>

            {/* ── Hero + Carousel merged ── */}
            <HeroSection
                q={q} city={city}
                setQ={setQ} setCity={setCity}
                locating={locating} onLocate={locateMe}
                searchRef={searchRef}
            />

            {/* Active filters */}
            {(q || city) && (
                <div style={{ padding: "0.6rem 1.25rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", background: "var(--bf-bg)", borderBottom: "1px solid var(--bf-line)" }}>
                    {q && <Chip label={`"${q}"`} onRemove={() => setQ("")} />}
                    {city && <Chip label={city} onRemove={() => setCity("")} />}
                </div>
            )}

            {/* ── Category pills ── */}
            <div style={{ background: "var(--bf-bg)", borderBottom: "1px solid var(--bf-line)", padding: "0.85rem 1.25rem", overflowX: "auto" }}>
                <div style={{ display: "flex", gap: "0.5rem", minWidth: "max-content" }}>
                    <button type="button" onClick={() => setSelectedType("")}
                        style={pill(!selectedType)}>
                        הכל
                    </button>
                    {categories.map(cat => {
                        const active = selectedType === cat.id;
                        return (
                            <button key={cat.id} type="button" onClick={() => selectType(cat.id)} style={pill(active)}>
                                <BusinessTypeIcon name={cat.icon} size={14} /> {cat.label}
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
                        <h2 style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--bf-text)", marginBottom: "1rem" }}>גלה לפי קטגוריה</h2>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: "0.65rem" }}>
                            {categories.slice(0, 8).map(cat => (
                                <button key={cat.id} type="button" onClick={() => selectType(cat.id)}
                                    style={{ ...GLASS_CARD, borderRadius: 18, padding: "1.1rem 0.75rem", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", transition: "transform .2s, border-color .2s" }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.4)"; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = "var(--bf-line)"; }}>
                                    <BusinessTypeIcon name={cat.icon} size={28} color="#fff" strokeWidth={1.5} />
                                    <span style={{ color: "var(--bf-text)", fontWeight: 700, fontSize: "0.82rem" }}>{cat.label}</span>
                                    <span style={{ color: "var(--bf-faint)", fontSize: "0.7rem" }}>{cat.count} עסקים</span>
                                </button>
                            ))}
                        </div>
                    </section>
                )}


                {/* ── Results ── */}
                <section style={{ padding: "1.5rem 0 3rem" }}>
                    {showResults && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                            <h2 style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--bf-text)" }}>
                                {isSearching ? `${studios.length} תוצאות` : "עסקים מובילים"}
                            </h2>
                            {loading && <div style={{ width: 18, height: 18, border: "2.5px solid rgba(255,255,255,.2)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .7s linear infinite" }} />}
                        </div>
                    )}

                    {!loading && studios.length === 0 && initialLoaded && (
                        <div style={{ textAlign: "center", padding: "3rem", color: "var(--bf-muted)" }}>
                            <Search size={34} strokeWidth={1.5} aria-hidden style={{ marginBottom: "0.75rem" }} />
                            <div>לא נמצאו עסקים. נסה חיפוש אחר.</div>
                            {isSearching && (
                                <button type="button" onClick={() => { setQ(""); setCity(""); setSelectedType(""); }}
                                    style={{ ...GLASS_BTN, display: "inline-flex", marginTop: "1rem", cursor: "pointer" }}>
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "var(--bf-glass-strong)", border: "1px solid var(--bf-line)", color: "var(--bf-text)", padding: "0.25rem 0.6rem", borderRadius: 20, fontSize: "0.78rem", fontWeight: 600 }}>
            {label}
            <button type="button" onClick={onRemove} aria-label="הסר" style={{ background: "none", border: "none", color: "var(--bf-muted)", cursor: "pointer", padding: 0, lineHeight: 1, display: "flex" }}><X size={14} /></button>
        </span>
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
                    ...GLASS_CARD, overflow: "hidden",
                    borderColor: hovered ? "rgba(255,255,255,.35)" : "var(--bf-line)",
                    transform: hovered ? "translateY(-4px)" : "none",
                    transition: "transform .25s, border-color .25s",
                }}
            >
                {/* Cover */}
                <div style={{ height: 140, position: "relative", overflow: "hidden", background: s.cover_url ? undefined : NO_COVER }}>
                    {s.cover_url && (
                        <img src={imgUrl(s.cover_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transition: "transform .3s", transform: hovered ? "scale(1.05)" : "scale(1)" }} />
                    )}
                    {!s.cover_url && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {s.logo_url
                                ? <img src={imgUrl(s.logo_url)} alt="" style={{ width: 72, height: 72, borderRadius: 16, objectFit: "contain", background: "#fff", padding: 5, boxShadow: "0 4px 16px rgba(0,0,0,.4)" }} />
                                : <BusinessTypeIcon name={s.business_type_icon} size={52} color="#ffffff" strokeWidth={1.5} />
                            }
                        </div>
                    )}
                    {s.cover_url && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,transparent 40%,rgba(0,0,0,.5))" }} />}
                    {s.self_booking_enabled && (
                        <div style={{ position: "absolute", top: 10, left: 10, display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "#fff", color: "#000", fontSize: "0.68rem", fontWeight: 800, padding: "0.22rem 0.6rem", borderRadius: 8 }}>
                            <CalendarDays size={12} aria-hidden /> הזמנה אונליין
                        </div>
                    )}
                    {s.cover_url && s.logo_url && (
                        <img src={imgUrl(s.logo_url)} alt="" style={{ position: "absolute", bottom: 10, right: 10, width: 38, height: 38, borderRadius: 10, objectFit: "contain", background: "#fff", padding: 3, border: "1px solid rgba(255,255,255,.6)" }} />
                    )}
                </div>

                {/* Info */}
                <div style={{ padding: "1rem" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.98rem", color: "var(--bf-text)", marginBottom: "0.25rem" }}>{s.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", marginBottom: "0.4rem" }}>
                        <span style={{ background: "var(--bf-glass-strong)", color: "var(--bf-text)", padding: "0.15rem 0.5rem", borderRadius: 6, fontWeight: 600, fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><BusinessTypeIcon name={s.business_type_icon} size={12} /> {s.business_type_label}</span>
                        {s.city && <span style={{ color: "var(--bf-muted)", display: "inline-flex", alignItems: "center", gap: "0.2rem" }}><MapPin size={12} aria-hidden /> {s.city}</span>}
                    </div>
                    {s.description && (
                        <div style={{ color: "var(--bf-muted)", fontSize: "0.8rem", lineHeight: 1.55, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", marginBottom: "0.5rem" }}>
                            {s.description}
                        </div>
                    )}
                    {s.avg_rating != null && s.review_count > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            <Star size={13} fill="#fbbf24" color="#fbbf24" aria-hidden />
                            <span style={{ color: "var(--bf-text)", fontWeight: 700, fontSize: "0.8rem" }}>{s.avg_rating.toFixed(1)}</span>
                            <span style={{ color: "var(--bf-faint)", fontSize: "0.72rem" }}>({s.review_count})</span>
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
}

const SEARCH_INPUT: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12,
    padding: "0.75rem 2.5rem 0.75rem 0.9rem", color: "#fff", fontSize: "0.95rem", outline: "none", boxSizing: "border-box", colorScheme: "dark",
};
const NO_COVER = "radial-gradient(ellipse at 70% 20%, #2a2a2a 0%, #0b0b0b 70%)";

// A category pill — white when chosen, glass otherwise.
function pill(active: boolean): React.CSSProperties {
    return {
        padding: "0.45rem 1rem", borderRadius: 20, cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", whiteSpace: "nowrap",
        display: "inline-flex", alignItems: "center", gap: "0.3rem", transition: "background .2s, color .2s",
        border: `1px solid ${active ? "#fff" : "var(--bf-line)"}`, background: active ? "#fff" : "var(--bf-glass)", color: active ? "#000" : "var(--bf-muted)",
    };
}
