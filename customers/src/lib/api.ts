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
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function publicFetch<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
