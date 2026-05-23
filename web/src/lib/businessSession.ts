/**
 * Business Management session manager.
 * Uses sessionStorage (clears on tab/browser close).
 * 30-minute inactivity timeout after PIN unlock.
 */

const TOKEN_KEY = "biz_business_token";
const ACTIVITY_KEY = "biz_business_last_activity";
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function getBusinessToken(): string | null {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(TOKEN_KEY);
}

export function setBusinessSession(token: string): void {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(ACTIVITY_KEY, Date.now().toString());
}

export function clearBusinessSession(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
}

export function refreshBusinessActivity(): void {
    if (sessionStorage.getItem(TOKEN_KEY)) {
        sessionStorage.setItem(ACTIVITY_KEY, Date.now().toString());
    }
}

export function isBusinessSessionValid(): boolean {
    if (typeof window === "undefined") return false;
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return false;

    // Check inactivity timeout
    const lastActivity = sessionStorage.getItem(ACTIVITY_KEY);
    if (!lastActivity) return false;
    if (Date.now() - parseInt(lastActivity, 10) > TIMEOUT_MS) {
        clearBusinessSession();
        return false;
    }

    // Check JWT expiry (client-side, no signature validation)
    try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        const expMs = payload.exp * 1000;
        if (Date.now() >= expMs) {
            clearBusinessSession();
            return false;
        }
    } catch {
        clearBusinessSession();
        return false;
    }

    return true;
}

export function getBusinessSessionTimeLeft(): number {
    const lastActivity = sessionStorage.getItem(ACTIVITY_KEY);
    if (!lastActivity) return 0;
    const elapsed = Date.now() - parseInt(lastActivity, 10);
    return Math.max(0, TIMEOUT_MS - elapsed);
}
