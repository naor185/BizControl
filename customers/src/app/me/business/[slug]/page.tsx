"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API, apiFetch, imgUrl, getToken } from "@/lib/api";
import { ArrowRight, Building2, CalendarDays, Camera, ChevronLeft, ExternalLink, LogIn, Receipt as ReceiptIcon } from "lucide-react";
import { GLASS_CARD, PRIMARY_BTN } from "@/lib/look";
import { type Mine, whenText } from "@/lib/classes";
import BookingCard, { type Booking, isUpcoming } from "@/components/BookingCard";

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
    apple_wallet_url: string | null;
    google_wallet_url: string | null;
}

interface Receipt {
    id: string;
    doc_type: string;
    doc_type_label: string;
    doc_number: number;
    status: string;
    total_ils: number;
    issued_at: string;
}

interface Photo {
    id: string;
    photo_url: string;
    caption: string | null;
    created_at: string;
}

export default function BusinessDetailPage() {
    const raw = (useParams() as { slug: string }).slug;
    const slug = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();   // a Hebrew address arrives encoded
    const [business, setBusiness] = useState<Business | null>(null);
    const [receipts, setReceipts] = useState<Receipt[] | null>([]);      // null: couldn't load — the rest still shows
    const [photos, setPhotos] = useState<Photo[] | null>([]);
    const [upcoming, setUpcoming] = useState<Booking[] | null>(null);    // the client's next appointments here
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [signedOut, setSignedOut] = useState(false);
    const [downloadingPass, setDownloadingPass] = useState(false);
    const [classes, setClasses] = useState<Mine | null>(null);   // only when the business takes class bookings

    const downloadAppleWallet = async (url: string) => {
        setDownloadingPass(true);
        try {
            const token = getToken();
            const fullUrl = url.startsWith("http") ? url : `${API}${url}`;
            // Pre-flight with the auth header so failures surface a real error
            // message instead of a broken navigation to a JSON error page.
            const res = await fetch(fullUrl, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            // Real navigation (not fetch+blob) — iOS Safari only offers its
            // native "Add to Apple Wallet" screen when it loads a .pkpass URL
            // directly, so the auth token has to travel as a query param here.
            const sep = fullUrl.includes("?") ? "&" : "?";
            window.location.href = `${fullUrl}${sep}token=${encodeURIComponent(token || "")}`;
        } catch (e: any) {
            alert(e?.message || "שגיאה בהורדת הכרטיס ל-Apple Wallet");
        } finally {
            setDownloadingPass(false);
        }
    };

    useEffect(() => {
        if (!slug) return;
        if (!getToken()) { setSignedOut(true); setLoading(false); return; }
        setLoading(true);
        // Each part on its own — receipts that fail to load don't hide the appointments (owner, 2026-10-13: the whole
        // page showed "שגיאה בטעינת הנתונים"); a login that ended asks to sign in again (lib/api.apiFetch).
        apiFetch<Business[]>("/api/marketplace/auth/my-businesses")
            .then(businesses => {
                const b = businesses.find(x => x.studio_slug === slug);
                if (b) setBusiness(b); else setError("העסק לא נמצא ברשימת העסקים שלך");
            })
            .catch((e: Error) => { if (!getToken()) setSignedOut(true); else setError(e.message || "שגיאה בטעינת הנתונים"); })
            .finally(() => setLoading(false));
        apiFetch<Booking[]>("/api/marketplace/auth/my-bookings")
            .then(all => setUpcoming(all.filter(b => b.studio_slug === slug && isUpcoming(b)).reverse()))
            .catch(() => setUpcoming(null));
        apiFetch<Receipt[]>(`/api/marketplace/auth/my-invoices?studio_slug=${encodeURIComponent(slug)}`).then(setReceipts).catch(() => setReceipts(null));
        apiFetch<Photo[]>(`/api/marketplace/auth/my-photos?studio_slug=${encodeURIComponent(slug)}`).then(setPhotos).catch(() => setPhotos(null));
        apiFetch<Mine>(`/api/marketplace/classes/${encodeURIComponent(slug)}/mine`).then(setClasses).catch(() => setClasses(null));
    }, [slug]);

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "var(--bf-bg)", color: "var(--bf-text)", padding: "1.5rem 1rem 5rem" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
                <Link href="/me" aria-label="חזרה" style={{ color: "var(--bf-muted)", textDecoration: "none", display: "flex" }}><ArrowRight size={20} /></Link>
                <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: "0.45rem" }}><Building2 size={20} aria-hidden /> {business?.studio_name || "העסק"}</h1>
            </div>

            {loading && (
                <div style={{ textAlign: "center", padding: "3rem", color: "var(--bf-muted)" }}>
                    <div style={{ width: 36, height: 36, border: "3px solid rgba(255,255,255,.18)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 1rem" }} />
                    טוען...
                </div>
            )}

            {error && !loading && (
                <div style={{ textAlign: "center", padding: "3rem", color: "#f87171" }}>{error}</div>
            )}

            {signedOut && !loading && (
                <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
                    <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>החיבור שלך ל-BizFind הסתיים</div>
                    <div style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginBottom: "1.25rem" }}>התחברו מחדש כדי לראות את התורים, הקבלות והתמונות שלכם.</div>
                    <Link href="/me" style={{ ...PRIMARY_BTN, display: "inline-flex", borderRadius: 12, padding: "0.7rem 1.5rem", fontSize: "0.92rem" }}>
                        <LogIn size={16} aria-hidden /> להתחברות
                    </Link>
                </div>
            )}

            {!loading && !error && business && (
                <>
                    {/* Business identity */}
                    <div style={{ ...GLASS_CARD, borderRadius: 16, padding: "1.1rem", display: "flex", alignItems: "center", gap: "0.9rem", marginBottom: "2rem" }}>
                        <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--bf-glass-strong)", overflow: "hidden", flexShrink: 0 }}>
                            {(business.cover_url || business.logo_url) && (
                                <img src={imgUrl(business.cover_url || business.logo_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{business.studio_name}</div>
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.8rem", marginTop: "0.2rem" }}>{business.visit_count} ביקורים</div>
                        </div>
                        {business.is_club_member && (
                            <div style={{ textAlign: "center", background: "#fff", borderRadius: 12, padding: "0.4rem 0.7rem" }}>
                                <div style={{ fontWeight: 800, fontSize: "1rem", color: "#000" }}>{business.loyalty_points}</div>
                                <div style={{ fontSize: "0.65rem", color: "#444" }}>נקודות</div>
                            </div>
                        )}
                        <Link href={`/b/${business.studio_slug}`} aria-label="לדף העסק" style={{ color: "var(--bf-muted)", textDecoration: "none", display: "flex" }}><ExternalLink size={18} /></Link>
                    </div>

                    {/* My next appointments here — what a reminder's notification opens this page for */}
                    <section style={{ marginBottom: "2rem" }}>
                        <h2 style={SECTION}><CalendarDays size={14} aria-hidden /> התורים שלי {upcoming && upcoming.length > 0 && `(${upcoming.length})`}</h2>
                        {upcoming === null ? (
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem" }}>לא הצלחנו לטעון את התורים — <Link href="/me/bookings" style={{ fontWeight: 700 }}>לכל ההזמנות שלי</Link></div>
                        ) : upcoming.length === 0 ? (
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem" }}>אין תורים קרובים · <Link href={`/b/${business.studio_slug}`} style={{ fontWeight: 700 }}>לדף העסק</Link></div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                {upcoming.map(b => <BookingCard key={b.id} b={b} withBusinessLink={false} />)}
                            </div>
                        )}
                    </section>

                    {/* Add to Wallet — only for active club members, only when the
                        studio actually has a URL (Apple/Google configured deployment-wide) */}
                    {business.is_club_member && (business.apple_wallet_url || business.google_wallet_url) && (
                        <div style={{ display: "flex", gap: "0.6rem", marginBottom: "2rem" }}>
                            {business.apple_wallet_url && (
                                <button
                                    type="button"
                                    onClick={() => downloadAppleWallet(business.apple_wallet_url!)}
                                    disabled={downloadingPass}
                                    style={{ flex: 1, background: "#000", color: "#fff", border: "1px solid var(--bf-line)", borderRadius: 12, padding: "0.75rem", fontWeight: 700, fontSize: "0.85rem", cursor: downloadingPass ? "not-allowed" : "pointer", opacity: downloadingPass ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
                                >
                                    <span></span> {downloadingPass ? "טוען..." : "הוסף ל-Apple Wallet"}
                                </button>
                            )}
                            {business.google_wallet_url && (
                                <a
                                    href={business.google_wallet_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ flex: 1, background: "#1a73e8", color: "#fff", borderRadius: 12, padding: "0.75rem", fontWeight: 700, fontSize: "0.85rem", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
                                >
                                    <span>G</span> הוסף ל-Google Wallet
                                </a>
                            )}
                        </div>
                    )}

                    {/* Group classes: my membership and my next class */}
                    {classes && classes.is_client && (
                        <Link href={`/b/${business.studio_slug}/classes`}
                            style={{ ...GLASS_CARD, borderRadius: 16, padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "2rem", color: "inherit", textDecoration: "none" }}>
                            <CalendarDays size={24} color="#fff" style={{ flexShrink: 0 }} aria-hidden />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 800 }}>
                                    שיעורים{classes.memberships[0] ? ` · ${classes.memberships[0].name}` : ""}
                                    {classes.memberships[0]?.entries_left != null ? ` · נותרו ${classes.memberships[0].entries_left}` : ""}
                                </div>
                                <div style={{ color: "var(--bf-muted)", fontSize: "0.8rem", marginTop: 2 }}>
                                    {classes.upcoming[0] ? `הבא: ${classes.upcoming[0].name}, ${whenText(classes.upcoming[0].starts_at)}` : "לוח השיעורים והרשמה"}
                                </div>
                            </div>
                            <ChevronLeft size={20} color="var(--bf-faint)" aria-hidden />
                        </Link>
                    )}

                    {/* Receipts */}
                    <section style={{ marginBottom: "2rem" }}>
                        <h2 style={SECTION}>
                            <ReceiptIcon size={14} aria-hidden /> קבלות {receipts && receipts.length > 0 && `(${receipts.length})`}
                        </h2>
                        {receipts === null ? (
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>לא הצלחנו לטעון את הקבלות</div>
                        ) : receipts.length === 0 ? (
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>אין קבלות עדיין</div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                {receipts.map(inv => (
                                    <button
                                        key={inv.id}
                                        type="button"
                                        onClick={() => window.open(`${API}/receipt/${inv.id}`, "_blank")}
                                        style={{ ...GLASS_CARD, borderRadius: 14, padding: "0.85rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "right", width: "100%" }}
                                    >
                                        <div>
                                            <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--bf-text)" }}>{inv.doc_type_label} #{inv.doc_number}</div>
                                            <div style={{ color: "var(--bf-faint)", fontSize: "0.75rem" }}>{inv.issued_at ? new Date(inv.issued_at).toLocaleDateString("he-IL") : ""}</div>
                                        </div>
                                        <span style={{ fontWeight: 800, color: "var(--bf-text)", fontSize: "0.92rem", fontVariantNumeric: "tabular-nums" }}>₪{inv.total_ils.toFixed(2)}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Treatment photos */}
                    <section>
                        <h2 style={SECTION}>
                            <Camera size={14} aria-hidden /> תמונות טיפול {photos && photos.length > 0 && `(${photos.length})`}
                        </h2>
                        {photos === null ? (
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>לא הצלחנו לטעון את התמונות</div>
                        ) : photos.length === 0 ? (
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>אין תמונות עדיין</div>
                        ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem" }}>
                                {photos.map(p => (
                                    <a key={p.id} href={imgUrl(p.photo_url)} target="_blank" rel="noopener noreferrer" style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", background: "#111", display: "block" }}>
                                        <img src={imgUrl(p.photo_url)} alt={p.caption || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    </a>
                                ))}
                            </div>
                        )}
                    </section>
                </>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

const SECTION: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", fontWeight: 700, color: "var(--bf-faint)", letterSpacing: "0.06em", marginBottom: "0.75rem",
};
