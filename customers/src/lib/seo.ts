import { API, imgUrl } from "@/lib/api";

// Google and the link previews — every business's page with its own title, description, keywords and a business card
// Google reads (schema.org), all from what the owner set in BizControl (owner, 2026-10-13: "every business with its
// own page, found on Google through us — automatic, from the owner's settings").

export const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://find.biz-control.com").replace(/\/$/, "");

export interface SeoBusiness {
    slug: string; name: string; business_type: string; business_type_label: string;
    description: string | null; city: string | null; address: string | null; phone: string | null;
    logo_url: string | null; cover_url: string | null; gallery: string[];
    instagram: string | null; facebook: string | null; tiktok: string | null; website: string | null; youtube: string | null;
    services: { name: string; price_ils: number | null; description: string | null }[];
    avg_rating: number | null; review_count: number; self_booking_enabled: boolean;
}

// The business's kind as schema.org knows it — Google's own words for "a tattoo parlor", "a hair salon"
const SCHEMA_TYPE: Record<string, string> = {
    tattoo: "TattooParlor", barber: "HairSalon", hair: "HairSalon", nails: "NailSalon", spa: "DaySpa",
    laser: "BeautySalon", massage: "HealthAndBeautyBusiness", pilates: "SportsActivityLocation", gym: "ExerciseGym",
    medical: "MedicalClinic", dental: "Dentist", psychology: "MedicalBusiness", photography: "ProfessionalService",
    clothing: "ClothingStore", pharmacy: "Pharmacy", florist: "Florist",
};

/** The business as BizFind shows it — null when it isn't shown (hidden, archived, not found). Cached ten minutes. */
export async function loadBusiness(slug: string): Promise<SeoBusiness | null> {
    try {
        const res = await fetch(`${API}/api/marketplace/${encodeURIComponent(slug)}`, { next: { revalidate: 600 } });
        if (!res.ok) return null;
        const b = await res.json();
        // a directory business that hasn't joined comes with fewer fields
        return { ...b, slug: b.slug || slug, business_type: b.business_type || "other", business_type_label: b.business_type_label || "",
            services: b.services || [], gallery: b.gallery || [], review_count: b.review_count || 0, avg_rating: b.avg_rating ?? null,
            self_booking_enabled: !!b.self_booking_enabled } as SeoBusiness;
    } catch {
        return null;
    }
}

const where = (b: SeoBusiness) => [b.business_type_label, b.city ? `ב${b.city}` : ""].filter(Boolean).join(" ");

export function businessTitle(b: SeoBusiness): string {
    const kind = b.business_type && b.business_type !== "other" ? where(b) : (b.city ? `ב${b.city}` : "");
    return `${b.name}${kind ? ` — ${kind}` : ""} | BizFind`;
}

export function businessDescription(b: SeoBusiness): string {
    const own = (b.description || "").replace(/\s+/g, " ").trim();
    const services = b.services.slice(0, 4).map(s => s.name).join(", ");
    const base = (own || [`${b.name}${b.city ? ` ב${b.city}` : ""}`, services].filter(Boolean).join(": ")).replace(/[.!?…\s]+$/, "");
    const action = b.self_booking_enabled ? "קביעת תור אונליין ב-BizFind" : "פרטים, שירותים וביקורות ב-BizFind";
    const text = `${base}. ${action}.`;
    return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}

export function businessKeywords(b: SeoBusiness): string[] {
    const k = [b.name, b.business_type !== "other" ? b.business_type_label : "", b.city || "",
        b.business_type !== "other" && b.city ? `${b.business_type_label} ב${b.city}` : "",
        ...b.services.slice(0, 8).map(s => s.name), ...(b.city ? b.services.slice(0, 3).map(s => `${s.name} ${b.city}`) : []),
        "קביעת תור"];
    return Array.from(new Set(k.map(x => x.trim()).filter(Boolean)));
}

export function businessImage(b: SeoBusiness): string | undefined {
    const pic = b.cover_url || b.gallery?.[0] || b.logo_url;
    return pic ? imgUrl(pic) : undefined;
}

/** The business card Google reads (schema.org LocalBusiness) — only what the owner really set. */
export function businessJsonLd(b: SeoBusiness): Record<string, unknown> {
    const url = `${SITE}/b/${encodeURIComponent(b.slug)}`;
    const sameAs = [b.instagram, b.facebook, b.tiktok, b.website, b.youtube].filter((x): x is string => !!x && /^https?:\/\//.test(x));
    const data: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": SCHEMA_TYPE[b.business_type] || "LocalBusiness",
        "@id": url, url, name: b.name,
        description: businessDescription(b),
        image: businessImage(b),
        telephone: b.phone || undefined,
        address: (b.address || b.city) ? { "@type": "PostalAddress", streetAddress: b.address || undefined, addressLocality: b.city || undefined, addressCountry: "IL" } : undefined,
        sameAs: sameAs.length ? sameAs : undefined,
        aggregateRating: b.review_count > 0 && b.avg_rating ? { "@type": "AggregateRating", ratingValue: Number(b.avg_rating.toFixed(1)), reviewCount: b.review_count, bestRating: 5, worstRating: 1 } : undefined,
        makesOffer: b.services.length ? b.services.slice(0, 20).map(s => ({
            "@type": "Offer",
            itemOffered: { "@type": "Service", name: s.name, description: s.description || undefined },
            ...(s.price_ils ? { price: s.price_ils, priceCurrency: "ILS" } : {}),
        })) : undefined,
    };
    return JSON.parse(JSON.stringify(data));          // the empty fields drop out
}

/** JSON for a <script> — never a "</script>" inside it */
export const jsonForScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

// ── "field + city" pages (/c/<field>/<city>) — app/services/bizfind_areas.py ────────────────────────────────────────

export interface Area { type: string; label: string; city: string; count: number; joined: number; indexed: boolean }

/** A city in an address: spaces become hyphens — /c/barber/ראשון-לציון */
export const citySlug = (city: string) => city.trim().replace(/\s+/g, "-");
export const areaPath = (type: string, city: string) => `/c/${encodeURIComponent(type)}/${encodeURIComponent(citySlug(city))}`;

export async function loadAreas(): Promise<Area[]> {
    try {
        const res = await fetch(`${API}/api/marketplace/areas`, { next: { revalidate: 600 } });
        return res.ok ? await res.json() : [];
    } catch {
        return [];
    }
}

/** The area an address points at — matched against the real list, so a city with a hyphen in its name works too. */
export async function findArea(type: string, cityParam: string): Promise<Area | null> {
    const wanted = (() => { try { return decodeURIComponent(cityParam); } catch { return cityParam; } })();
    return (await loadAreas()).find(a => a.type === type && citySlug(a.city) === citySlug(wanted)) || null;
}
