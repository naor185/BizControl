"use client";
import { useEffect, useState } from "react";
import { API, getToken } from "@/lib/api";
import Link from "next/link";

interface Booking {
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
    done:       { label: "הושלם",   color: "#94a3b8" },
    canceled:   { label: "בוטל",    color: "#f87171" },
    no_show:    { label: "לא הגיע", color: "#f59e0b" },
};

export default function BookingsPage() {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const token = getToken();
        if (!token) { setError("נדרשת התחברות"); setLoading(false); return; }
        fetch(`${API}/api/marketplace/auth/my-bookings`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => r.ok ? r.json() : Promise.reject("שגיאה"))
            .then(setBookings)
            .catch(() => setError("שגיאה בטעינת התורים"))
            .finally(() => setLoading(false));
    }, []);

    const upcoming = bookings.filter(b => b.status === "scheduled");
    const past = bookings.filter(b => b.status !== "scheduled");

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", padding: "1.5rem 1rem 5rem", fontFamily: "system-ui,sans-serif" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
                <Link href="/me" style={{ color: "#94a3b8", textDecoration: "none", fontSize: "1.2rem" }}>←</Link>
                <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>📋 ההזמנות שלי</h1>
            </div>

            {loading && (
                <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                    <div style={{ width: 36, height: 36, border: "3px solid rgba(167,139,250,.2)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 1rem" }} />
                    טוען...
                </div>
            )}

            {error && (
                <div style={{ textAlign: "center", padding: "3rem", color: "#f87171" }}>{error}</div>
            )}

            {!loading && !error && bookings.length === 0 && (
                <div style={{ textAlign: "center", padding: "4rem 1rem", color: "#64748b" }}>
                    <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📅</div>
                    <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>אין תורים עדיין</div>
                    <div style={{ fontSize: "0.85rem" }}>קבע תור בסטודיו שאתה אוהב</div>
                    <Link href="/" style={{ display: "inline-block", marginTop: "1.5rem", background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff", textDecoration: "none", padding: "0.65rem 1.5rem", borderRadius: 12, fontWeight: 700, fontSize: "0.9rem" }}>
                        🔍 חפש סטודיו
                    </Link>
                </div>
            )}

            {!loading && upcoming.length > 0 && (
                <section style={{ marginBottom: "2rem" }}>
                    <h2 style={{ fontSize: "0.8rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>תורים קרובים</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        {upcoming.map(b => <BookingCard key={b.id} b={b} />)}
                    </div>
                </section>
            )}

            {!loading && past.length > 0 && (
                <section>
                    <h2 style={{ fontSize: "0.8rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>היסטוריה</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        {past.map(b => <BookingCard key={b.id} b={b} />)}
                    </div>
                </section>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

function BookingCard({ b }: { b: Booking }) {
    const st = STATUS_LABEL[b.status] || { label: b.status, color: "#94a3b8" };
    const date = b.starts_at ? new Date(b.starts_at) : null;
    return (
        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: "1rem 1.1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{b.studio_name}</div>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: st.color, background: `${st.color}22`, padding: "0.2rem 0.55rem", borderRadius: 8 }}>{st.label}</span>
            </div>
            {b.service_name && <div style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: "0.25rem" }}>✂️ {b.service_name}</div>}
            {b.artist_name && <div style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: "0.25rem" }}>👤 {b.artist_name}</div>}
            {date && (
                <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.4rem" }}>
                    📅 {date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                    {" · "}
                    {date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                </div>
            )}
            <Link href={`/b/${b.studio_slug}`} style={{ display: "inline-block", marginTop: "0.75rem", fontSize: "0.78rem", color: "#a78bfa", textDecoration: "none", fontWeight: 600 }}>
                לדף הסטודיו ←
            </Link>
        </div>
    );
}
