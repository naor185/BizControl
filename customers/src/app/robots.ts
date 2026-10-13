import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

// What Google may read — the businesses and the search; not a client's own area, sign-in or booking links.
export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: "*", allow: "/", disallow: ["/me", "/studio", "/booking", "/verify-email", "/app"] },
        sitemap: `${SITE}/sitemap.xml`,
        host: SITE,
    };
}
