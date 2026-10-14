import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, ChevronLeft, MapPin, Star, Store } from "lucide-react";
import { API, imgUrl } from "@/lib/api";
import { GLASS_CARD, PRIMARY_BTN } from "@/lib/look";
import { SITE, areaPath, findArea, jsonForScript } from "@/lib/seo";

// "ספרים בראשון לציון" — a page per business field and city, the way people search Google (SEO stage 2,
// app/services/bizfind_areas.py). Drawn on the server, so Google reads all of it: the businesses, how many book
// online, the rating, the services and their prices, the nearby pages. Told to Google only from two businesses up.

export const revalidate = 600;

type Business = { slug: string; name: string; is_claimed: boolean; logo_url: string | null; cover_url: string | null;
    address: string | null; description: string | null; self_booking_enabled: boolean; avg_rating: number | null; review_count: number };
type Page = { type: string; label: string; city: string; count: number; joined: number; booking: number; avg_rating: number | null;
    review_count: number; indexed: boolean; businesses: Business[];
    services: { name: string; businesses: number; min_ils: number | null; max_ils: number | null }[];
    other_cities: { city: string; count: number }[]; other_fields: { type: string; label: string; count: number }[] };
type Params = { params: { type: string; city: string } };

async function load({ params }: Params): Promise<Page | null> {
    const area = await findArea(params.type, params.city);
    if (!area) return null;
    try {
        const res = await fetch(`${API}/api/marketplace/areas/${encodeURIComponent(area.type)}/${encodeURIComponent(area.city)}`, { next: { revalidate: 600 } });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

const ils = (v: number) => `₪${v.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;

function summary(p: Page): string {
    const parts = [`${p.count} עסקים בתחום ${p.label} ב${p.city} ב-BizFind`];
    if (p.booking) parts.push(`${p.booking} מהם עם קביעת תור אונליין`);
    if (p.avg_rating) parts.push(`דירוג ממוצע ${p.avg_rating} מתוך 5`);
    return parts.join(", ");
}

export async function generateMetadata(props: Params): Promise<Metadata> {
    const p = await load(props);
    if (!p) return { title: "BizFind", robots: { index: false } };
    const url = `${SITE}${areaPath(p.type, p.city)}`;
    const title = `${p.label} ב${p.city} — ${p.count} עסקים, מחירים וביקורות | BizFind`;
    const description = `מחפשים ${p.label} ב${p.city}? ${summary(p)}. שירותים, מחירים וביקורות${p.booking ? " — וקביעת תור בכמה לחיצות" : ""}.`.slice(0, 200);
    return {
        title, description,
        keywords: [`${p.label} ב${p.city}`, `${p.label} ${p.city}`, p.label, p.city, ...p.services.slice(0, 6).map(s => `${s.name} ב${p.city}`)],
        alternates: { canonical: url },
        robots: p.indexed ? { index: true, follow: true } : { index: false, follow: true },
        openGraph: { title, description, url, siteName: "BizFind", locale: "he_IL", type: "website" },
    };
}

export default async function AreaPage(props: Params) {
    const p = await load(props);
    if (!p) notFound();
    const url = `${SITE}${areaPath(p.type, p.city)}`;
    const jsonLd = [
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: "BizFind", item: SITE },
            { "@type": "ListItem", position: 2, name: p.label, item: `${SITE}/c/${encodeURIComponent(p.type)}` },
            { "@type": "ListItem", position: 3, name: p.city, item: url },
        ] },
        { "@context": "https://schema.org", "@type": "ItemList", name: `${p.label} ב${p.city}`, numberOfItems: p.count,
          itemListElement: p.businesses.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, url: `${SITE}/b/${encodeURIComponent(b.slug)}` })) },
    ];

    return (
        <main dir="rtl" style={{ maxWidth: 860, margin: "0 auto", padding: "1.25rem 1rem 3rem", color: "var(--bf-text)" }}>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd) }} />

            <nav aria-label="נתיב" style={{ fontSize: "0.8rem", color: "var(--bf-muted)", display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <Link href="/" style={{ color: "inherit" }}>BizFind</Link> ›
                <Link href={`/c/${encodeURIComponent(p.type)}`} style={{ color: "inherit" }}>{p.label}</Link> ›
                <span aria-current="page">{p.city}</span>
            </nav>

            <h1 style={{ fontSize: "clamp(1.6rem,4.5vw,2.3rem)", fontWeight: 900, lineHeight: 1.2, margin: "0 0 0.6rem" }}>{p.label} ב{p.city}</h1>
            <p style={{ color: "var(--bf-muted)", lineHeight: 1.7, margin: "0 0 1.5rem", maxWidth: 640 }}>{summary(p)}.</p>

            <section aria-label="העסקים" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
                {p.businesses.map(b => (
                    <Link key={b.slug} href={`/b/${encodeURIComponent(b.slug)}`}
                        style={{ ...GLASS_CARD, borderRadius: 18, padding: "0.9rem", display: "flex", gap: "0.85rem", alignItems: "center", textDecoration: "none", color: "inherit" }}>
                        <div style={{ width: 64, height: 64, borderRadius: 14, overflow: "hidden", flexShrink: 0, background: b.logo_url ? "#fff" : "var(--bf-glass-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {b.logo_url || b.cover_url
                                ? <img src={imgUrl(b.logo_url || b.cover_url)} alt="" style={{ width: "100%", height: "100%", objectFit: b.logo_url ? "contain" : "cover" }} />
                                : <Store size={26} aria-hidden />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: 0 }}>{b.name}</h2>
                            {b.address && <div style={{ color: "var(--bf-muted)", fontSize: "0.8rem", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}><MapPin size={12} aria-hidden /> {b.address}</div>}
                            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: 5, fontSize: "0.78rem" }}>
                                {b.avg_rating && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Star size={12} fill="#fbbf24" color="#fbbf24" aria-hidden /> {b.avg_rating} ({b.review_count})</span>}
                                {b.self_booking_enabled && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 700 }}><CalendarCheck size={12} aria-hidden /> קביעת תור אונליין</span>}
                            </div>
                            {b.description && <p style={{ color: "var(--bf-muted)", fontSize: "0.8rem", margin: "5px 0 0", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{b.description}</p>}
                        </div>
                        <ChevronLeft size={18} aria-hidden style={{ color: "var(--bf-faint)", flexShrink: 0 }} />
                    </Link>
                ))}
            </section>

            {p.services.length > 0 && (
                <section style={{ marginBottom: "2rem" }}>
                    <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: "0 0 0.75rem" }}>שירותים ומחירים — {p.label} ב{p.city}</h2>
                    <div style={{ ...GLASS_CARD, borderRadius: 16, overflow: "hidden" }}>
                        {p.services.map((s, i) => (
                            <div key={s.name} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.7rem 1rem", borderTop: i ? "1px solid var(--bf-line)" : "none", fontSize: "0.88rem" }}>
                                <span>{s.name}</span>
                                <span style={{ color: "var(--bf-muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                                    {s.min_ils == null ? "" : s.min_ils === s.max_ils ? ils(s.min_ils) : `${ils(s.min_ils)}–${ils(s.max_ils!)}`}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {(p.other_cities.length > 0 || p.other_fields.length > 0) && (
                <section style={{ display: "grid", gap: "1.25rem", marginBottom: "2rem" }}>
                    {p.other_cities.length > 0 && (
                        <div>
                            <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 0.6rem" }}>{p.label} בערים נוספות</h2>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                                {p.other_cities.map(c => <Link key={c.city} href={areaPath(p.type, c.city)} style={CHIP}>{p.label} ב{c.city} ({c.count})</Link>)}
                            </div>
                        </div>
                    )}
                    {p.other_fields.length > 0 && (
                        <div>
                            <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 0.6rem" }}>עוד ב{p.city}</h2>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                                {p.other_fields.map(f => <Link key={f.type} href={areaPath(f.type, p.city)} style={CHIP}>{f.label} ({f.count})</Link>)}
                            </div>
                        </div>
                    )}
                </section>
            )}

            <section style={{ ...GLASS_CARD, borderRadius: 18, padding: "1.1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                    <div style={{ fontWeight: 800 }}>יש לך עסק בתחום {p.label} ב{p.city}?</div>
                    <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem", marginTop: 2 }}>הצטרפו ל-BizFind — לקוחות חדשים מוצאים אתכם וקובעים תור.</div>
                </div>
                <Link href="/for-business" style={{ ...PRIMARY_BTN, borderRadius: 12 }}>הצטרפות לעסקים</Link>
            </section>
        </main>
    );
}

const CHIP: React.CSSProperties = { ...GLASS_CARD, borderRadius: 999, padding: "0.45rem 0.9rem", fontSize: "0.82rem", fontWeight: 600, textDecoration: "none", color: "var(--bf-text)" };
