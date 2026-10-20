import { tx } from "@/lib/i18n";

// Single source of truth for appointment status → color/label/icon.
// Values must match the DB CheckConstraint in app/models/appointment.py exactly
// ('scheduled','done','canceled','no_show') — a spelling drift here silently
// breaks color-matching without any visible error.
export type AppointmentStatus = "scheduled" | "done" | "canceled" | "no_show";

export const STATUS_META: Record<AppointmentStatus, { color: string; label: string; icon: string }> = {
    scheduled: { color: "#3b82f6", label: "מתוכנן", icon: "🕒" },
    done:      { color: "#10b981", label: "בוצע",   icon: "✅" },
    canceled:  { color: "#ef4444", label: "בוטל",   icon: "✕" },
    no_show:   { color: "#f59e0b", label: "לא הגיע", icon: "⚠️" },
};

/** The status's color, icon and label — the label in the user's language (lib/i18n tx). */
export function statusMeta(status: string | undefined | null) {
    const meta = STATUS_META[(status as AppointmentStatus)] || STATUS_META.scheduled;
    return { ...meta, label: tx(meta.label) };
}
