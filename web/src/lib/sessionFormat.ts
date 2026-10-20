import { tx, intl } from "@/lib/i18n";
// Shared by MySessionsSettings.tsx (self-service) and StaffSessionsModal.tsx
// (owner/admin viewing a staff member's devices) — same session shape, same
// display rules, two different endpoints underneath.

export interface SessionOut {
    id: string;
    user_agent: string | null;
    session_started_at: string | null;
    last_active_at: string;
}

// Best-effort, cosmetic only — just enough to tell devices apart in a list
// ("iPhone" vs "Chrome, Windows"), not a real UA parser.
export function describeDevice(ua: string | null): string {
    if (!ua) return tx("מכשיר לא מזוהה");
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return /wv\)/i.test(ua) ? tx("אפליקציית אנדרואיד") : "Android";
    if (/Macintosh/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "Windows";
    return tx("דפדפן");
}

export function formatSessionDate(iso: string | null): string {
    if (!iso) return tx("לא ידוע");
    try {
        return new Date(iso).toLocaleString(intl(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
        return tx("לא ידוע");
    }
}
