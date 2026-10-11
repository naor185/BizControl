export const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export function imgUrl(url?: string | null): string {
    if (!url) return "";
    return url.startsWith("http") ? url : `${API}${url}`;
}

const TOKEN_KEY = "biz_customer_token";

export function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string) {
    localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const token = getToken();
    const res = await fetch(`${API}${path}`, {
        ...opts,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(opts?.headers || {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(errorText(err.detail, `HTTP ${res.status}`));
    }
    // an empty answer (204 — e.g. deleting the account) is a success, not a failed JSON read
    const body = await res.text();
    return (body ? JSON.parse(body) : undefined) as T;
}

export async function publicFetch<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// A server error's words. A validation error (422) comes as a list — its messages, without pydantic's
// "Value error, " (e.g. "מספר טלפון לא תקין — …" from app/utils/phone.py), instead of the raw JSON.
export function errorText(detail: unknown, fallback: string): string {
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail)) {
        const words = detail.map(d => String((d as { msg?: string })?.msg ?? "").replace(/^Value error, /, "")).filter(Boolean);
        if (words.length) return Array.from(new Set(words)).join(" · ");
    }
    return fallback;
}
