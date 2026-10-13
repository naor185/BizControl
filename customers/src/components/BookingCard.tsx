import Link from "next/link";
import { CalendarDays, ChevronLeft, Scissors, User } from "lucide-react";
import { GLASS_CARD } from "@/lib/look";

// One appointment of the client's (/api/marketplace/auth/my-bookings) — "my bookings" and a business's page in the
// personal area show the same card.

export interface Booking {
    id: string;
    starts_at: string | null;
    status: string;
    studio_name: string;
    studio_slug: string;
    service_name: string | null;
    artist_name: string | null;
    notes: string | null;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
    scheduled: { label: "מאושר",   color: "#4ade80" },
    done:       { label: "הושלם",   color: "#cbd5e1" },
    canceled:   { label: "בוטל",    color: "#f87171" },
    no_show:    { label: "לא הגיע", color: "#f59e0b" },
};

/** Still ahead: scheduled, and not yet past. */
export const isUpcoming = (b: Booking) => b.status === "scheduled" && !!b.starts_at && new Date(b.starts_at).getTime() > Date.now();

export default function BookingCard({ b, withBusinessLink = true }: { b: Booking; withBusinessLink?: boolean }) {
    const st = STATUS_LABEL[b.status] || { label: b.status, color: "#cbd5e1" };
    const date = b.starts_at ? new Date(b.starts_at) : null;
    return (
        <div style={{ ...GLASS_CARD, borderRadius: 16, padding: "1rem 1.1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{b.studio_name}</div>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: st.color, background: `${st.color}22`, padding: "0.2rem 0.55rem", borderRadius: 8 }}>{st.label}</span>
            </div>
            {b.service_name && <div style={LINE}><Scissors size={13} aria-hidden /> {b.service_name}</div>}
            {b.artist_name && <div style={LINE}><User size={13} aria-hidden /> {b.artist_name}</div>}
            {date && (
                <div style={{ ...LINE, color: "var(--bf-text)", marginTop: "0.4rem" }}>
                    <CalendarDays size={13} aria-hidden /> {date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                    {" · "}
                    {date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                </div>
            )}
            {withBusinessLink && (
                <Link href={`/b/${b.studio_slug}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.1rem", marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--bf-text)", textDecoration: "none", fontWeight: 700 }}>
                    לדף העסק <ChevronLeft size={14} aria-hidden />
                </Link>
            )}
        </div>
    );
}

const LINE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.35rem", color: "var(--bf-muted)", fontSize: "0.82rem", marginBottom: "0.25rem" };
