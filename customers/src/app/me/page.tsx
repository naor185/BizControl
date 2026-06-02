"use client";
import { useState } from "react";
import Link from "next/link";
import { API } from "@/lib/api";

interface Booking {
    id: string;
    studio_name: string;
    studio_slug: string;
    studio_logo: string | null;
    artist_name: string;
    service: string;
    date: string;
    time: string;
    status: string;
    created_at: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
    pending:   { label: "ממתין לאישור", color: "#f59e0b", bg: "rgba(245,158,11,.12)" },
    approved:  { label: "אושר ✅",       color: "#4ade80", bg: "rgba(74,222,128,.1)" },
    scheduled: { label: "מאושר ✅",      color: "#4ade80", bg: "rgba(74,222,128,.1)" },
    done:      { label: "בוצע",          color: "#94a3b8", bg: "rgba(148,163,184,.08)" },
    canceled:  { label: "בוטל",          color: "#f87171", bg: "rgba(248,113,113,.1)" },
    rejected:  { label: "נדחה",          color: "#f87171", bg: "rgba(248,113,113,.1)" },
    no_show:   { label: "לא הגיע",       color: "#f87171", bg: "rgba(248,113,113,.1)" },
};

export default function MePage() {
    const [phone, setPhone] = useState("");
    const [bookings, setBookings] = useState<Booking[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const search = async () => {
        const clean = phone.trim().replace(/[-\s]/g, "");
        if (clean.length < 9) { setErr("הכנס מספר טלפון תקין"); return; }
        setLoading(true); setErr(null); setBookings(null);
        try {
            const res = await fetch(`${API}/api/public/my-bookings?phone=${encodeURIComponent(clean)}`);
            if (!res.ok) throw new Error("שגיאה");
            setBookings(await res.json());
        } catch { setErr("שגיאה בחיפוש. נסה שוב."); }
        finally { setLoading(false); }
    };

    const upcoming = bookings?.filter(b => !["done", "canceled", "rejected", "no_show"].includes(b.status)) ?? [];
    const past = bookings?.filter(b => ["done", "canceled", "rejected", "no_show"].includes(b.status)) ?? [];

    return (
        <div style={{ minHeight: "100vh", paddingBottom: "3rem" }}>
            {/* Header */}
            <div style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)", padding: "2rem 1.25rem 1.5rem" }}>
                <Link href="/" style={{ color: "#a78bfa", textDecoration: "none", fontSize: "0.85rem" }}>← חזרה</Link>
                <h1 style={{ fontSize: "1.6rem", fontWeight: 900, marginTop: "0.5rem" }}>📋 ההזמנות שלי</h1>
                <p style={{ color: "#94a3b8", fontSize: "0.88rem", marginTop: "0.3rem" }}>הכנס מספר טלפון כדי לראות את כל התורים שלך</p>
            </div>

            <div style={{ maxWidth: 600, margin: "2rem auto 0", padding: "0 1.25rem" }}>

                {/* Phone search */}
                <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 20, padding: "1.5rem" }}>
                    <div style={{ marginBottom: "0.75rem" }}>
                        <label style={{ color: "#94a3b8", fontSize: "0.82rem", display: "block", marginBottom: "0.4rem" }}>מספר טלפון</label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && search()}
                            placeholder="050-0000000"
                            dir="ltr"
                            style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "0.75rem 1rem", color: "#fff", fontSize: "1rem", outline: "none" }}
                        />
                    </div>
                    {err && <p style={{ color: "#f87171", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{err}</p>}
                    <button
                        type="button" onClick={search} disabled={loading}
                        style={{ width: "100%", background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 12, color: "#fff", padding: "0.8rem", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer", opacity: loading ? 0.7 : 1 }}
                    >
                        {loading ? "מחפש..." : "🔍 חפש הזמנות"}
                    </button>
                </div>

                {/* Results */}
                {bookings !== null && (
                    <div style={{ marginTop: "2rem" }}>
                        {bookings.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                                <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>📭</div>
                                <div>לא נמצאו הזמנות למספר זה</div>
                            </div>
                        ) : (
                            <>
                                {upcoming.length > 0 && (
                                    <div style={{ marginBottom: "2rem" }}>
                                        <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#e2e8f0", marginBottom: "0.75rem" }}>⏰ הזמנות קרובות ({upcoming.length})</h2>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                            {upcoming.map(b => <BookingCard key={b.id} b={b} />)}
                                        </div>
                                    </div>
                                )}
                                {past.length > 0 && (
                                    <div>
                                        <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#64748b", marginBottom: "0.75rem" }}>📁 היסטוריה ({past.length})</h2>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                            {past.map(b => <BookingCard key={b.id} b={b} />)}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function BookingCard({ b }: { b: Booking }) {
    const st = STATUS_LABEL[b.status] || { label: b.status, color: "#94a3b8", bg: "rgba(148,163,184,.08)" };
    return (
        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: "1rem 1.1rem", display: "flex", gap: "0.9rem", alignItems: "flex-start" }}>
            {/* Studio logo / icon */}
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(167,139,250,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", flexShrink: 0 }}>
                {b.studio_logo ? <img src={b.studio_logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }} /> : "🏪"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.3rem" }}>
                    <Link href={`/b/${b.studio_slug}`} style={{ fontWeight: 700, fontSize: "0.92rem", color: "#e2e8f0", textDecoration: "none" }}>{b.studio_name}</Link>
                    <span style={{ background: st.bg, color: st.color, fontSize: "0.72rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>{st.label}</span>
                </div>
                <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>{b.service}</div>
                <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.25rem", display: "flex", gap: "0.75rem" }}>
                    <span>📅 {b.date}</span>
                    <span>⏰ {b.time}</span>
                    {b.artist_name !== "—" && <span>👤 {b.artist_name}</span>}
                </div>
            </div>
        </div>
    );
}
