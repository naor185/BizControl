// The coupon a visitor came with — the business's coupon link is /b/<slug>?c=<code>. The business page checks it
// (POST /api/public/coupons/<slug>/<code>, counted once per visit), shows it, and keeps the code for this business so
// the booking request and the online booking carry "קופון: <code>" in the notes the business reads.
import { API } from "@/lib/api";

export interface VisitCoupon { code: string; discount_percent: number; expires_on: string | null; once_per_client: boolean }

const keyOf = (slug: string) => `bizfind_coupon_${slug}`;

export async function openCouponLink(slug: string, code: string): Promise<VisitCoupon | null> {
    const seenKey = `bizfind_coupon_seen_${slug}_${code.toUpperCase()}`;
    let seen = false;
    try { seen = !!sessionStorage.getItem(seenKey); } catch { /* private mode */ }
    try {
        const r = await fetch(`${API}/api/public/coupons/${encodeURIComponent(slug)}/${encodeURIComponent(code)}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: !seen }),
        });
        if (!r.ok) return null;
        const c: VisitCoupon = await r.json();
        try { sessionStorage.setItem(seenKey, "1"); sessionStorage.setItem(keyOf(slug), c.code); } catch { /* private mode */ }
        return c;
    } catch {
        return null;
    }
}

// "קופון: SUMMER10" for the notes of a booking at this business, when the visitor came with one.
export function couponNote(slug: string): string {
    try {
        const code = sessionStorage.getItem(keyOf(slug));
        return code ? `קופון: ${code}` : "";
    } catch {
        return "";
    }
}
