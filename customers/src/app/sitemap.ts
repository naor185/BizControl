import type { MetadataRoute } from "next";
import { API } from "@/lib/api";
import { SITE } from "@/lib/seo";

// The list Google reads to find every business's page — rebuilt within the hour when a business joins or leaves
// BizFind (/api/marketplace/sitemap; owner, 2026-10-13).
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    let businesses: { slug: string }[] = [];
    try {
        const res = await fetch(`${API}/api/marketplace/sitemap`, { next: { revalidate: 3600 } });
        if (res.ok) businesses = await res.json();
    } catch { /* the pages that are always there, then */ }
    return [
        { url: SITE, changeFrequency: "daily", priority: 1 },
        { url: `${SITE}/explore`, changeFrequency: "daily", priority: 0.9 },
        { url: `${SITE}/for-business`, changeFrequency: "monthly", priority: 0.5 },
        ...businesses.map(b => ({ url: `${SITE}/b/${encodeURIComponent(b.slug)}`, changeFrequency: "weekly" as const, priority: 0.8 })),
    ];
}
