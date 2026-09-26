"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { API, apiFetch, imgUrl } from "@/lib/api";
import { getCustomer, saveCustomer, clearCustomer, type Customer } from "@/lib/auth";
import { Bell, Building2, Camera, ChevronLeft, ClipboardList, Clock, Heart, Lock, MapPin, Star, User, X } from "lucide-react";
import AuthModal from "@/components/AuthModal";
import { GLASS_BTN, GLASS_CARD, PRIMARY_BTN } from "@/lib/look";

interface Business {
    client_id: string;
    studio_id: string;
    studio_name: string;
    studio_slug: string;
    logo_url: string | null;
    cover_url: string | null;
    loyalty_points: number;
    is_club_member: boolean;
    visit_count: number;
    photo_count: number;
    last_visit_at: string | null;
}

export default function MePage() {
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [showAuth, setShowAuth] = useState(false);
    const [favorites, setFavorites] = useState<FavStudio[]>([]);
    const [loadingFavs, setLoadingFavs] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [businesses, setBusinesses] = useState<Business[]>([]);
    const [loadingBusinesses, setLoadingBusinesses] = useState(false);
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

        setLoadingBusinesses(true);
        apiFetch<Business[]>("/api/marketplace/auth/my-businesses")
            .then(setBusinesses)
            .catch(() => {})
            .finally(() => setLoadingBusinesses(false));

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
            <div style={{ minHeight: "100vh", background: "var(--bf-bg)", color: "var(--bf-text)" }}>
                <div style={HEADER}>
                    <h1 style={{ fontSize: "1.6rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem" }}><User size={24} aria-hidden /> הפרופיל שלי</h1>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginTop: "0.3rem" }}>התחבר כדי לשמור מועדפים ולעקוב אחר התורים שלך</p>
                </div>

                <div style={{ maxWidth: 480, margin: "3rem auto", padding: "0 1.25rem", textAlign: "center" }}>
                    <div style={{ width: 76, height: 76, borderRadius: "50%", margin: "0 auto 1rem", ...GLASS_CARD, display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={32} strokeWidth={1.6} aria-hidden /></div>
                    <h2 style={{ fontWeight: 800, marginBottom: "0.5rem" }}>התחבר לחשבון שלך</h2>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginBottom: "2rem" }}>
                        ניהול מועדפים, צפייה בהיסטוריית תורים ועוד
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowAuth(true)}
                        style={{ ...PRIMARY_BTN, display: "inline-flex", borderRadius: 16, padding: "0.9rem 2.5rem", fontSize: "1rem" }}
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
        <div style={{ minHeight: "100vh", paddingBottom: "3rem", background: "var(--bf-bg)", color: "var(--bf-text)" }}>
            {/* Header */}
            <div style={HEADER}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                        <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>{customer.full_name || customer.phone}</h1>
                        <p dir="ltr" style={{ color: "var(--bf-muted)", fontSize: "0.85rem", marginTop: "0.25rem", textAlign: "right" }}>{customer.phone}</p>
                        {customer.city && <p style={{ color: "var(--bf-faint)", fontSize: "0.82rem", marginTop: "0.15rem", display: "flex", alignItems: "center", gap: "0.25rem" }}><MapPin size={13} aria-hidden /> {customer.city}</p>}
                    </div>
                    <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", fontWeight: 800, color: "#000" }}>
                        {(customer.first_name?.[0] || customer.phone[0] || "?").toUpperCase()}
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 600, margin: "0 auto", padding: "1.5rem 1.25rem" }}>

                {/* Favorites */}
                <section style={{ marginBottom: "2rem" }}>
                    <h2 style={SECTION_TITLE}>
                        <Heart size={17} aria-hidden /> מועדפים {customer.favorites.length > 0 && `(${customer.favorites.length})`}
                    </h2>

                    {loadingFavs ? (
                        <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem", padding: "1rem 0" }}>טוען...</div>
                    ) : favorites.length === 0 ? (
                        <div style={EMPTY}>
                            <Heart size={28} strokeWidth={1.5} aria-hidden style={{ marginBottom: "0.5rem" }} />
                            <div style={{ fontSize: "0.85rem" }}>עוד לא שמרת מועדפים</div>
                            <Link href="/explore" style={EMPTY_LINK}>גלה עסקים</Link>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                            {favorites.map(s => (
                                <div key={s.slug} style={{ ...ROW, display: "flex", alignItems: "center", gap: "0.8rem" }}>
                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: s.logo_url ? "#fff" : "var(--bf-glass-strong)", overflow: "hidden", flexShrink: 0 }}>
                                        {s.logo_url && <img src={imgUrl(s.logo_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 3 }} />}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{s.name}</div>
                                        <div style={{ color: "var(--bf-muted)", fontSize: "0.78rem" }}>{s.city}</div>
                                    </div>
                                    <div style={{ display: "flex", gap: "0.4rem" }}>
                                        <Link href={`/b/${s.slug}`} style={{ background: "#fff", borderRadius: 10, padding: "0.4rem 0.8rem", color: "#000", fontSize: "0.78rem", fontWeight: 700, textDecoration: "none" }}>
                                            פתח
                                        </Link>
                                        <button type="button" onClick={() => removeFav(s.slug)} aria-label="הסר ממועדפים" style={{ background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 10, padding: "0.4rem 0.55rem", color: "var(--bf-muted)", cursor: "pointer", display: "flex" }}>
                                            <X size={15} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Businesses — receipts, visits, loyalty & photos live per-business now */}
                <section style={{ marginBottom: "2rem" }}>
                    <h2 style={SECTION_TITLE}>
                        <Building2 size={17} aria-hidden /> העסקים שלי {businesses.length > 0 && `(${businesses.length})`}
                    </h2>
                    {loadingBusinesses ? (
                        <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem", padding: "1rem 0" }}>טוען...</div>
                    ) : businesses.length === 0 ? (
                        <div style={EMPTY}>
                            <Building2 size={28} strokeWidth={1.5} aria-hidden style={{ marginBottom: "0.5rem" }} />
                            <div style={{ fontSize: "0.85rem" }}>עוד לא ביקרת באף עסק</div>
                            <Link href="/explore" style={EMPTY_LINK}>גלה עסקים</Link>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                            {businesses.map(b => (
                                <Link key={b.studio_slug} href={`/me/business/${b.studio_slug}`} style={{ ...ROW, display: "flex", alignItems: "center", gap: "0.8rem", textDecoration: "none", color: "var(--bf-text)" }}>
                                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--bf-glass-strong)", overflow: "hidden", flexShrink: 0 }}>
                                        {(b.cover_url || b.logo_url) && <img src={imgUrl(b.cover_url || b.logo_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{b.studio_name}</div>
                                        <div style={{ color: "var(--bf-muted)", fontSize: "0.78rem", marginTop: "0.15rem", display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
                                            {b.visit_count} ביקורים
                                            {b.is_club_member && <><span aria-hidden>·</span><Star size={12} aria-hidden />{b.loyalty_points} נק&apos;</>}
                                            {b.photo_count > 0 && <><span aria-hidden>·</span><Camera size={12} aria-hidden />{b.photo_count}</>}
                                        </div>
                                    </div>
                                    <ChevronLeft size={18} color="var(--bf-faint)" aria-hidden />
                                </Link>
                            ))}
                        </div>
                    )}
                </section>

                {/* Waitlist */}
                {waitlist.length > 0 && (
                    <section style={{ marginBottom: "2rem" }}>
                        <h2 style={SECTION_TITLE}>
                            <ClipboardList size={17} aria-hidden /> רשימת המתנה שלי ({waitlist.length})
                        </h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {waitlist.map(w => (
                                <div key={w.id} style={{ ...ROW, borderRadius: 14, padding: "0.85rem 1rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{w.studio_name}</div>
                                        <span style={{
                                            fontSize: "0.72rem", fontWeight: 700, borderRadius: 8, padding: "0.2rem 0.55rem", display: "inline-flex", alignItems: "center", gap: "0.25rem",
                                            background: w.status === "notified" ? "#fff" : "var(--bf-glass)",
                                            color: w.status === "notified" ? "#000" : "var(--bf-muted)",
                                            border: `1px solid ${w.status === "notified" ? "#fff" : "var(--bf-line)"}`,
                                        }}>
                                            {w.status === "notified" ? <><Bell size={12} aria-hidden /> התפנה מקום!</> : <><Clock size={12} aria-hidden /> ממתין</>}
                                        </span>
                                    </div>
                                    {w.notes && <div style={{ color: "var(--bf-muted)", fontSize: "0.78rem", marginTop: "0.25rem" }}>{w.notes}</div>}
                                    {w.status === "notified" && (
                                        <Link href={`/b/${w.studio_slug}/book`}
                                            style={{ ...PRIMARY_BTN, display: "inline-flex", marginTop: "0.6rem", borderRadius: 10, padding: "0.45rem 1rem", fontSize: "0.8rem" }}>
                                            קבע תור עכשיו
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
                        style={{ ...ROW, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.1rem", textDecoration: "none", color: "var(--bf-text)" }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
                            <ClipboardList size={22} strokeWidth={1.6} aria-hidden />
                            <div>
                                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>ההזמנות שלי</div>
                                <div style={{ color: "var(--bf-muted)", fontSize: "0.78rem" }}>צפה בכל התורים</div>
                            </div>
                        </div>
                        <ChevronLeft size={18} color="var(--bf-faint)" aria-hidden />
                    </a>
                </section>

                {/* Logout */}
                <button
                    type="button"
                    onClick={logout}
                    style={{ ...GLASS_BTN, width: "100%", justifyContent: "center", borderRadius: 16, color: "#f87171", padding: "0.85rem", fontSize: "0.9rem", cursor: "pointer" }}
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

const HEADER: React.CSSProperties = {
    background: "linear-gradient(180deg,#161616 0%,#000 100%)", borderBottom: "1px solid var(--bf-line)", padding: "2rem 1.25rem 1.5rem",
};
const SECTION_TITLE: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "0.45rem", fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem", color: "var(--bf-text)",
};
const ROW: React.CSSProperties = { ...GLASS_CARD, borderRadius: 16, padding: "0.9rem 1rem" };
const EMPTY: React.CSSProperties = { ...GLASS_CARD, borderRadius: 16, padding: "2rem", textAlign: "center", color: "var(--bf-muted)" };
const EMPTY_LINK: React.CSSProperties = { color: "var(--bf-text)", fontSize: "0.82rem", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3, display: "inline-block", marginTop: "0.5rem" };
