import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MapPin } from "lucide-react";
import { GLASS_CARD } from "@/lib/look";
import { SITE, areaPath, jsonForScript, loadAreas } from "@/lib/seo";

// A business field across the country — every city BizFind has it in, each leading to its "field + city" page
// (app/c/[type]/[city]/page.tsx). Drawn on the server; told to Google from two businesses up.

export const revalidate = 600;

type Params = { params: { type: string } };

async function load({ params }: Params) {
    const type = decodeURIComponent(params.type);
    const cities = (await loadAreas()).filter(a => a.type === type);
    if (!cities.length) return null;
    const total = cities.reduce((n, a) => n + a.count, 0);
    return { type, label: cities[0].label, cities, total, indexed: total >= 2 && type !== "other" };
}

export async function generateMetadata(props: Params): Promise<Metadata> {
    const f = await load(props);
    if (!f) return { title: "BizFind", robots: { index: false } };
    const title = `${f.label} — ${f.total} עסקים ב-${f.cities.length} ערים | BizFind`;
    const description = `${f.label} לפי עיר: ${f.cities.slice(0, 6).map(c => c.city).join(", ")}. מחירים, ביקורות וקביעת תור ב-BizFind.`;
    return {
        title, description,
        alternates: { canonical: `${SITE}/c/${encodeURIComponent(f.type)}` },
        robots: f.indexed ? { index: true, follow: true } : { index: false, follow: true },
        openGraph: { title, description, url: `${SITE}/c/${encodeURIComponent(f.type)}`, siteName: "BizFind", locale: "he_IL", type: "website" },
    };
}

export default async function FieldPage(props: Params) {
    const f = await load(props);
    if (!f) notFound();
    const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "BizFind", item: SITE },
        { "@type": "ListItem", position: 2, name: f.label, item: `${SITE}/c/${encodeURIComponent(f.type)}` },
    ] };
    return (
        <main dir="rtl" style={{ maxWidth: 860, margin: "0 auto", padding: "1.25rem 1rem 3rem", color: "var(--bf-text)" }}>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(crumbs) }} />
            <nav aria-label="נתיב" style={{ fontSize: "0.8rem", color: "var(--bf-muted)", marginBottom: "1rem" }}>
                <Link href="/" style={{ color: "inherit" }}>BizFind</Link> › <span aria-current="page">{f.label}</span>
            </nav>
            <h1 style={{ fontSize: "clamp(1.6rem,4.5vw,2.3rem)", fontWeight: 900, margin: "0 0 0.6rem" }}>{f.label}</h1>
            <p style={{ color: "var(--bf-muted)", margin: "0 0 1.5rem" }}>{f.total} עסקים בתחום {f.label} ב-BizFind, ב-{f.cities.length} ערים.</p>
            <div style={{ display: "grid", gap: "0.6rem" }}>
                {f.cities.map(c => (
                    <Link key={c.city} href={areaPath(f.type, c.city)}
                        style={{ ...GLASS_CARD, borderRadius: 16, padding: "0.9rem 1rem", display: "flex", alignItems: "center", gap: "0.6rem", textDecoration: "none", color: "inherit" }}>
                        <MapPin size={16} aria-hidden style={{ color: "var(--bf-muted)" }} />
                        <span style={{ flex: 1, fontWeight: 700 }}>{f.label} ב{c.city}</span>
                        <span style={{ color: "var(--bf-muted)", fontSize: "0.85rem" }}>{c.count} עסקים</span>
                        <ChevronLeft size={16} aria-hidden style={{ color: "var(--bf-faint)" }} />
                    </Link>
                ))}
            </div>
        </main>
    );
}
