"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";
import { setStudioToken, goToBizControl } from "@/lib/handoff";

interface Business {
    id: string; slug: string; name: string; category: string;
    city?: string; address?: string; phone?: string;
    latitude?: number; longitude?: number; description?: string;
    opening_hours?: string[] | null; opening_hours_google?: string[] | null;
    claim_status: string;
    google_photo_urls: string[]; google_rating?: number | null; google_rating_count?: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
    tattoo: "סטודיו קעקועים", barber: "ספר / ברברשופ", nails: "ציפורניים",
    laser: "לייזר", pilates: "פילאטיס / כושר", spa: "ספא / קוסמטיקה",
    medical: "קליניקה / מרפאה", other: "אחר",
};

const inputStyle: React.CSSProperties = {
    width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 12,
    padding: "0.75rem 1rem", fontSize: "1rem", outline: "none",
    fontFamily: "system-ui,sans-serif", color: "#1e293b", background: "#fff",
    boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.85rem", fontWeight: 700, color: "#374151", marginBottom: "0.45rem" };

type ClaimStep = "closed" | "otp_sent" | "otp_verified" | "done";

export default function BusinessDetailPage() {
    const { slug } = useParams() as { slug: string };
    const [biz, setBiz] = useState<Business | null>(null);
    const [err, setErr] = useState<string | null>(null);

    const [claimStep, setClaimStep] = useState<ClaimStep>("closed");
    const [claimErr, setClaimErr] = useState<string | null>(null);
    const [loadingAction, setLoadingAction] = useState(false);
    const [otpCode, setOtpCode] = useState("");
    const [claimToken, setClaimToken] = useState("");
    const [ownerName, setOwnerName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    useEffect(() => {
        fetch(`${API}/api/businesses/${slug}`)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(setBiz)
            .catch(() => setErr("העסק לא נמצא"));
    }, [slug]);

    const startClaim = async () => {
        if (!biz) return;
        setLoadingAction(true);
        setClaimErr(null);
        try {
            const res = await fetch(`${API}/api/businesses/${biz.id}/claim/request-otp`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "שגיאה בשליחת קוד");
            setClaimStep("otp_sent");
        } catch (e: unknown) {
            setClaimErr(e instanceof Error ? e.message : "שגיאה בשליחת קוד");
        } finally {
            setLoadingAction(false);
        }
    };

    const verifyOtp = async () => {
        if (!biz) return;
        setLoadingAction(true);
        setClaimErr(null);
        try {
            const res = await fetch(`${API}/api/businesses/${biz.id}/claim/verify-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: otpCode.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "קוד שגוי");
            setClaimToken(data.claim_token);
            setClaimStep("otp_verified");
        } catch (e: unknown) {
            setClaimErr(e instanceof Error ? e.message : "קוד שגוי");
        } finally {
            setLoadingAction(false);
        }
    };

    const completeClaim = async () => {
        if (!biz) return;
        setLoadingAction(true);
        setClaimErr(null);
        try {
            const res = await fetch(`${API}/api/businesses/${biz.id}/claim/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ claim_token: claimToken, owner_name: ownerName.trim(), email: email.trim(), password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "שגיאה ביצירת החשבון");
            setStudioToken(data.access_token);
            setClaimStep("done");
        } catch (e: unknown) {
            setClaimErr(e instanceof Error ? e.message : "שגיאה ביצירת החשבון");
        } finally {
            setLoadingAction(false);
        }
    };

    if (err) {
        return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>{err}</div>;
    }
    if (!biz) {
        return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>טוען...</div>;
    }

    const hours = biz.opening_hours_google || biz.opening_hours;

    return (
        <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9" }} dir="rtl">
            <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1.25rem" }}>
                <Link href="/businesses" style={{ color: "#94a3b8", fontSize: "0.85rem", textDecoration: "none" }}>← חזרה לרשימה</Link>

                {biz.claim_status === "claimed" && (
                    <div style={{ marginTop: "1rem", background: "#16a34a22", border: "1px solid #16a34a55", borderRadius: 12, padding: "0.75rem 1rem", color: "#4ade80", fontSize: "0.85rem" }}>
                        🟢 העסק הזה כבר נתבע ומנוהל על ידי בעליו.
                    </div>
                )}

                {/* Photos */}
                {biz.google_photo_urls.length > 0 && (
                    <div style={{ display: "flex", gap: "0.6rem", overflowX: "auto", margin: "1.25rem 0" }}>
                        {biz.google_photo_urls.map((url, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={`${API}${url}`} alt={biz.name} style={{ height: 200, borderRadius: 14, flexShrink: 0 }} />
                        ))}
                    </div>
                )}

                <div style={{ fontSize: "0.8rem", color: "#7c3aed", fontWeight: 700, marginTop: "1.25rem" }}>
                    {CATEGORY_LABELS[biz.category] || biz.category}
                </div>
                <h1 style={{ fontWeight: 900, fontSize: "1.8rem", margin: "0.3rem 0" }}>{biz.name}</h1>

                {biz.google_rating && (
                    <div style={{ color: "#fbbf24", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
                        ⭐ {biz.google_rating} ({biz.google_rating_count} ביקורות בגוגל)
                    </div>
                )}
                {biz.address && <div style={{ color: "#cbd5e1", fontSize: "0.9rem", marginBottom: "0.3rem" }}>📍 {biz.address}{biz.city ? `, ${biz.city}` : ""}</div>}
                {biz.phone && <div style={{ color: "#cbd5e1", fontSize: "0.9rem", marginBottom: "0.3rem", direction: "ltr", textAlign: "right" }}>📞 {biz.phone}</div>}

                {hours && hours.length > 0 && (
                    <div style={{ marginTop: "1rem", background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1rem" }}>
                        <div style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "0.9rem" }}>שעות פעילות</div>
                        {hours.map((line, i) => (
                            <div key={i} style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{line}</div>
                        ))}
                    </div>
                )}

                {/* Claim CTA / flow */}
                {biz.claim_status !== "claimed" && (
                    <div style={{ marginTop: "2rem", background: "#fff", borderRadius: 20, padding: "1.5rem", color: "#1e293b" }}>
                        {claimStep === "closed" && (
                            <>
                                <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.4rem" }}>העסק הזה שלך?</div>
                                <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1rem" }}>
                                    קבל בעלות עליו בחינם וקבל ניהול מלא — יומן תורים, לקוחות, WhatsApp ועוד — דרך BizControl.
                                </p>
                                <button onClick={startClaim} disabled={loadingAction || !biz.phone} style={{ width: "100%", padding: "0.9rem", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "0.95rem", cursor: "pointer", opacity: loadingAction ? 0.7 : 1 }}>
                                    {loadingAction ? "שולח..." : "כן, זה העסק שלי — קבל בעלות"}
                                </button>
                                {!biz.phone && <div style={{ color: "#dc2626", fontSize: "0.8rem", marginTop: "0.6rem" }}>לעסק זה אין מספר טלפון רשום, לא ניתן לאמת בעלות כרגע.</div>}
                            </>
                        )}

                        {claimStep === "otp_sent" && (
                            <>
                                <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.4rem" }}>הזן את הקוד שקיבלת</div>
                                <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1rem" }}>
                                    שלחנו קוד אימות למספר הטלפון הרשום של העסק ({biz.phone}).
                                </p>
                                <label style={labelStyle}>קוד אימות</label>
                                <input value={otpCode} onChange={e => setOtpCode(e.target.value)} maxLength={6} dir="ltr" style={{ ...inputStyle, textAlign: "center", letterSpacing: "0.3em", fontSize: "1.3rem", marginBottom: "1rem" }} />
                                <button onClick={verifyOtp} disabled={loadingAction || otpCode.trim().length < 4} style={{ width: "100%", padding: "0.9rem", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "0.95rem", cursor: "pointer", opacity: loadingAction ? 0.7 : 1 }}>
                                    {loadingAction ? "מאמת..." : "אמת קוד"}
                                </button>
                            </>
                        )}

                        {claimStep === "otp_verified" && (
                            <>
                                <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.4rem" }}>כמעט סיימנו 🎉</div>
                                <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1rem" }}>פרטי הכניסה שלך ל-BizControl ול-BizFind.</p>
                                <label style={labelStyle}>שם מלא</label>
                                <input value={ownerName} onChange={e => setOwnerName(e.target.value)} style={{ ...inputStyle, marginBottom: "0.85rem" }} />
                                <label style={labelStyle}>אימייל</label>
                                <input type="email" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" style={{ ...inputStyle, marginBottom: "0.85rem" }} />
                                <label style={labelStyle}>סיסמה</label>
                                <input type="password" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" style={{ ...inputStyle, marginBottom: "1rem" }} />
                                <button
                                    onClick={completeClaim}
                                    disabled={loadingAction || ownerName.trim().length < 2 || !email.trim() || password.length < 6}
                                    style={{ width: "100%", padding: "0.9rem", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "0.95rem", cursor: "pointer", opacity: loadingAction ? 0.7 : 1 }}
                                >
                                    {loadingAction ? "יוצר חשבון..." : "סיים והתחל לנהל"}
                                </button>
                            </>
                        )}

                        {claimStep === "done" && (
                            <div style={{ textAlign: "center" }}>
                                <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🎉</div>
                                <div style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.4rem" }}>העסק שלך אומת!</div>
                                <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1.25rem" }}>עכשיו אפשר לנהל אותו — יומן, לקוחות, תשלומים ועוד.</p>
                                <button onClick={() => goToBizControl("/onboarding")} style={{ width: "100%", padding: "0.9rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
                                    נהל את העסק שלך עכשיו →
                                </button>
                            </div>
                        )}

                        {claimErr && <div style={{ color: "#dc2626", fontSize: "0.82rem", marginTop: "0.85rem", fontWeight: 600 }}>{claimErr}</div>}
                    </div>
                )}
            </div>
        </div>
    );
}
