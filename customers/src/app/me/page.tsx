"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { API, apiFetch } from "@/lib/api";
import { getCustomer, saveCustomer, clearCustomer, type Customer } from "@/lib/auth";
import AuthModal from "@/components/AuthModal";

interface MyInvoice {
    id: string;
    doc_type: string;
    doc_type_label: string;
    doc_number: number;
    status: string;
    total_ils: number;
    issued_at: string;
    business_name: string;
}

export default function MePage() {
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [showAuth, setShowAuth] = useState(false);
    const [favorites, setFavorites] = useState<FavStudio[]>([]);
    const [loadingFavs, setLoadingFavs] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [invoices, setInvoices] = useState<MyInvoice[]>([]);
    const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);

    useEffect(() => {
        setMounted(true);
        const c = getCustomer();
        setCustomer(c);
    }, []);

    useEffect(() => {
        if (!customer) return;
        setLoadingFavs(true);
        apiFetch<{ id: string; phone: string; favorites: string[] }>("/api/marketplace/auth/me")
            .then(data => {
                const updated = { ...customer, favorites: data.favorites };
                saveCustomer(updated);
                setCustomer(updated);
                if (data.favorites.length > 0) loadFavoriteStudios(data.favorites);
            })
            .catch(() => {})
            .finally(() => setLoadingFavs(false));

        apiFetch<MyInvoice[]>("/api/marketplace/auth/my-invoices")
            .then(setInvoices)
            .catch(() => {});

        apiFetch<WaitlistEntry[]>("/api/marketplace/auth/my-waitlist")
            .then(setWaitlist)
            .catch(() => {});
    }, [customer?.id]);

    const loadFavoriteStudios = async (slugs: string[]) => {
        try {
            const results = await Promise.all(
                slugs.map(s => fetch(`${API}/api/marketplace/${s}`).then(r => r.ok ? r.json() : null))
            );
            setFavorites(results.filter(Boolean));
        } catch {}
    };

    const logout = () => {
        clearCustomer();
        setCustomer(null);
        setFavorites([]);
    };

    const removeFav = async (slug: string) => {
        try {
            await apiFetch(`/api/marketplace/auth/favorites`, {
                method: "POST",
                body: JSON.stringify({ studio_slug: slug }),
            });
            const updated = { ...customer!, favorites: customer!.favorites.filter(s => s !== slug) };
            saveCustomer(updated);
            setCustomer(updated);
            setFavorites(f => f.filter(s => s.slug !== slug));
        } catch {}
    };

    if (!mounted) return null;

    if (!customer) {
        return (
            <div style={{ minHeight: "100vh" }}>
                <div style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)", padding: "2rem 1.25rem 1.5rem" }}>
                    <h1 style={{ fontSize: "1.6rem", fontWeight: 900 }}>👤 הפרופיל שלי</h1>
                    <p style={{ color: "#94a3b8", fontSize: "0.88rem", marginTop: "0.3rem" }}>התחבר כדי לשמור מועדפים ולעקוב אחר התורים שלך</p>
                </div>

                <div style={{ maxWidth: 480, margin: "3rem auto", padding: "0 1.25rem", textAlign: "center" }}>
                    <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🔒</div>
                    <h2 style={{ fontWeight: 800, marginBottom: "0.5rem" }}>התחבר לחשבון שלך</h2>
                    <p style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: "2rem" }}>
                        ניהול מועדפים, צפייה בהיסטוריית תורים ועוד
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowAuth(true)}
                        style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 16, color: "#fff", padding: "0.9rem 2.5rem", fontWeight: 800, fontSize: "1rem", cursor: "pointer" }}
                    >
                        כניסה / הרשמה
                    </button>
                </div>

                {showAuth && (
                    <AuthModal
                        onClose={() => setShowAuth(false)}
                        onSuccess={c => { setCustomer(c); setShowAuth(false); }}
                    />
                )}
            </div>
        );
    }

    return (
        <div style={{ minHeight: "100vh", paddingBottom: "3rem" }}>
            {/* Header */}
            <div style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)", padding: "2rem 1.25rem 1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                        <h1 style={{ fontSize: "1.5rem", fontWeight: 900 }}>{customer.full_name || customer.phone}</h1>
                        <p style={{ color: "#a78bfa", fontSize: "0.85rem", marginTop: "0.25rem" }}>{customer.phone}</p>
                        {customer.city && <p style={{ color: "#64748b", fontSize: "0.82rem", marginTop: "0.15rem" }}>📍 {customer.city}</p>}
                    </div>
                    <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#4c1d95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", fontWeight: 900, color: "#fff" }}>
                        {(customer.first_name?.[0] || customer.phone[0] || "?").toUpperCase()}
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 600, margin: "0 auto", padding: "1.5rem 1.25rem" }}>

                {/* Favorites */}
                <section style={{ marginBottom: "2rem" }}>
                    <h2 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem", color: "#e2e8f0" }}>
                        ❤️ מועדפים {customer.favorites.length > 0 && `(${customer.favorites.length})`}
                    </h2>

                    {loadingFavs ? (
                        <div style={{ color: "#64748b", fontSize: "0.85rem", padding: "1rem 0" }}>טוען...</div>
                    ) : favorites.length === 0 ? (
                        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: "2rem", textAlign: "center", color: "#64748b" }}>
                            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🤍</div>
                            <div style={{ fontSize: "0.85rem" }}>עוד לא שמרת מועדפים</div>
                            <Link href="/explore" style={{ color: "#a78bfa", fontSize: "0.82rem", textDecoration: "none", display: "block", marginTop: "0.5rem" }}>גלה עסקים →</Link>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                            {favorites.map(s => (
                                <div key={s.slug} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: "0.9rem 1rem", display: "flex", alignItems: "center", gap: "0.8rem" }}>
                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: s.primary_color || "#7c3aed", overflow: "hidden", flexShrink: 0 }}>
                                        {s.logo_url && <img src={s.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{s.name}</div>
                                        <div style={{ color: "#64748b", fontSize: "0.78rem" }}>{s.city}</div>
                                    </div>
                                    <div style={{ display: "flex", gap: "0.4rem" }}>
                                        <Link href={`/b/${s.slug}`} style={{ background: "rgba(124,58,237,.2)", border: "1px solid rgba(124,58,237,.3)", borderRadius: 10, padding: "0.4rem 0.75rem", color: "#a78bfa", fontSize: "0.78rem", fontWeight: 700, textDecoration: "none" }}>
                                            פתח
                                        </Link>
                                        <button type="button" onClick={() => removeFav(s.slug)} style={{ background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.2)", borderRadius: 10, padding: "0.4rem 0.6rem", color: "#f87171", fontSize: "0.78rem", cursor: "pointer" }}>
                                            ✕
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Invoices / Receipts */}
                {invoices.length > 0 && (
                    <section style={{ marginBottom: "2rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem", color: "#e2e8f0" }}>
                            🧾 הקבלות שלי ({invoices.length})
                        </h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {invoices.slice(0, 5).map(inv => (
                                <div key={inv.id} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "0.85rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div>
                                        <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>
                                            {inv.doc_type_label} #{inv.doc_number}
                                        </div>
                                        <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                                            {inv.business_name} · {inv.issued_at ? new Date(inv.issued_at).toLocaleDateString("he-IL") : ""}
                                        </div>
                                    </div>
                                    <span style={{ fontWeight: 800, color: "#4ade80", fontSize: "0.9rem" }}>
                                        ₪{inv.total_ils.toFixed(2)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Waitlist */}
                {waitlist.length > 0 && (
                    <section style={{ marginBottom: "2rem" }}>
                        <h2 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem", color: "#e2e8f0" }}>
                            📋 רשימת המתנה שלי ({waitlist.length})
                        </h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {waitlist.map(w => (
                                <div key={w.id} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "0.85rem 1rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{w.studio_name}</div>
                                        <span style={{
                                            fontSize: "0.72rem", fontWeight: 700, borderRadius: 8, padding: "0.2rem 0.55rem",
                                            background: w.status === "notified" ? "rgba(251,191,36,.15)" : "rgba(148,163,184,.1)",
                                            color: w.status === "notified" ? "#fbbf24" : "#94a3b8",
                                            border: `1px solid ${w.status === "notified" ? "rgba(251,191,36,.3)" : "rgba(148,163,184,.2)"}`,
                                        }}>
                                            {w.status === "notified" ? "🔔 התפנה מקום!" : "⏳ ממתין"}
                                        </span>
                                    </div>
                                    {w.notes && <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.25rem" }}>{w.notes}</div>}
                                    {w.status === "notified" && (
                                        <Link href={`/b/${w.studio_slug}/book`}
                                            style={{ display: "inline-block", marginTop: "0.6rem", background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff", borderRadius: 10, padding: "0.45rem 1rem", fontSize: "0.8rem", fontWeight: 700, textDecoration: "none" }}>
                                            קבע תור עכשיו →
                                        </Link>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* My bookings link */}
                <section style={{ marginBottom: "2rem" }}>
                    <a
                        href={`/me/bookings?phone=${encodeURIComponent(customer.phone)}`}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: "1rem 1.1rem", textDecoration: "none" }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
                            <span style={{ fontSize: "1.3rem" }}>📋</span>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>ההזמנות שלי</div>
                                <div style={{ color: "#64748b", fontSize: "0.78rem" }}>צפה בכל התורים</div>
                            </div>
                        </div>
                        <span style={{ color: "#64748b" }}>←</span>
                    </a>
                </section>

                {/* Logout */}
                <button
                    type="button"
                    onClick={logout}
                    style={{ width: "100%", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.2)", borderRadius: 16, color: "#f87171", padding: "0.85rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}
                >
                    התנתק
                </button>
            </div>
        </div>
    );
}

interface FavStudio {
    slug: string; name: string; city?: string; logo_url?: string; primary_color: string;
}

interface WaitlistEntry {
    id: string; status: string; studio_name: string; studio_slug: string;
    notes: string | null; created_at: string | null; notified_at: string | null;
}
