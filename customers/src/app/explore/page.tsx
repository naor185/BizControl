"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
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
    barber: "linear-gradient(135deg,#0ea5e9,#0284c7)",
    tattoo: "linear-gradient(135deg,#7c3aed,#4c1d95)",
    nails:  "linear-gradient(135deg,#ec4899,#be185d)",
    spa:    "linear-gradient(135deg,#10b981,#065f46)",
    pilates:"linear-gradient(135deg,#f59e0b,#b45309)",
    laser:  "linear-gradient(135deg,#6366f1,#4338ca)",
    medical:"linear-gradient(135deg,#14b8a6,#0f766e)",
    other:  "linear-gradient(135deg,#64748b,#334155)",
};

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
        fetch(`${API}/api/marketplace/categories`).then(r => r.json()).then(setCategories).catch(() => {});
    }, []);

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
        <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9" }}>

            {/* Sticky search header */}
            <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(15,23,42,.97)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,.07)", padding: "0.85rem 1.25rem" }}>
                <div style={{ maxWidth: 1100, margin: "0 auto" }}>
                    <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                        {/* Back */}
                        <Link href="/" style={{ color: "#94a3b8", textDecoration: "none", fontSize: "1.1rem", flexShrink: 0 }}>←</Link>

                        {/* Search */}
                        <div style={{ flex: "3 1 200px", position: "relative" }}>
                            <span style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.9rem" }}>🔍</span>
                            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                                placeholder="חפש שירות או עסק..."
                                style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "0.6rem 2.2rem 0.6rem 0.75rem", color: "#f1f5f9", fontSize: "0.9rem", outline: "none", boxSizing: "border-box" }} />
                        </div>

                        {/* City */}
                        <div style={{ flex: "1 1 110px", position: "relative" }}>
                            <span style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.8rem" }}>📍</span>
                            <input value={city} onChange={e => setCity(e.target.value)}
                                placeholder="עיר"
                                style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "0.6rem 2rem 0.6rem 0.75rem", color: "#f1f5f9", fontSize: "0.9rem", outline: "none", boxSizing: "border-box" }} />
                        </div>

                        {/* Near me */}
                        <button type="button" onClick={locateMe} title="קרוב אליי"
                            style={{ padding: "0.6rem 0.75rem", background: "rgba(124,58,237,.2)", border: "1px solid rgba(124,58,237,.35)", borderRadius: 12, cursor: "pointer", color: "#a78bfa", fontSize: "1rem", flexShrink: 0 }}>
                            {locating ? "⏳" : "🎯"}
                        </button>

                        {/* Filters toggle (mobile) */}
                        <button type="button" onClick={() => setFiltersOpen(v => !v)}
                            style={{ padding: "0.6rem 0.85rem", background: filtersOpen ? "#7c3aed" : "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, cursor: "pointer", color: filtersOpen ? "#fff" : "#94a3b8", fontSize: "0.82rem", fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            ⚙️ פילטרים {hasFilters && <span style={{ background: "#ef4444", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: "0.65rem", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 }}>!</span>}
                        </button>
                    </div>

                    {/* Expanded filters */}
                    {filtersOpen && (
                        <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                            {/* Category chips */}
                            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", flex: 1 }}>
                                <button type="button" onClick={() => setSelectedType("")}
                                    style={{ padding: "0.35rem 0.8rem", borderRadius: 16, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.78rem", background: !selectedType ? "#7c3aed" : "rgba(255,255,255,.08)", color: !selectedType ? "#fff" : "#94a3b8" }}>
                                    🌐 הכל
                                </button>
                                {categories.map(c => (
                                    <button key={c.id} type="button" onClick={() => setSelectedType(prev => prev === c.id ? "" : c.id)}
                                        style={{ padding: "0.35rem 0.8rem", borderRadius: 16, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.78rem", background: selectedType === c.id ? "#7c3aed" : "rgba(255,255,255,.08)", color: selectedType === c.id ? "#fff" : "#94a3b8", whiteSpace: "nowrap" }}>
                                        {c.icon} {c.label}
                                    </button>
                                ))}
                            </div>

                            {/* Booking only toggle */}
                            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", whiteSpace: "nowrap", fontSize: "0.82rem", color: "#94a3b8", userSelect: "none" }}>
                                <div onClick={() => setBookingOnly(v => !v)}
                                    style={{ width: 36, height: 20, borderRadius: 10, background: bookingOnly ? "#7c3aed" : "rgba(255,255,255,.12)", position: "relative", cursor: "pointer", transition: "background .2s" }}>
                                    <span style={{ position: "absolute", top: 2, right: bookingOnly ? 2 : "calc(100% - 18px)", width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "right .2s" }} />
                                </div>
                                📅 הזמנה אונליין בלבד
                            </label>

                            {hasFilters && (
                                <button type="button" onClick={clearAll}
                                    style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)", color: "#f87171", borderRadius: 10, padding: "0.35rem 0.75rem", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap" }}>
                                    ✕ נקה הכל
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Category scroll (quick access) */}
            <div style={{ padding: "0.75rem 1.25rem", overflowX: "auto", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                <div style={{ display: "flex", gap: "0.5rem", minWidth: "max-content" }}>
                    {categories.map(c => (
                        <button key={c.id} type="button" onClick={() => setSelectedType(prev => prev === c.id ? "" : c.id)}
                            style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.4rem 0.9rem", borderRadius: 20, border: `1px solid ${selectedType === c.id ? "rgba(167,139,250,.5)" : "rgba(255,255,255,.08)"}`, background: selectedType === c.id ? "rgba(124,58,237,.25)" : "transparent", cursor: "pointer", color: selectedType === c.id ? "#c4b5fd" : "#94a3b8", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap", transition: "all .2s" }}>
                            <span>{c.icon}</span><span>{c.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Results toolbar */}
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0.85rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
                    {loading ? "מחפש..." : `${sorted.length} עסקים`}
                    {hasFilters && <span style={{ color: "#a78bfa", marginRight: "0.4rem" }}> · מסוננים</span>}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {/* Sort */}
                    <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
                        style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: "0.4rem 0.7rem", color: "#94a3b8", fontSize: "0.8rem", cursor: "pointer", outline: "none" }}>
                        {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    {/* View toggle */}
                    <div style={{ display: "flex", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, overflow: "hidden" }}>
                        {(["grid", "list"] as ViewMode[]).map(v => (
                            <button key={v} type="button" onClick={() => setView(v)}
                                style={{ padding: "0.4rem 0.65rem", border: "none", cursor: "pointer", background: view === v ? "#7c3aed" : "transparent", color: view === v ? "#fff" : "#64748b", fontSize: "0.9rem", transition: "all .2s" }}>
                                {v === "grid" ? "⊞" : "☰"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Results */}
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 1.25rem 5rem" }}>
                {loading ? (
                    <div style={{ textAlign: "center", padding: "4rem" }}>
                        <div style={{ width: 40, height: 40, border: "3px solid rgba(167,139,250,.2)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 1rem" }} />
                        <div style={{ color: "#64748b" }}>מחפש...</div>
                    </div>
                ) : sorted.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>
                        <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>🔍</div>
                        <div style={{ marginBottom: "1rem" }}>לא נמצאו עסקים תואמים</div>
                        <button type="button" onClick={clearAll}
                            style={{ background: "rgba(124,58,237,.2)", border: "1px solid rgba(124,58,237,.3)", color: "#a78bfa", padding: "0.55rem 1.2rem", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
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
    return (
        <Link href={`/b/${s.slug}`} style={{ textDecoration: "none", display: "block" }}>
            <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
                style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${hovered ? "rgba(167,139,250,.4)" : "rgba(255,255,255,.08)"}`, borderRadius: 20, overflow: "hidden", transform: hovered ? "translateY(-3px)" : "none", transition: "all .25s", boxShadow: hovered ? "0 8px 24px rgba(0,0,0,.3)" : "none" }}>
                <div style={{ height: 140, position: "relative", background: s.cover_url ? undefined : (CAT_GRADIENTS[s.business_type] || CAT_GRADIENTS.other) }}>
                    {s.cover_url && <img src={imgUrl(s.cover_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: hovered ? "scale(1.04)" : "scale(1)", transition: "transform .3s" }} />}
                    {!s.cover_url && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3rem" }}>{s.logo_url ? <img src={imgUrl(s.logo_url)} alt="" style={{ width: 68, height: 68, borderRadius: 14, objectFit: "cover" }} /> : s.business_type_icon}</div>}
                    {s.cover_url && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,transparent 50%,rgba(0,0,0,.55))" }} />}
                    {s.self_booking_enabled && <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(74,222,128,.9)", color: "#052e16", fontSize: "0.66rem", fontWeight: 800, padding: "0.2rem 0.55rem", borderRadius: 7 }}>📅 אונליין</div>}
                </div>
                <div style={{ padding: "0.9rem" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.92rem", marginBottom: "0.2rem" }}>{s.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.35rem" }}>{s.business_type_icon} {s.business_type_label}{s.city ? ` · 📍 ${s.city}` : ""}</div>
                    {s.avg_rating != null && s.review_count > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem" }}>
                            <span style={{ color: "#fbbf24" }}>★</span>
                            <span style={{ color: "#fbbf24", fontWeight: 700 }}>{s.avg_rating.toFixed(1)}</span>
                            <span style={{ color: "#475569" }}>({s.review_count})</span>
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
            <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: "0.9rem 1rem", display: "flex", gap: "1rem", alignItems: "center", transition: "all .2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(167,139,250,.4)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,.06)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,.08)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,.04)"; }}>
                {/* Thumbnail */}
                <div style={{ width: 60, height: 60, borderRadius: 14, flexShrink: 0, overflow: "hidden", background: CAT_GRADIENTS[s.business_type] || CAT_GRADIENTS.other, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {s.logo_url ? <img src={imgUrl(s.logo_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "1.8rem" }}>{s.business_type_icon}</span>}
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.92rem", marginBottom: "0.15rem" }}>{s.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{s.business_type_icon} {s.business_type_label}{s.city ? ` · 📍 ${s.city}` : ""}</div>
                    {s.description && <div style={{ fontSize: "0.76rem", color: "#94a3b8", marginTop: "0.15rem", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{s.description}</div>}
                </div>
                {/* Right side */}
                <div style={{ flexShrink: 0, textAlign: "left", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem" }}>
                    {s.avg_rating != null && s.review_count > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.78rem" }}>
                            <span style={{ color: "#fbbf24" }}>★ {s.avg_rating.toFixed(1)}</span>
                            <span style={{ color: "#475569" }}>({s.review_count})</span>
                        </div>
                    )}
                    {s.self_booking_enabled && <span style={{ background: "rgba(74,222,128,.12)", color: "#4ade80", fontSize: "0.68rem", fontWeight: 700, padding: "0.18rem 0.5rem", borderRadius: 7 }}>📅 אונליין</span>}
                    <span style={{ color: "#a78bfa", fontSize: "0.75rem", fontWeight: 600 }}>צפה ←</span>
                </div>
            </div>
        </Link>
    );
}

export default function ExplorePage() {
    return (
        <Suspense fallback={<div style={{ height: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>⏳ טוען...</div>}>
            <ExploreContent />
        </Suspense>
    );
}
