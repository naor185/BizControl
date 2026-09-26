"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API, imgUrl } from "@/lib/api";
import { setStudioToken, goToBizControl } from "@/lib/handoff";
import BusinessTypeIcon from "@/components/BusinessTypeIcon";
import { GLASS_BTN, GLASS_CARD, OPTION_STYLE, PRIMARY_BTN } from "@/lib/look";
import { ArrowRight, BookOpen, CalendarDays, Camera, Check, ClipboardList, Clock, Images, MapPin, MessageCircle,
         Navigation, PartyPopper, PenLine, Phone, Send, Share2, Star, Users, type LucideIcon } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Profile {
    slug: string; name: string; business_type_label: string; business_type_icon: string;
    logo_url?: string; cover_url?: string; primary_color: string;
    description?: string; city?: string; address?: string; map_link?: string;
    phone?: string; whatsapp?: string; instagram?: string; hours?: string;
    portfolio_link?: string; review_link_google?: string;
    self_booking_enabled: boolean;
    has_classes?: boolean;          // clients book the business's group classes here (with their membership)
    services: { id: string; name: string; duration_minutes: number; price_ils: number; color: string; description?: string; is_bookable_online: boolean }[];
    artists: { id: string; name: string }[];
    reviews: { id: string; client_name: string; rating: number; comment?: string; created_at: string }[];
    avg_rating?: number; review_count: number;
    gallery: string[];
    is_claimed?: boolean;
    business_id?: string;
    google_reviews?: { author?: string; rating?: number; text?: string; relative_time?: string }[];
}

type Day = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
interface DayHours { open: string; close: string; closed: boolean; }
type Hours = Record<Day, DayHours>;

const DAYS: Day[] = ["sun","mon","tue","wed","thu","fri","sat"];
const DAY_LABELS: Record<Day, string> = { sun:"ראשון", mon:"שני", tue:"שלישי", wed:"רביעי", thu:"חמישי", fri:"שישי", sat:"שבת" };

function dur(m: number) {
    if (m <= 0) return "";
    return m < 60 ? `${m} דק׳` : m % 60 === 0 ? `${m / 60} שע׳` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} שע׳`;
}

function isOpenNow(hours: Hours): { open: boolean; label: string } {
    const now = new Date();
    const dayIndex = now.getDay();
    const dayKey = DAYS[dayIndex];
    const day = hours[dayKey];
    if (!day || day.closed) return { open: false, label: "סגור כעת" };
    const [oh, om] = day.open.split(":").map(Number);
    const [ch, cm] = day.close.split(":").map(Number);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const openMin = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    if (nowMin >= openMin && nowMin < closeMin) return { open: true, label: `פתוח · סוגר ${day.close}` };
    if (nowMin < openMin) return { open: false, label: `נפתח ב-${day.open}` };
    return { open: false, label: "סגור כעת" };
}

// ── Claim banner (unclaimed BizFind imports only) ───────────────────────────

type ClaimStep = "closed" | "otp_sent" | "otp_verified" | "done";

const claimInputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid rgba(255,255,255,.16)", borderRadius: 10,
    padding: "0.6rem 0.85rem", fontSize: "0.9rem", outline: "none",
    color: "#fff", background: "rgba(255,255,255,.07)", boxSizing: "border-box", colorScheme: "dark",
};

function ClaimBanner({ businessId, phone }: { businessId: string; phone?: string }) {
    const [step, setStep] = useState<ClaimStep>("closed");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [otpCode, setOtpCode] = useState("");
    const [claimToken, setClaimToken] = useState("");
    const [ownerName, setOwnerName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const startClaim = async () => {
        setLoading(true); setErr(null);
        try {
            const res = await fetch(`${API}/api/businesses/${businessId}/claim/request-otp`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "שגיאה בשליחת קוד");
            setStep("otp_sent");
        } catch (e: unknown) { setErr(e instanceof Error ? e.message : "שגיאה בשליחת קוד"); }
        finally { setLoading(false); }
    };

    const verifyOtp = async () => {
        setLoading(true); setErr(null);
        try {
            const res = await fetch(`${API}/api/businesses/${businessId}/claim/verify-otp`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: otpCode.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "קוד שגוי");
            setClaimToken(data.claim_token);
            setStep("otp_verified");
        } catch (e: unknown) { setErr(e instanceof Error ? e.message : "קוד שגוי"); }
        finally { setLoading(false); }
    };

    const completeClaim = async () => {
        setLoading(true); setErr(null);
        try {
            const res = await fetch(`${API}/api/businesses/${businessId}/claim/complete`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ claim_token: claimToken, owner_name: ownerName.trim(), email: email.trim(), password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "שגיאה ביצירת החשבון");
            setStudioToken(data.access_token);
            setStep("done");
        } catch (e: unknown) { setErr(e instanceof Error ? e.message : "שגיאה ביצירת החשבון"); }
        finally { setLoading(false); }
    };

    if (step === "closed") {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 12, padding: "0.65rem 1rem", marginBottom: "1.25rem" }}>
                <span style={{ fontSize: "0.82rem", color: "var(--bf-text)", fontWeight: 600 }}>זה העסק שלך? צור קשר לקבל גישה לניהול ושיווק העסק שלך</span>
                <button type="button" onClick={startClaim} disabled={loading || !phone}
                    style={{ background: "#fff", color: "#000", border: "none", borderRadius: 9, padding: "0.4rem 0.9rem", fontWeight: 700, fontSize: "0.78rem", cursor: phone ? "pointer" : "not-allowed", opacity: loading ? 0.7 : 1, whiteSpace: "nowrap" }}>
                    {loading ? "..." : "צור קשר →"}
                </button>
            </div>
        );
    }

    return (
        <div style={{ background: "#0c0c0c", border: "1px solid var(--bf-line)", color: "var(--bf-text)", borderRadius: 14, padding: "1.1rem", marginBottom: "1.25rem" }}>
            {step === "otp_sent" && (
                <>
                    <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: "0.3rem" }}>הזן את הקוד שקיבלת</div>
                    <p style={{ color: "var(--bf-muted)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>שלחנו קוד אימות ל-{phone}.</p>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                        <input value={otpCode} onChange={e => setOtpCode(e.target.value)} maxLength={6} dir="ltr" style={{ ...claimInputStyle, textAlign: "center", letterSpacing: "0.25em" }} />
                        <button type="button" onClick={verifyOtp} disabled={loading || otpCode.trim().length < 4}
                            style={{ background: "#fff", color: "#000", border: "none", borderRadius: 10, padding: "0 1.1rem", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", opacity: loading ? 0.7 : 1, whiteSpace: "nowrap" }}>
                            {loading ? "מאמת..." : "אמת"}
                        </button>
                    </div>
                </>
            )}
            {step === "otp_verified" && (
                <>
                    <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: "0.75rem" }}>כמעט סיימנו — פרטי הכניסה שלך</div>
                    <div style={{ display: "grid", gap: "0.5rem", marginBottom: "0.75rem" }}>
                        <input placeholder="שם מלא" value={ownerName} onChange={e => setOwnerName(e.target.value)} style={claimInputStyle} />
                        <input type="email" placeholder="אימייל" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" style={claimInputStyle} />
                        <input type="password" placeholder="סיסמה" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" style={claimInputStyle} />
                    </div>
                    <button type="button" onClick={completeClaim}
                        disabled={loading || ownerName.trim().length < 2 || !email.trim() || password.length < 6}
                        style={{ width: "100%", background: "#fff", color: "#000", border: "none", borderRadius: 10, padding: "0.65rem", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", opacity: loading ? 0.7 : 1 }}>
                        {loading ? "יוצר חשבון..." : "סיים והתחל לנהל"}
                    </button>
                </>
            )}
            {step === "done" && (
                <div style={{ textAlign: "center" }}>
                    <PartyPopper size={34} strokeWidth={1.5} aria-hidden style={{ marginBottom: "0.3rem" }} />
                    <div style={{ fontWeight: 800, marginBottom: "0.75rem" }}>העסק שלך אומת!</div>
                    <button type="button" onClick={() => goToBizControl("/onboarding")}
                        style={{ width: "100%", background: "#fff", color: "#000", border: "none", borderRadius: 10, padding: "0.65rem", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer" }}>
                        נהל את העסק שלך עכשיו →
                    </button>
                </div>
            )}
            {err && <div style={{ color: "#f87171", fontSize: "0.78rem", marginTop: "0.6rem", fontWeight: 600 }}>{err}</div>}
        </div>
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function BusinessPage() {
    const { slug } = useParams() as { slug: string };
    const [p, setP] = useState<Profile | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<{ url: string; index: number } | null>(null);
    const [showReview, setShowReview] = useState(false);
    const [reviewForm, setReviewForm] = useState({ client_name: "", rating: 5, comment: "" });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [reviewError, setReviewError] = useState("");
    const [activeTab, setActiveTab] = useState<"about" | "services" | "gallery" | "reviews">("about");
    const [showRequestModal, setShowRequestModal] = useState(false);

    useEffect(() => {
        fetch(`${API}/api/marketplace/${slug}`)
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(setP)
            .catch(status => setErr(status === 410 ? "העסק אינו זמין להזמנות כרגע — האתר שלו בארכיון. הוא יחזור לפעול ברגע שהעסק יחדש את המנוי." : "העסק לא נמצא"));
        // Track page view (fire-and-forget)
        fetch(`${API}/api/marketplace/${slug}/view`, { method: "POST" }).catch(() => {});
    }, [slug]);

    const submitReview = async () => {
        if (!reviewForm.client_name) return;
        setSubmitting(true);
        setReviewError("");
        try {
            const res = await fetch(`${API}/api/marketplace/${slug}/reviews`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(reviewForm),
            });
            if (!res.ok) {                   // say so — a failed review must not look sent
                setReviewError(res.status === 429 ? "יותר מדי ניסיונות — נסו שוב בעוד כמה דקות." : "הביקורת לא נשלחה. נסו שוב.");
                return;
            }
            setSubmitted(true); setShowReview(false);
        } catch {
            setReviewError("אין חיבור — הביקורת לא נשלחה. נסו שוב.");
        } finally { setSubmitting(false); }
    };

    const navLightbox = (dir: 1 | -1) => {
        if (!lightbox || !p) return;
        const next = lightbox.index + dir;
        if (next >= 0 && next < p.gallery.length)
            setLightbox({ url: imgUrl(p.gallery[next]), index: next });
    };

    if (!p && !err) return (
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bf-bg)" }}>
            <div style={{ width: 44, height: 44, border: "3px solid rgba(255,255,255,.18)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        </div>
    );
    if (err) return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "0 1.5rem", textAlign: "center", background: "var(--bf-bg)", color: "var(--bf-text)" }}>
            <div style={{ fontWeight: 700, maxWidth: 420, lineHeight: 1.6 }}>{err}</div>
            <Link href="/" style={{ ...GLASS_BTN, fontSize: "0.88rem" }}><ArrowRight size={15} aria-hidden /> חזרה לחיפוש</Link>
        </div>
    );

    let hours: Hours | null = null;
    if (p!.hours) { try { hours = JSON.parse(p!.hours); } catch {} }
    const openStatus = hours ? isOpenNow(hours) : null;
    const bookableServices = p!.services.filter(s => s.is_bookable_online);
    const hasGallery = p!.gallery.length > 0;

    return (
        <>
        <div dir="rtl" style={{ minHeight: "100vh", background: "var(--bf-bg)", color: "var(--bf-text)" }}>

            {/* ── Lightbox ── */}
            {lightbox && (
                <div onClick={() => setLightbox(null)}
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.95)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <button onClick={e => { e.stopPropagation(); navLightbox(-1); }}
                        style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.12)", border: "none", color: "#fff", fontSize: "1.5rem", width: 44, height: 44, borderRadius: "50%", cursor: "pointer" }}>›</button>
                    <img src={lightbox.url} alt="" onClick={e => e.stopPropagation()}
                        style={{ maxWidth: "88vw", maxHeight: "88vh", borderRadius: 16, objectFit: "contain", boxShadow: "0 20px 60px rgba(0,0,0,.6)" }} />
                    <button onClick={e => { e.stopPropagation(); navLightbox(1); }}
                        style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.12)", border: "none", color: "#fff", fontSize: "1.5rem", width: 44, height: 44, borderRadius: "50%", cursor: "pointer" }}>‹</button>
                    <button onClick={() => setLightbox(null)}
                        style={{ position: "absolute", top: 16, left: 16, background: "rgba(255,255,255,.12)", border: "none", color: "#fff", fontSize: "1.1rem", width: 36, height: 36, borderRadius: "50%", cursor: "pointer" }}>✕</button>
                    <div style={{ position: "absolute", bottom: 16, color: "rgba(255,255,255,.5)", fontSize: "0.8rem" }}>{lightbox.index + 1} / {p!.gallery.length}</div>
                </div>
            )}

            {/* ── Hero ── */}
            <div style={{ position: "relative", height: 320, overflow: "hidden" }}>
                {p!.cover_url ? (
                    <img src={imgUrl(p!.cover_url)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 70% 15%, #2b2b2b 0%, #0b0b0b 55%, #000 100%)" }} />
                )}
                {/* The cover fades into the black page — the logo and name sit on its lower edge */}
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,rgba(0,0,0,.05) 0%,rgba(0,0,0,.4) 50%,rgba(0,0,0,.88) 85%,#000 100%)" }} />

                {/* Back */}
                <Link href="/" style={{ ...HERO_BTN, right: 14 }}>
                    <ArrowRight size={15} aria-hidden /> חזרה
                </Link>

                {/* Share */}
                <button type="button" onClick={() => navigator.share?.({ title: p!.name, url: window.location.href })}
                    style={{ ...HERO_BTN, left: 14, cursor: "pointer" }}>
                    <Share2 size={15} aria-hidden /> שתף
                </button>

                {/* Gallery preview strip (bottom of hero) */}
                {hasGallery && (
                    <div style={{ position: "absolute", bottom: 60, left: 0, right: 0, padding: "0 1rem", display: "flex", justifyContent: "flex-end", gap: "0.4rem", overflowX: "hidden" }}>
                        {p!.gallery.slice(0, 5).map((url, i) => (
                            <div key={i} onClick={() => setLightbox({ url: imgUrl(url), index: i })}
                                style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,.35)", cursor: "zoom-in" }}>
                                <img src={imgUrl(url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            </div>
                        ))}
                        {p!.gallery.length > 5 && (
                            <button type="button" onClick={() => setActiveTab("gallery")}
                                style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 12, border: "1px solid rgba(255,255,255,.35)", background: "rgba(0,0,0,.55)", color: "#fff", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", backdropFilter: "blur(6px)" }}>
                                +{p!.gallery.length - 5}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── Main content ── */}
            <div style={{ maxWidth: 840, margin: "0 auto", padding: "0 1.25rem 6rem" }}>

                {/* ── Identity: the business's logo on the cover's lower edge ── */}
                <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", marginTop: -48, marginBottom: "1.4rem", position: "relative", zIndex: 2 }}>
                    {p!.logo_url ? (
                        <div style={{ width: 96, height: 96, flexShrink: 0, borderRadius: 24, background: "#fff", padding: 7, border: "1px solid var(--bf-line)", boxShadow: "0 14px 36px rgba(0,0,0,.7)" }}>
                            <img src={imgUrl(p!.logo_url)} alt={`הלוגו של ${p!.name}`} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 17, display: "block" }} />
                        </div>
                    ) : (
                        <div style={{ width: 96, height: 96, flexShrink: 0, borderRadius: 24, background: "rgba(0,0,0,.55)", backdropFilter: "blur(10px)", border: "1px solid var(--bf-line)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <BusinessTypeIcon name={p!.business_type_icon} size={42} color="#fff" strokeWidth={1.4} />
                        </div>
                    )}

                    <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
                        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--bf-text)", margin: "0 0 0.35rem", lineHeight: 1.15, overflowWrap: "anywhere" }}>{p!.name}</h1>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "center", fontSize: "0.82rem", color: "var(--bf-muted)" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}><BusinessTypeIcon name={p!.business_type_icon} size={14} /> {p!.business_type_label}</span>
                            {p!.city && <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><MapPin size={14} aria-hidden /> {p!.city}</span>}
                            {openStatus && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: 20, background: "var(--bf-glass)", border: "1px solid var(--bf-line)", color: "var(--bf-text)" }}>
                                    <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: openStatus.open ? "#4ade80" : "#f87171" }} />
                                    {openStatus.label}
                                </span>
                            )}
                        </div>
                        {p!.avg_rating != null && p!.review_count > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.4rem" }}>
                                <span style={{ color: "#fbbf24", letterSpacing: 1 }}>{"★".repeat(Math.round(p!.avg_rating))}</span>
                                <span style={{ color: "var(--bf-text)", fontWeight: 700, fontSize: "0.85rem" }}>{p!.avg_rating.toFixed(1)}</span>
                                <span style={{ color: "var(--bf-faint)", fontSize: "0.78rem" }}>({p!.review_count} ביקורות)</span>
                            </div>
                        )}
                    </div>
                </div>

                {p!.is_claimed === false && p!.business_id && <ClaimBanner businessId={p!.business_id} phone={p!.phone} />}

                {/* ── CTA buttons ── */}
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
                    {p!.is_claimed !== false && (p!.self_booking_enabled ? (
                        <Link href={`/b/${slug}/book`} style={PRIMARY_BTN}>
                            <CalendarDays size={17} aria-hidden /> קביעת תור
                        </Link>
                    ) : (
                        <button type="button" onClick={() => setShowRequestModal(true)} style={PRIMARY_BTN}>
                            <ClipboardList size={17} aria-hidden /> בקש תור
                        </button>
                    ))}
                    {p!.has_classes && (
                        <Link href={`/b/${slug}/classes`} style={GLASS_BTN}>
                            <Users size={17} aria-hidden /> שיעורים
                        </Link>
                    )}
                    {p!.whatsapp && (
                        <a href={`https://wa.me/${p!.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener" style={GLASS_BTN}>
                            <MessageCircle size={17} color="#25d366" aria-hidden /> WhatsApp
                        </a>
                    )}
                    {p!.phone && (
                        <a href={`tel:${p!.phone}`} style={GLASS_BTN}>
                            <Phone size={16} aria-hidden /> התקשר
                        </a>
                    )}
                    {p!.map_link && (
                        <a href={p!.map_link} target="_blank" rel="noopener" style={GLASS_BTN}>
                            <Navigation size={16} aria-hidden /> ניווט
                        </a>
                    )}
                    {p!.instagram && (
                        <a href={p!.instagram} target="_blank" rel="noopener" style={GLASS_BTN}>
                            <Camera size={16} aria-hidden /> Instagram
                        </a>
                    )}
                    {p!.portfolio_link && (
                        <a href={p!.portfolio_link} target="_blank" rel="noopener" style={GLASS_BTN}>
                            <Images size={16} aria-hidden /> תיק עבודות
                        </a>
                    )}
                </div>

                {/* ── Tabs ── */}
                <div style={{ display: "flex", gap: "0.25rem", background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 16, padding: "0.3rem", marginBottom: "1.5rem", overflowX: "auto" }}>
                    {([
                        ["about",    "אודות"],
                        ...(p!.is_claimed !== false ? [["services", `שירותים${p!.services.length > 0 ? ` (${p!.services.length})` : ""}`]] as const : []),
                        ...(hasGallery ? [["gallery", `גלריה (${p!.gallery.length})`]] as const : []),
                        ...(p!.is_claimed !== false ? [["reviews", `ביקורות${p!.review_count > 0 ? ` (${p!.review_count})` : ""}`]] as const : []),
                    ] as [string, string][]).map(([id, label]) => (
                        <button key={id} type="button" onClick={() => setActiveTab(id as any)}
                            style={{ flex: "1 0 auto", padding: "0.55rem 1rem", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.84rem", whiteSpace: "nowrap", transition: "background .15s, color .15s", background: activeTab === id ? "#fff" : "transparent", color: activeTab === id ? "#000" : "var(--bf-muted)" }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── Tab: About ── */}
                {activeTab === "about" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        {/* Description */}
                        {p!.description && (
                            <Card>
                                <SectionTitle icon={BookOpen}>אודות</SectionTitle>
                                <p style={{ color: "var(--bf-muted)", lineHeight: 1.8, fontSize: "0.92rem", margin: 0 }}>{p!.description}</p>
                            </Card>
                        )}

                        {/* Address */}
                        {p!.address && (
                            <Card>
                                <SectionTitle icon={MapPin}>כתובת</SectionTitle>
                                <div style={{ color: "var(--bf-muted)", fontSize: "0.9rem", marginBottom: "0.6rem" }}>{p!.address}</div>
                                {p!.map_link && (
                                    <a href={p!.map_link} target="_blank" rel="noopener"
                                        style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--bf-text)", fontSize: "0.84rem", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3 }}>
                                        פתח ב-Google Maps ↗
                                    </a>
                                )}
                            </Card>
                        )}

                        {/* Google reviews (unclaimed businesses only — pulled live, not stored) */}
                        {p!.google_reviews && p!.google_reviews.length > 0 && (
                            <Card>
                                <SectionTitle icon={Star}>ביקורות מגוגל</SectionTitle>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                                    {p!.google_reviews.map((r, i) => (
                                        <div key={i} style={{ paddingBottom: i < p!.google_reviews!.length - 1 ? "0.75rem" : 0, borderBottom: i < p!.google_reviews!.length - 1 ? "1px solid var(--bf-line)" : "none" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                                                <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--bf-text)" }}>{r.author || "משתמש גוגל"}</span>
                                                <span style={{ fontSize: "0.72rem", color: "var(--bf-faint)" }}>{r.relative_time}</span>
                                            </div>
                                            {r.rating != null && <div style={{ color: "#fbbf24", fontSize: "0.8rem", marginBottom: "0.25rem" }}>{"★".repeat(Math.round(r.rating))}</div>}
                                            {r.text && <p style={{ color: "var(--bf-muted)", fontSize: "0.85rem", lineHeight: 1.6, margin: 0 }}>{r.text}</p>}
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                        {/* Hours */}
                        {hours && (
                            <Card>
                                <SectionTitle icon={Clock}>שעות פתיחה</SectionTitle>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                                    {DAYS.map(day => {
                                        const d = hours![day];
                                        const todayIdx = new Date().getDay();
                                        const isToday = DAYS[todayIdx] === day;
                                        return (
                                            <div key={day} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.45rem 0.75rem", borderRadius: 10, background: isToday ? "var(--bf-glass-strong)" : "rgba(255,255,255,.025)", border: isToday ? "1px solid rgba(255,255,255,.3)" : "1px solid transparent" }}>
                                                <span style={{ fontSize: "0.86rem", fontWeight: isToday ? 800 : 500, color: isToday ? "var(--bf-text)" : "var(--bf-muted)" }}>{DAY_LABELS[day]}{isToday ? " · היום" : ""}</span>
                                                <span dir="ltr" style={{ fontSize: "0.84rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: d.closed ? "#f87171" : "var(--bf-text)" }}>
                                                    {d.closed ? "סגור" : `${d.open} – ${d.close}`}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </Card>
                        )}

                        {/* Team */}
                        {p!.artists.length > 0 && (
                            <Card>
                                <SectionTitle icon={Users}>הצוות</SectionTitle>
                                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                                    {p!.artists.map(a => (
                                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 12, padding: "0.4rem 0.8rem 0.4rem 0.4rem" }}>
                                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.78rem", fontWeight: 800, color: "#000" }}>
                                                {a.name.charAt(0)}
                                            </div>
                                            <span style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--bf-text)" }}>{a.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                    </div>
                )}

                {/* ── Tab: Services ── */}
                {activeTab === "services" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                        {p!.services.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "3rem", color: "var(--bf-faint)" }}>אין שירותים להצגה</div>
                        ) : p!.services.map(s => (
                            <div key={s.id} style={{ background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 18, padding: "1rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", position: "relative", overflow: "hidden" }}>
                                {/* Color stripe */}
                                <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 4, background: s.color || "#fff", borderRadius: "0 18px 18px 0" }} />
                                <div style={{ flex: 1, paddingRight: "0.5rem" }}>
                                    <div style={{ fontWeight: 700, fontSize: "0.96rem", color: "var(--bf-text)", marginBottom: "0.2rem" }}>{s.name}</div>
                                    {s.description && <div style={{ color: "var(--bf-muted)", fontSize: "0.8rem", lineHeight: 1.5 }}>{s.description}</div>}
                                    {s.is_bookable_online && <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", marginTop: "0.4rem", fontSize: "0.7rem", fontWeight: 700, color: "var(--bf-text)", background: "var(--bf-glass-strong)", border: "1px solid var(--bf-line)", borderRadius: 8, padding: "0.15rem 0.5rem" }}><Check size={12} aria-hidden /> ניתן להזמנה</span>}
                                </div>
                                <div style={{ textAlign: "left", flexShrink: 0 }}>
                                    {s.duration_minutes > 0 && <div style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", color: "var(--bf-faint)", fontSize: "0.78rem", marginBottom: "0.2rem" }}><Clock size={12} aria-hidden /> {dur(s.duration_minutes)}</div>}
                                    {s.price_ils > 0 && <div style={{ color: "var(--bf-text)", fontWeight: 800, fontSize: "1.08rem", fontVariantNumeric: "tabular-nums" }}>₪{s.price_ils}</div>}
                                </div>
                            </div>
                        ))}

                        {p!.self_booking_enabled && bookableServices.length > 0 && (
                            <Link href={`/b/${slug}/book`} style={{ ...PRIMARY_BTN, justifyContent: "center", marginTop: "0.5rem", padding: "0.9rem", borderRadius: 16 }}>
                                <CalendarDays size={17} aria-hidden /> קביעת תור עכשיו
                            </Link>
                        )}
                    </div>
                )}

                {/* ── Tab: Gallery ── */}
                {activeTab === "gallery" && hasGallery && (
                    <div>
                        {/* Masonry-style: first photo big, rest smaller */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
                            {p!.gallery.map((url, i) => (
                                <div key={i}
                                    onClick={() => setLightbox({ url: imgUrl(url), index: i })}
                                    style={{
                                        gridColumn: i === 0 ? "1 / 3" : undefined,
                                        gridRow: i === 0 ? "1 / 3" : undefined,
                                        borderRadius: 14, overflow: "hidden",
                                        aspectRatio: i === 0 ? "1.2" : "1",
                                        cursor: "zoom-in", background: "#111",
                                    }}>
                                    <img src={imgUrl(url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform .25s" }}
                                        onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
                                        onMouseLeave={e => (e.currentTarget.style.transform = "")}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Tab: Reviews ── */}
                {activeTab === "reviews" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                        {/* Summary bar */}
                        {p!.avg_rating != null && p!.review_count > 0 && (
                            <Card>
                                <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
                                    <div style={{ textAlign: "center" }}>
                                        <div style={{ fontSize: "2.8rem", fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>{p!.avg_rating.toFixed(1)}</div>
                                        <div style={{ color: "#fbbf24", fontSize: "1rem" }}>{"★".repeat(Math.round(p!.avg_rating))}</div>
                                        <div style={{ color: "var(--bf-faint)", fontSize: "0.72rem", marginTop: "0.2rem" }}>{p!.review_count} ביקורות</div>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        {[5,4,3,2,1].map(n => {
                                            const cnt = p!.reviews.filter(r => r.rating === n).length;
                                            const pct = p!.review_count > 0 ? (cnt / p!.review_count) * 100 : 0;
                                            return (
                                                <div key={n} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
                                                    <span style={{ fontSize: "0.72rem", color: "var(--bf-faint)", width: 8, flexShrink: 0 }}>{n}</span>
                                                    <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,.08)", borderRadius: 3, overflow: "hidden" }}>
                                                        <div style={{ height: "100%", width: `${pct}%`, background: "#fbbf24", borderRadius: 3, transition: "width .4s" }} />
                                                    </div>
                                                    <span style={{ fontSize: "0.68rem", color: "var(--bf-faint)", width: 20, textAlign: "left" }}>{cnt}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </Card>
                        )}

                        {/* Add review */}
                        {!submitted && (
                            <button type="button" onClick={() => setShowReview(v => !v)}
                                style={{ ...GLASS_BTN, justifyContent: "center", width: "100%", cursor: "pointer" }}>
                                {showReview ? "ביטול" : <><PenLine size={16} aria-hidden /> כתוב ביקורת</>}
                            </button>
                        )}
                        {submitted && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", background: "rgba(74,222,128,.08)", border: "1px solid rgba(74,222,128,.25)", borderRadius: 14, padding: "0.9rem 1rem", color: "#4ade80", fontSize: "0.88rem" }}>
                                <Check size={16} aria-hidden /> תודה! הביקורת נשלחה לאישור.
                            </div>
                        )}
                        {showReview && (
                            <Card>
                                <SectionTitle>כתוב ביקורת</SectionTitle>
                                <div style={{ marginBottom: "0.75rem" }}>
                                    <label style={labelStyle}>שם מלא *</label>
                                    <input value={reviewForm.client_name} onChange={e => setReviewForm(f => ({ ...f, client_name: e.target.value }))}
                                        style={reviewInputStyle}
                                        onFocus={e => e.target.style.borderColor = "#fff"}
                                        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,.12)"}
                                        placeholder="השם שיופיע בביקורת" />
                                </div>
                                <div style={{ marginBottom: "0.75rem" }}>
                                    <label style={labelStyle}>דירוג</label>
                                    <div style={{ display: "flex", gap: "0.1rem" }}>
                                        {[1,2,3,4,5].map(n => (
                                            <button key={n} type="button" onClick={() => setReviewForm(f => ({ ...f, rating: n }))}
                                                style={{ background: "none", border: "none", fontSize: "1.9rem", cursor: "pointer", color: n <= reviewForm.rating ? "#fbbf24" : "rgba(255,255,255,.2)", padding: "0 0.1rem", transition: "color .1s" }}>★</button>
                                        ))}
                                    </div>
                                </div>
                                <div style={{ marginBottom: "1rem" }}>
                                    <label style={labelStyle}>תגובה (אופציונלי)</label>
                                    <textarea value={reviewForm.comment} onChange={e => setReviewForm(f => ({ ...f, comment: e.target.value }))}
                                        rows={3} placeholder="שתפו את החוויה שלכם..."
                                        style={{ ...reviewInputStyle, resize: "vertical", lineHeight: 1.6 }}
                                        onFocus={e => e.target.style.borderColor = "#fff"}
                                        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,.12)"}
                                    />
                                </div>
                                {reviewError && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.85rem", marginBottom: "0.6rem" }}>{reviewError}</div>}
                                <button type="button" onClick={submitReview} disabled={submitting || !reviewForm.client_name}
                                    style={{ ...PRIMARY_BTN, opacity: submitting || !reviewForm.client_name ? 0.6 : 1 }}>
                                    {submitting ? "שולח..." : <><Send size={15} aria-hidden /> שלח ביקורת</>}
                                </button>
                            </Card>
                        )}

                        {/* Reviews list */}
                        {p!.reviews.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "2.5rem", color: "var(--bf-faint)", border: "1px dashed var(--bf-line)", borderRadius: 16 }}>
                                <MessageCircle size={30} strokeWidth={1.5} aria-hidden style={{ marginBottom: "0.5rem" }} />
                                <div>אין ביקורות עדיין — היה ראשון!</div>
                            </div>
                        ) : p!.reviews.map(r => (
                            <div key={r.id} style={{ background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 16, padding: "1rem 1.1rem" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 800, color: "#000" }}>
                                            {r.client_name.charAt(0)}
                                        </div>
                                        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{r.client_name}</span>
                                    </div>
                                    <div style={{ color: "#fbbf24", fontSize: "0.82rem" }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                                </div>
                                {r.comment && <p style={{ color: "var(--bf-muted)", fontSize: "0.86rem", lineHeight: 1.65, margin: 0 }}>{r.comment}</p>}
                                <div style={{ color: "var(--bf-faint)", fontSize: "0.7rem", marginTop: "0.4rem" }}>
                                    {new Date(r.created_at).toLocaleDateString("he-IL")}
                                </div>
                            </div>
                        ))}

                        {p!.review_link_google && (
                            <a href={p!.review_link_google} target="_blank" rel="noopener"
                                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", color: "var(--bf-muted)", fontSize: "0.84rem", textDecoration: "none", padding: "0.5rem" }}>
                                <Star size={14} aria-hidden /> כתוב ביקורת ב-Google ↗
                            </a>
                        )}
                    </div>
                )}
            </div>

            {/* ── Floating bottom bar (mobile) ── */}
            {p!.self_booking_enabled && (
                <div style={{ position: "fixed", bottom: 60, left: 0, right: 0, padding: "0.65rem 1.25rem", background: "rgba(0,0,0,.88)", backdropFilter: "blur(16px)", borderTop: "1px solid var(--bf-line)", display: "flex", gap: "0.6rem", zIndex: 50 }}>
                    <Link href={`/b/${slug}/book`} style={{ ...PRIMARY_BTN, flex: 1, justifyContent: "center", padding: "0.8rem" }}>
                        <CalendarDays size={17} aria-hidden /> קביעת תור
                    </Link>
                    {p!.whatsapp && (
                        <a href={`https://wa.me/${p!.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener"
                            aria-label="WhatsApp" style={{ ...GLASS_BTN, justifyContent: "center", padding: "0.8rem 1rem" }}>
                            <MessageCircle size={18} color="#25d366" aria-hidden />
                        </a>
                    )}
                    {p!.phone && (
                        <a href={`tel:${p!.phone}`}
                            aria-label="התקשר" style={{ ...GLASS_BTN, justifyContent: "center", padding: "0.8rem 1rem" }}>
                            <Phone size={18} aria-hidden />
                        </a>
                    )}
                </div>
            )}
        </div>

        {showRequestModal && (
            <RequestModal
                slug={slug}
                studioName={p!.name}
                services={p!.services.map(s => s.name)}
                onClose={() => setShowRequestModal(false)}
            />
        )}
        </>
    );
}

// ── Request Modal ─────────────────────────────────────────────────────────────

function RequestModal({ slug, studioName, services, onClose }: {
    slug: string; studioName: string; services: string[]; onClose: () => void;
}) {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [service, setService] = useState("");
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

    const submit = async () => {
        if (!name.trim() || !phone.trim()) { setErr("שם וטלפון נדרשים"); return; }
        setLoading(true); setErr(null);
        try {
            const r = await fetch(`${API}/api/book/${slug}/request`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_name: name.trim(), client_phone: phone.trim(), service_name: service || undefined, notes: notes || undefined }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "שגיאה"); }
            setDone(true);
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setLoading(false); }
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
            onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={{ background: "#0c0c0c", border: "1px solid var(--bf-line)", borderBottom: "none", borderRadius: "22px 22px 0 0", width: "100%", maxWidth: 480, padding: "1.5rem", color: "var(--bf-text)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 800, fontSize: "1.1rem" }}><ClipboardList size={19} aria-hidden /> בקשת תור</div>
                        <div style={{ color: "var(--bf-faint)", fontSize: "0.8rem", marginTop: "0.2rem" }}>{studioName} יחזור אליך בהקדם</div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="סגור" style={{ background: "none", border: "none", color: "var(--bf-faint)", fontSize: "1.5rem", cursor: "pointer" }}>×</button>
                </div>

                {done ? (
                    <div style={{ textAlign: "center", padding: "2rem 0" }}>
                        <div style={{ width: 56, height: 56, margin: "0 auto 0.75rem", borderRadius: "50%", background: "#fff", color: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={28} aria-hidden /></div>
                        <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.5rem" }}>הבקשה נשלחה!</div>
                        <div style={{ color: "var(--bf-muted)", fontSize: "0.88rem", marginBottom: "1.5rem" }}>העסק יצור איתך קשר בקרוב</div>
                        <button type="button" onClick={onClose}
                            style={{ ...PRIMARY_BTN, margin: "0 auto", padding: "0.75rem 2rem" }}>
                            סגור
                        </button>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                            <div>
                                <label style={reqLabel}>שם מלא *</label>
                                <input value={name} onChange={e => setName(e.target.value)} placeholder="שם פרטי ומשפחה" style={reqInput} />
                            </div>
                            <div>
                                <label style={reqLabel}>טלפון *</label>
                                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="050..." type="tel" dir="ltr" style={reqInput} />
                            </div>
                        </div>
                        {services.length > 0 && (
                            <div>
                                <label style={reqLabel}>שירות מבוקש</label>
                                <select value={service} onChange={e => setService(e.target.value)} style={reqInput}>
                                    <option value="" style={OPTION_STYLE}>בחר שירות...</option>
                                    {services.map(s => <option key={s} value={s} style={OPTION_STYLE}>{s}</option>)}
                                </select>
                            </div>
                        )}
                        <div>
                            <label style={reqLabel}>הערות (זמן מועדף, פרטים נוספים)</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                                placeholder="לדוגמה: מחפש תור בערב, עדיפות יום חמישי..."
                                style={{ ...reqInput, resize: "vertical", height: 72 }} />
                        </div>
                        {err && <p style={{ color: "#f87171", fontSize: "0.8rem", margin: 0 }}>{err}</p>}
                        <button type="button" onClick={submit} disabled={loading}
                            style={{ ...PRIMARY_BTN, justifyContent: "center", padding: "0.9rem", fontSize: "0.95rem", opacity: loading ? 0.7 : 1 }}>
                            {loading ? "שולח..." : <><Send size={16} aria-hidden /> שלח בקשה</>}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

const reqLabel: React.CSSProperties = { display: "block", color: "var(--bf-muted)", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.3rem" };
// colorScheme: "dark" matters specifically for the <select> that reuses this
// style — a <select>'s open dropdown/options list is rendered by the browser's
// native form-control chrome, which ignores this object's own background/color
// and defaults to a light popup (barely-visible text) unless told the
// surrounding UI is dark.
const reqInput: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, padding: "0.65rem 0.85rem", color: "#fff", fontSize: "0.9rem", outline: "none", boxSizing: "border-box", colorScheme: "dark" };
// ── UI helpers ────────────────────────────────────────────────────────────────

const reviewInputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.06)", border: "1.5px solid rgba(255,255,255,.12)",
    borderRadius: 12, padding: "0.65rem 0.85rem", color: "#fff", fontSize: "0.9rem",
    outline: "none", boxSizing: "border-box", transition: "border-color .2s",
};
const labelStyle: React.CSSProperties = {
    display: "block", color: "var(--bf-muted)", fontSize: "0.78rem", marginBottom: "0.3rem", fontWeight: 600,
};

// The back / share buttons on the cover.
const HERO_BTN: React.CSSProperties = {
    position: "absolute", top: 14, display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "rgba(0,0,0,.45)", backdropFilter: "blur(10px)",
    color: "#fff", textDecoration: "none", padding: "0.42rem 0.85rem", borderRadius: 12, fontSize: "0.82rem", border: "1px solid rgba(255,255,255,.2)", fontWeight: 600,
};

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ ...GLASS_CARD, padding: "1.25rem" }}>
            {children}
        </div>
    );
}
function SectionTitle({ children, icon: Icon }: { children: React.ReactNode; icon?: LucideIcon }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontWeight: 800, fontSize: "0.98rem", color: "var(--bf-text)", marginBottom: "0.85rem" }}>
            {Icon && <Icon size={17} color="rgba(255,255,255,.6)" aria-hidden />}{children}
        </div>
    );
}
