import type { MetadataRoute } from "next";
import { API } from "@/lib/api";
import { SITE, areaPath, loadAreas } from "@/lib/seo";

// The list Google reads — every business's page, and the "field + city" pages with two businesses or more
// (/api/marketplace/sitemap, /api/marketplace/areas; owner, 2026-10-13). Rebuilt within the hour.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    let businesses: { slug: string }[] = [];
    try {
        const res = await fetch(`${API}/api/marketplace/sitemap`, { next: { revalidate: 3600 } });
        if (res.ok) businesses = await res.json();
    } catch { /* the pages that are always there, then */ }
    const areas = (await loadAreas()).filter(a => a.indexed);
    const fields = Array.from(new Set(areas.map(a => a.type)));
    return [
        { url: SITE, changeFrequency: "daily", priority: 1 },
        { url: `${SITE}/explore`, changeFrequency: "daily", priority: 0.9 },
        { url: `${SITE}/for-business`, changeFrequency: "monthly", priority: 0.5 },
        ...fields.map(t => ({ url: `${SITE}/c/${encodeURIComponent(t)}`, changeFrequency: "weekly" as const, priority: 0.8 })),
        ...areas.map(a => ({ url: `${SITE}${areaPath(a.type, a.city)}`, changeFrequency: "weekly" as const, priority: 0.85 })),
        ...businesses.map(b => ({ url: `${SITE}/b/${encodeURIComponent(b.slug)}`, changeFrequency: "weekly" as const, priority: 0.8 })),
    ];
}
