"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { API, imgUrl } from "@/lib/api";
import { ArrowRight, CalendarDays, ChevronLeft, LayoutGrid, List, LoaderCircle, LocateFixed, MapPin, Search, SlidersHorizontal, Star, X } from "lucide-react";
import BusinessTypeIcon from "@/components/BusinessTypeIcon";
import { GLASS_BTN, GLASS_CARD, OPTION_STYLE } from "@/lib/look";

interface StudioCard {
    id: string; slug: string; name: string;
    business_type: string; business_type_label: string; business_type_icon: string; business_type_color: string;
    logo_url?: string; cover_url?: string; city?: string; description?: string;
    primary_color: string; self_booking_enabled: boolean;
    avg_rating?: number; review_count: number;
    is_claimed?: boolean;
}
interface Category { id: string; label: string; icon: string; color: string; count: number; }


type SortKey = "default" | "rating" | "reviews" | "name";
type ViewMode = "grid" | "list";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: "default",  label: "ברירת מחדל" },
    { key: "rating",   label: "דירוג גבוה" },
    { key: "reviews",  label: "הכי מדורגים" },
    { key: "name",     label: "לפי שם א-ת" },
];

function ExploreContent() {
    const [studios, setStudios] = useState<StudioCard[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [city, setCity] = useState("");
    const [citySuggestions, setCitySuggestions] = useState<string[]>([]);
    const [showCitySuggestions, setShowCitySuggestions] = useState(false);
    const [selectedType, setSelectedType] = useState("");
    const [sort, setSort] = useState<SortKey>("default");
    const [view, setView] = useState<ViewMode>("grid");
    const [bookingOnly, setBookingOnly] = useState(false);
    const [locating, setLocating] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

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
        fetch(`${API}/api/marketplace/categories`).then(r => r.json()).then(d => setCategories(Array.isArray(d) ? d : [])).catch(() => {});   // an error must not blank the page
    }, []);

    useEffect(() => {
        if (!city.trim()) { setCitySuggestions([]); return; }
        const t = setTimeout(() => {
            fetch(`${API}/api/marketplace/cities?q=${encodeURIComponent(city.trim())}`)
                .then(r => r.json())
                .then(setCitySuggestions)
                .catch(() => setCitySuggestions([]));
        }, 200);
        return () => clearTimeout(t);
    }, [city]);

    useEffect(() => {
        const t = setTimeout(load, 300);
        return () => clearTimeout(t);
    }, [load]);

    const sorted = [...studios]
        .filter(s => !bookingOnly || s.self_booking_enabled)
        .sort((a, b) => {
            if (sort === "rating")  return (b.avg_rating || 0) - (a.avg_rating || 0);
            if (sort === "reviews") return (b.review_count || 0) - (a.review_count || 0);
            if (sort === "name")    return (a.name || "").localeCompare(b.name || "", "he");
            return 0;
        });

    const locateMe = () => {
        if (!navigator.geolocation) return;
        setLocating(true);
        navigator.geolocation.getCurrentPosition(async pos => {
            try {
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`);
                const d = await r.json();
                const c = d.address?.city || d.address?.town || d.address?.village || "";
                if (c) setCity(c);
            } catch { }
            finally { setLocating(false); }
        }, () => setLocating(false));
    };

    const clearAll = () => { setQ(""); setCity(""); setSelectedType(""); setBookingOnly(false); setSort("default"); };
    const hasFilters = !!(q || city || selectedType || bookingOnly);

    return (
        <div style={{ minHeight: "100vh", background: "var(--bf-bg)", color: "var(--bf-text)" }}>

            {/* Sticky search header */}
            <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(0,0,0,.9)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--bf-line)", padding: "0.85rem 1.25rem" }}>
                <div style={{ maxWidth: 1100, margin: "0 auto" }}>
                    <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                        {/* Back */}
                        <Link href="/" aria-label="חזרה" style={{ color: "var(--bf-muted)", textDecoration: "none", flexShrink: 0, display: "flex" }}><ArrowRight size={20} /></Link>

                        {/* Search */}
                        <div style={{ flex: "3 1 200px", position: "relative" }}>
                            <Search size={16} color="rgba(255,255,255,.55)" aria-hidden style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                                placeholder="חפש שירות או עסק..."
                                style={{ ...FIELD, padding: "0.6rem 2.2rem 0.6rem 0.75rem" }} />
                        </div>

                        {/* City */}
                        <div style={{ flex: "1 1 110px", position: "relative" }}>
                            <MapPin size={15} color="rgba(255,255,255,.55)" aria-hidden style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                            <input value={city}
                                onChange={e => { setCity(e.target.value); setShowCitySuggestions(true); }}
                                onFocus={() => setShowCitySuggestions(true)}
                                onBlur={() => setTimeout(() => setShowCitySuggestions(false), 150)}
                                placeholder="עיר"
                                style={{ ...FIELD, padding: "0.6rem 2rem 0.6rem 0.75rem" }} />
                            {showCitySuggestions && citySuggestions.length > 0 && (
                                <div style={{ position: "absolute", top: "calc(100% + 0.3rem)", right: 0, left: 0, background: "#111", border: "1px solid var(--bf-line)", borderRadius: 12, overflow: "hidden", zIndex: 20, boxShadow: "0 8px 24px rgba(0,0,0,.6)" }}>
                                    {citySuggestions.map(c => (
                                        <div key={c} onClick={() => { setCity(c); setShowCitySuggestions(false); }}
                                            style={{ padding: "0.55rem 0.85rem", fontSize: "0.85rem", color: "var(--bf-text)", cursor: "pointer" }}
                                            onMouseDown={e => e.preventDefault()}>
                                            {c}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Near me */}
                        <button type="button" onClick={locateMe} title="קרוב אליי" aria-label="קרוב אליי"
                            style={{ padding: "0.6rem 0.75rem", background: "#fff", border: "none", borderRadius: 12, cursor: "pointer", color: "#000", flexShrink: 0, display: "flex" }}>
                            {locating ? <LoaderCircle size={18} style={{ animation: "spin .8s linear infinite" }} aria-hidden /> : <LocateFixed size={18} aria-hidden />}
                        </button>

                        {/* Filters toggle (mobile) */}
                        <button type="button" onClick={() => setFiltersOpen(v => !v)}
                            style={{ padding: "0.6rem 0.85rem", background: filtersOpen ? "#fff" : "var(--bf-glass)", border: `1px solid ${filtersOpen ? "#fff" : "var(--bf-line)"}`, borderRadius: 12, cursor: "pointer", color: filtersOpen ? "#000" : "var(--bf-muted)", fontSize: "0.82rem", fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}>
                            <SlidersHorizontal size={15} aria-hidden /> פילטרים {hasFilters && <span aria-label="יש סינון" style={{ background: "#ef4444", borderRadius: "50%", width: 8, height: 8 }} />}
                        </button>
                    </div>

                    {/* Expanded filters */}
                    {filtersOpen && (
                        <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px solid var(--bf-line)", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                            {/* Category chips */}
                            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", flex: 1 }}>
                                <button type="button" onClick={() => setSelectedType("")}
                                    style={chip(!selectedType)}>
                                    הכל
                                </button>
                                {categories.map(c => (
                                    <button key={c.id} type="button" onClick={() => setSelectedType(prev => prev === c.id ? "" : c.id)}
                                        style={chip(selectedType === c.id)}>
                                        <BusinessTypeIcon name={c.icon} size={13} /> {c.label}
                                    </button>
                                ))}
                            </div>

                            {/* Booking only toggle */}
                            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", whiteSpace: "nowrap", fontSize: "0.82rem", color: "var(--bf-muted)", userSelect: "none" }}>
                                <div onClick={() => setBookingOnly(v => !v)}
                                    style={{ width: 36, height: 20, borderRadius: 10, background: bookingOnly ? "#fff" : "rgba(255,255,255,.14)", position: "relative", cursor: "pointer", transition: "background .2s" }}>
                                    <span style={{ position: "absolute", top: 2, right: bookingOnly ? 2 : "calc(100% - 18px)", width: 16, height: 16, borderRadius: "50%", background: bookingOnly ? "#000" : "#fff", transition: "right .2s" }} />
                                </div>
                                הזמנה אונליין בלבד
                            </label>

                            {hasFilters && (
                                <button type="button" onClick={clearAll}
                                    style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "var(--bf-glass)", border: "1px solid var(--bf-line)", color: "var(--bf-text)", borderRadius: 10, padding: "0.35rem 0.75rem", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap" }}>
                                    <X size={13} aria-hidden /> נקה הכל
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Category scroll (quick access) */}
            <div style={{ padding: "0.75rem 1.25rem", overflowX: "auto", borderBottom: "1px solid var(--bf-line)" }}>
                <div style={{ display: "flex", gap: "0.5rem", minWidth: "max-content" }}>
                    {categories.map(c => (
                        <button key={c.id} type="button" onClick={() => setSelectedType(prev => prev === c.id ? "" : c.id)}
                            style={{ ...chip(selectedType === c.id), padding: "0.4rem 0.9rem", borderRadius: 20, fontSize: "0.8rem" }}>
                            <BusinessTypeIcon name={c.icon} size={14} /><span>{c.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Results toolbar */}
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0.85rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ fontSize: "0.85rem", color: "var(--bf-muted)" }}>
                    {loading ? "מחפש..." : `${sorted.length} עסקים`}
                    {hasFilters && <span style={{ color: "var(--bf-text)", marginRight: "0.4rem" }}> · מסוננים</span>}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {/* Sort */}
                    <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
                        style={{ background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 10, padding: "0.4rem 0.7rem", color: "var(--bf-text)", fontSize: "0.8rem", cursor: "pointer", outline: "none", colorScheme: "dark" }}>
                        {SORT_OPTIONS.map(o => <option key={o.key} value={o.key} style={OPTION_STYLE}>{o.label}</option>)}
                    </select>
                    {/* View toggle */}
                    <div style={{ display: "flex", background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 10, overflow: "hidden" }}>
                        {([["grid", LayoutGrid, "רשת"], ["list", List, "רשימה"]] as const).map(([v, Icon, label]) => (
                            <button key={v} type="button" onClick={() => setView(v)} aria-label={label}
                                style={{ padding: "0.4rem 0.6rem", border: "none", cursor: "pointer", background: view === v ? "#fff" : "transparent", color: view === v ? "#000" : "var(--bf-muted)", display: "flex", transition: "background .2s" }}>
                                <Icon size={16} />
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Results */}
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 1.25rem 5rem" }}>
                {loading ? (
                    <div style={{ textAlign: "center", padding: "4rem" }}>
                        <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,.18)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 1rem" }} />
                        <div style={{ color: "var(--bf-muted)" }}>מחפש...</div>
                    </div>
                ) : sorted.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "4rem", color: "var(--bf-muted)" }}>
                        <Search size={38} strokeWidth={1.5} aria-hidden style={{ marginBottom: "0.75rem" }} />
                        <div style={{ marginBottom: "1rem" }}>לא נמצאו עסקים תואמים</div>
                        <button type="button" onClick={clearAll}
                            style={{ ...GLASS_BTN, display: "inline-flex", cursor: "pointer" }}>
                            נקה פילטרים
                        </button>
                    </div>
                ) : view === "grid" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "1rem" }}>
                        {sorted.map(s => <GridCard key={s.id} s={s} />)}
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                        {sorted.map(s => <ListCard key={s.id} s={s} />)}
                    </div>
                )}
            </div>
        </div>
    );
}

function GridCard({ s }: { s: StudioCard }) {
    const [hovered, setHovered] = useState(false);
    const [imgFailed, setImgFailed] = useState(false);
    const showCover = s.cover_url && !imgFailed;
    return (
        <Link href={`/b/${s.slug}`} style={{ textDecoration: "none", display: "block" }}>
            <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
                style={{ ...GLASS_CARD, borderColor: hovered ? "rgba(255,255,255,.35)" : "var(--bf-line)", overflow: "hidden", transform: hovered ? "translateY(-3px)" : "none", transition: "transform .25s, border-color .25s" }}>
                <div style={{ height: 140, position: "relative", background: showCover ? undefined : NO_COVER }}>
                    {showCover && <img src={imgUrl(s.cover_url)} alt="" onError={() => setImgFailed(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: hovered ? "scale(1.04)" : "scale(1)", transition: "transform .3s" }} />}
                    {!showCover && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3rem" }}>{s.logo_url ? <img src={imgUrl(s.logo_url)} alt="" style={{ width: 68, height: 68, borderRadius: 14, objectFit: "contain", background: "#fff", padding: 5 }} /> : <BusinessTypeIcon name={s.business_type_icon} size={44} color="#ffffff" strokeWidth={1.5} />}</div>}
                    {showCover && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,transparent 50%,rgba(0,0,0,.55))" }} />}
                    {s.self_booking_enabled && <div style={{ position: "absolute", top: 8, left: 8, display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "#fff", color: "#000", fontSize: "0.66rem", fontWeight: 800, padding: "0.2rem 0.55rem", borderRadius: 7 }}><CalendarDays size={11} aria-hidden /> אונליין</div>}
                    {s.is_claimed === false && <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,.75)", border: "1px solid var(--bf-line)", color: "var(--bf-muted)", fontSize: "0.62rem", fontWeight: 700, padding: "0.2rem 0.5rem", borderRadius: 7 }}>לא מאומת</div>}
                </div>
                <div style={{ padding: "0.9rem" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.92rem", marginBottom: "0.2rem" }}>{s.name}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--bf-muted)", marginBottom: "0.35rem", display: "flex", alignItems: "center", gap: "0.25rem", flexWrap: "wrap" }}><BusinessTypeIcon name={s.business_type_icon} size={12} /> {s.business_type_label}{s.city && <><span aria-hidden>·</span><MapPin size={12} aria-hidden />{s.city}</>}</div>
                    {s.avg_rating != null && s.review_count > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem" }}>
                            <Star size={13} fill="#fbbf24" color="#fbbf24" aria-hidden />
                            <span style={{ color: "var(--bf-text)", fontWeight: 700 }}>{s.avg_rating.toFixed(1)}</span>
                            <span style={{ color: "var(--bf-faint)" }}>({s.review_count})</span>
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
}

function ListCard({ s }: { s: StudioCard }) {
    return (
        <Link href={`/b/${s.slug}`} style={{ textDecoration: "none" }}>
            <div style={{ ...GLASS_CARD, borderRadius: 16, padding: "0.9rem 1rem", display: "flex", gap: "1rem", alignItems: "center", transition: "border-color .2s, background .2s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,.35)"; e.currentTarget.style.background = "var(--bf-glass-strong)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--bf-line)"; e.currentTarget.style.background = "var(--bf-glass)"; }}>
                {/* Thumbnail */}
                <div style={{ width: 60, height: 60, borderRadius: 14, flexShrink: 0, overflow: "hidden", background: s.logo_url ? "#fff" : NO_COVER, border: "1px solid var(--bf-line)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {s.logo_url ? <img src={imgUrl(s.logo_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 4 }} /> : <BusinessTypeIcon name={s.business_type_icon} size={28} color="#ffffff" strokeWidth={1.5} />}
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.92rem", marginBottom: "0.15rem" }}>{s.name}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--bf-muted)", display: "flex", alignItems: "center", gap: "0.25rem", flexWrap: "wrap" }}><BusinessTypeIcon name={s.business_type_icon} size={12} /> {s.business_type_label}{s.city && <><span aria-hidden>·</span><MapPin size={12} aria-hidden />{s.city}</>}</div>
                    {s.is_claimed === false && <span style={{ display: "inline-block", marginTop: "0.2rem", background: "var(--bf-glass-strong)", color: "var(--bf-muted)", fontSize: "0.68rem", fontWeight: 700, padding: "0.12rem 0.45rem", borderRadius: 6 }}>לא מאומת</span>}
                    {s.description && <div style={{ fontSize: "0.78rem", color: "var(--bf-muted)", marginTop: "0.15rem", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{s.description}</div>}
                </div>
                {/* Right side */}
                <div style={{ flexShrink: 0, textAlign: "left", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem" }}>
                    {s.avg_rating != null && s.review_count > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.78rem" }}>
                            <Star size={13} fill="#fbbf24" color="#fbbf24" aria-hidden />
                            <span style={{ color: "var(--bf-text)", fontWeight: 700 }}>{s.avg_rating.toFixed(1)}</span>
                            <span style={{ color: "var(--bf-faint)" }}>({s.review_count})</span>
                        </div>
                    )}
                    {s.self_booking_enabled && <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", background: "#fff", color: "#000", fontSize: "0.68rem", fontWeight: 700, padding: "0.18rem 0.5rem", borderRadius: 7 }}><CalendarDays size={11} aria-hidden /> אונליין</span>}
                    <span style={{ color: "var(--bf-text)", fontSize: "0.76rem", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.1rem" }}>צפה <ChevronLeft size={14} aria-hidden /></span>
                </div>
            </div>
        </Link>
    );
}

export default function ExplorePage() {
    return (
        <Suspense fallback={<div style={{ height: "100vh", background: "var(--bf-bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--bf-muted)" }}>טוען...</div>}>
            <ExploreContent />
        </Suspense>
    );
}

const FIELD: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid var(--bf-line)", borderRadius: 12, color: "#fff",
    fontSize: "0.9rem", outline: "none", boxSizing: "border-box", colorScheme: "dark",
};
const NO_COVER = "radial-gradient(ellipse at 70% 20%, #2a2a2a 0%, #0b0b0b 70%)";

// A category chip — white when chosen, glass otherwise.
function chip(active: boolean): React.CSSProperties {
    return {
        padding: "0.35rem 0.8rem", borderRadius: 16, cursor: "pointer", fontWeight: 700, fontSize: "0.78rem", whiteSpace: "nowrap",
        display: "inline-flex", alignItems: "center", gap: "0.3rem", transition: "background .2s, color .2s",
        border: `1px solid ${active ? "#fff" : "var(--bf-line)"}`, background: active ? "#fff" : "var(--bf-glass)", color: active ? "#000" : "var(--bf-muted)",
    };
}
