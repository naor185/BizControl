"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarCheck, CheckCircle2, Hourglass, Search, XCircle, type LucideIcon } from "lucide-react";
import { API, imgUrl } from "@/lib/api";
import { GLASS_CARD, PRIMARY_BTN } from "@/lib/look";

// The page a client reaches from the WhatsApp that a booking request was approved ("צפה בפרטי התור שלך").

interface BookingStatus {
    status: "pending" | "approved" | "rejected";
    client_name: string;
    requested_at: string;
    service_note: string | null;
    artist_name: string | null;
    studio_name: string | null;
    studio_address: string | null;
    studio_logo: string | null;
    rejection_reason: string | null;
    appointment_id: string | null;
    appointment_status: string | null;
}

const STATUS_DISPLAY: Record<BookingStatus["status"], { icon: LucideIcon; label: string; color: string }> = {
    pending:  { icon: Hourglass,    label: "ממתין לאישור", color: "#fcd34d" },
    approved: { icon: CheckCircle2, label: "אושר!",        color: "#4ade80" },
    rejected: { icon: XCircle,      label: "לא אושר",      color: "#f87171" },
};

export default function BookingStatusPage() {
    const { token } = useParams<{ token: string }>();
    const [data, setData] = useState<BookingStatus | null>(null);
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${API}/api/public/booking/${token}`)
            .then(r => {
                if (!r.ok) throw new Error();
                return r.json();
            })
            .then(setData)
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [token]);

    if (loading) return (
        <div style={PAGE}>
            <div style={{ width: 36, height: 36, border: "3px solid rgba(255,255,255,.18)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        </div>
    );

    if (error || !data) return (
        <div dir="rtl" style={{ ...PAGE, flexDirection: "column", textAlign: "center" }}>
            <Search size={40} strokeWidth={1.5} aria-hidden style={{ marginBottom: "1rem" }} />
            <h1 style={{ fontSize: "1.25rem", fontWeight: 800, marginBottom: "0.5rem" }}>הזמנה לא נמצאה</h1>
            <p style={{ color: "var(--bf-muted)" }}>הלינק לא תקין או שההזמנה כבר אינה קיימת.</p>
        </div>
    );

    const st = STATUS_DISPLAY[data.status] || STATUS_DISPLAY.pending;
    const Icon = st.icon;

    return (
        <div dir="rtl" style={PAGE}>
            <div style={{ ...GLASS_CARD, borderRadius: 24, maxWidth: 440, width: "100%", overflow: "hidden" }}>
                {/* Header */}
                <div style={{ padding: "1.5rem", textAlign: "center", borderBottom: "1px solid var(--bf-line)", background: "linear-gradient(180deg,rgba(255,255,255,.07),transparent)" }}>
                    {data.studio_logo && (
                        <img src={imgUrl(data.studio_logo)} alt={data.studio_name || ""}
                            style={{ width: 64, height: 64, borderRadius: 16, objectFit: "contain", background: "#fff", padding: 4, margin: "0 auto 0.75rem", display: "block" }} />
                    )}
                    <h1 style={{ fontSize: "1.15rem", fontWeight: 800 }}>{data.studio_name || "העסק"}</h1>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.85rem", marginTop: "0.2rem" }}>פרטי הזמנה</p>
                </div>

                {/* Status */}
                <div style={{ padding: "1.25rem 1.5rem 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: 14, border: `1px solid ${st.color}55`, background: `${st.color}14`, padding: "0.75rem 1rem", fontWeight: 700, color: st.color }}>
                        <Icon size={20} aria-hidden />
                        <span>{st.label}</span>
                    </div>
                </div>

                {/* Details */}
                <div style={{ padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.7rem", fontSize: "0.9rem" }}>
                    <Row label="לקוח" value={data.client_name} />
                    <Row label="תאריך ושעה" value={data.requested_at} />
                    {data.artist_name && <Row label="עם" value={data.artist_name} />}
                    {data.service_note && <Row label="שירות" value={data.service_note} />}
                    {data.studio_address && <Row label="כתובת" value={data.studio_address} />}
                    {data.rejection_reason && (
                        <div style={{ borderRadius: 10, border: "1px solid rgba(248,113,113,.35)", background: "rgba(248,113,113,.08)", padding: "0.6rem 0.8rem", color: "#fca5a5", fontSize: "0.82rem" }}>
                            <span style={{ fontWeight: 700 }}>סיבה: </span>{data.rejection_reason}
                        </div>
                    )}
                </div>

                {data.status === "pending" && (
                    <p style={{ padding: "0 1.5rem 1.4rem", textAlign: "center", fontSize: "0.8rem", color: "var(--bf-faint)" }}>העסק יאשר את הבקשה בהקדם. תקבל הודעה בוואטסאפ.</p>
                )}

                {data.status === "approved" && (
                    <p style={{ padding: "0 1.5rem 1.4rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--bf-text)" }}>
                        <CalendarCheck size={16} aria-hidden /> התור שלך מאושר ונעול ביומן!
                    </p>
                )}

                {data.status === "rejected" && (
                    <div style={{ padding: "0 1.5rem 1.5rem" }}>
                        <a href="/" style={{ ...PRIMARY_BTN, justifyContent: "center" }}>חפש זמן חלופי</a>
                    </div>
                )}
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--bf-faint)", flexShrink: 0 }}>{label}</span>
            <span style={{ fontWeight: 600, textAlign: "left" }}>{value}</span>
        </div>
    );
}

const PAGE: React.CSSProperties = {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem 1rem 5rem",
    background: "var(--bf-bg)", color: "var(--bf-text)",
};
