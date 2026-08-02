import { API } from "./api";

// The business-owner token — distinct from the consumer token in ./auth.ts
// (biz_customer_token). Named for what it actually is, used consistently by
// studio/login, for-business/register, and the BizControl handoff.
const STUDIO_TOKEN_KEY = "biz_studio_token";

export function getStudioToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STUDIO_TOKEN_KEY);
}

export function setStudioToken(token: string) {
    localStorage.setItem(STUDIO_TOKEN_KEY, token);
    // Same JWT, same JWT_SECRET — works directly on BizControl too.
    localStorage.setItem("bizcontrol_token", token);
}

export function clearStudioToken() {
    localStorage.removeItem(STUDIO_TOKEN_KEY);
    localStorage.removeItem("bizcontrol_token");
}

/**
 * Send the browser straight into BizControl, already authenticated, via the
 * existing one-time handoff-code exchange (POST /api/auth/create-handoff →
 * https://biz-control.com/auto-login?code=...&next=...). The single place
 * this logic lives — every BizFind screen that hands a business owner off
 * to BizControl calls this instead of re-implementing the fetch+redirect.
 */
export async function goToBizControl(next = "/dashboard"): Promise<void> {
    const token = getStudioToken();
    if (!token) {
        window.location.href = "https://biz-control.com/login";
        return;
    }
    try {
        const res = await fetch(`${API}/api/auth/create-handoff`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
            const { code } = await res.json();
            window.location.href = `https://biz-control.com/auto-login?code=${code}&next=${encodeURIComponent(next)}`;
            return;
        }
    } catch {
        // fall through to plain login below
    }
    window.location.href = "https://biz-control.com/login";
}
