"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/^http:\/\//, "https://");

type ShopInfo = {
    studio_name: string;
    logo_url: string | null;
    logo_filename: string | null;
    bit_link: string | null;
    paybox_link: string | null;
    min_amount_cents: number;
    max_amount_cents: number;
};

const ALL_PRESETS = [100, 200, 300, 500];

export default function GiftCardShopPage() {
    const params = useParams();
    const studioId = params.studioId as string;

    const [info, setInfo] = useState<ShopInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadErr, setLoadErr] = useState<string | null>(null);

    const [amount, setAmount] = useState<number | null>(null);
    const [customAmount, setCustomAmount] = useState("");
    const [recipientName, setRecipientName] = useState("");
    const [recipientPhone, setRecipientPhone] = useState("");
    const [personalMessage, setPersonalMessage] = useState("");
    const [buyerName, setBuyerName] = useState("");
    const [buyerEmail, setBuyerEmail] = useState("");
    const [buyerPhone, setBuyerPhone] = useState("");
    const [deliverTo, setDeliverTo] = useState<"buyer" | "recipient">("buyer");

    const [submitting, setSubmitting] = useState(false);
    const [submitErr, setSubmitErr] = useState<string | null>(null);
    const [orderedAmountIls, setOrderedAmountIls] = useState<number | null>(null);
    const [orderedBonusIls, setOrderedBonusIls] = useState<number>(0);

    useEffect(() => {
        if (!studioId) return;
        fetch(`${API}/api/public/gift-cards/shop/${studioId}`)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then((data: ShopInfo) => {
                setInfo(data);
                const minIls = (data.min_amount_cents || 100) / 100;
                const maxIls = data.max_amount_cents ? data.max_amount_cents / 100 : Infinity;
                const valid = ALL_PRESETS.filter(a => a >= minIls && a <= maxIls);
                setAmount(valid.length > 0 ? valid[0] : minIls);
            })
            .catch(() => setLoadErr("העסק לא נמצא"))
            .finally(() => setLoading(false));
    }, [studioId]);

    const resolvedLogo = info?.logo_url || (info?.logo_filename ? `${API}/uploads/${info.logo_filename}` : null);

    const minIls = info ? (info.min_amount_cents || 100) / 100 : 1;
    const maxIls = info && info.max_amount_cents ? info.max_amount_cents / 100 : Infinity;
    const presets = ALL_PRESETS.filter(a => a >= minIls && a <= maxIls);
    const effectivePresets = presets.length > 0 ? presets : [minIls, ...(maxIls !== Infinity ? [maxIls] : [])];

    const effectiveAmount = amount ?? (parseFloat(customAmount) || 0);
    const amountOutOfRange = effectiveAmount > 0 && (effectiveAmount < minIls || (maxIls !== Infinity && effectiveAmount > maxIls));

    const submit = async () => {
        setSubmitErr(null);
        if (!effectiveAmount || effectiveAmount < 1) { setSubmitErr("יש לבחור סכום"); return; }
        if (amountOutOfRange) {
            setSubmitErr(`הסכום חייב להיות בין ₪${minIls.toFixed(0)}${maxIls !== Infinity ? ` ל-₪${maxIls.toFixed(0)}` : ""}`);
            return;
        }
        if (!recipientName.trim()) { setSubmitErr("שם הנמען נדרש"); return; }
        if (!buyerName.trim() || !buyerPhone.trim()) { setSubmitErr("שם וטלפון שלך נדרשים"); return; }

        setSubmitting(true);
        try {
            const res = await fetch(`${API}/api/public/gift-cards/order/${studioId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    amount_cents: Math.round(effectiveAmount * 100),
                    recipient_name: recipientName.trim(),
                    recipient_phone: recipientPhone.trim() || undefined,
                    personal_message: personalMessage.trim() || undefined,
                    buyer_name: buyerName.trim(),
                    buyer_email: buyerEmail.trim() || undefined,
                    buyer_phone: buyerPhone.trim(),
                    deliver_to: deliverTo,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || "שגיאה בשליחת ההזמנה");
            }
            const data = await res.json();
            setOrderedAmountIls(data.amount_ils ?? effectiveAmount);
            setOrderedBonusIls(data.bonus_ils ?? 0);
        } catch (e: unknown) {
            setSubmitErr((e as Error).message || "שגיאה בשליחת ההזמנה");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div style={pageStyle}><FontImport /><div style={{ color: "#c9a227" }}>טוען...</div></div>;
    }
    if (loadErr || !info) {
        return <div style={pageStyle}><FontImport /><div style={{ color: "#e5484d" }}>{loadErr || "העסק לא נמצא"}</div></div>;
    }

    if (orderedAmountIls !== null) {
        return (
            <div style={pageStyle}>
                <FontImport />
                <div style={cardStyle}>
                    <div style={{ fontSize: 44, marginBottom: 12, textAlign: "center" }}>🎉</div>
                    <h2 style={{ ...headingStyle, textAlign: "center" }}>ההזמנה נקלטה</h2>
                    {orderedBonusIls > 0 && (
                        <p style={{ color: "#c9a227", textAlign: "center", fontWeight: 700, fontSize: 15, margin: "10px 0 0", fontFamily: SERIF }}>
                            כולל בונוס של ₪{orderedBonusIls.toFixed(0)} — השובר יהיה בשווי ₪{(orderedAmountIls + orderedBonusIls).toFixed(0)}
                        </p>
                    )}
                    <p style={{ color: "#8f8570", textAlign: "center", lineHeight: 1.8, margin: "14px 0 26px", fontSize: 15 }}>
                        נשאר רק לשלם ₪{orderedAmountIls.toFixed(0)} דרך ביט, ונשלח לך אישור עם קוד השובר לאחר אימות התשלום.
                    </p>
                    {info.bit_link ? (
                        <a href={info.bit_link} target="_blank" rel="noopener noreferrer" style={goldButtonStyle}>
                            שלם ₪{orderedAmountIls.toFixed(0)} דרך ביט
                        </a>
                    ) : (
                        <p style={{ color: "#c9a227", textAlign: "center" }}>ניתן לתאם תשלום ישירות מול {info.studio_name}</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={pageStyle}>
            <FontImport />
            <div style={cardStyle}>
                <div style={{ textAlign: "center", marginBottom: 28 }}>
                    {resolvedLogo ? (
                        <img src={resolvedLogo} alt={info.studio_name} style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "2px solid #c9a227", marginBottom: 10 }} />
                    ) : (
                        <div style={{ fontSize: 38, marginBottom: 6 }}>🎁</div>
                    )}
                    <h1 style={headingStyle}>{info.studio_name} — כרטיס מתנה</h1>
                    <p style={{ color: "#8f8570", fontSize: 13.5, letterSpacing: "0.03em" }}>תן/י מתנה שתמיד מתאימה</p>
                </div>

                <label style={labelStyle}>שם הנמען — למי המתנה? *</label>
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="למי המתנה?" style={inputStyle} />

                <label style={labelStyle}>טלפון הנמען/ת (אופציונלי)</label>
                <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} type="tel" placeholder="050..." style={inputStyle} dir="ltr" />

                <label style={labelStyle}>ברכה אישית (אופציונלי)</label>
                <textarea value={personalMessage} onChange={e => setPersonalMessage(e.target.value)} rows={2} placeholder="כתוב/י כמה מילים..." style={{ ...inputStyle, resize: "none" }} />

                <div style={dividerStyle} />

                <label style={labelStyle}>שם מלא שלך *</label>
                <input value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="השם שלך" style={inputStyle} />

                <label style={labelStyle}>טלפון שלך *</label>
                <input value={buyerPhone} onChange={e => setBuyerPhone(e.target.value)} type="tel" placeholder="050..." style={inputStyle} dir="ltr" />

                <label style={labelStyle}>אימייל שלך (לקבלת אישור)</label>
                <input value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} type="email" placeholder="email@..." style={inputStyle} dir="ltr" />

                <label style={labelStyle}>למי לשלוח את השובר?</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <button type="button" onClick={() => setDeliverTo("buyer")}
                        style={{ ...pillButtonStyle, flex: 1, ...(deliverTo === "buyer" ? pillButtonActiveStyle : {}) }}>
                        אליי (אעביר בעצמי)
                    </button>
                    <button type="button" onClick={() => setDeliverTo("recipient")}
                        style={{ ...pillButtonStyle, flex: 1, ...(deliverTo === "recipient" ? pillButtonActiveStyle : {}) }}>
                        ישירות לנמען/ת
                    </button>
                </div>

                <div style={dividerStyle} />

                <label style={labelStyle}>סכום הכרטיס</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    {effectivePresets.map(a => (
                        <button key={a} type="button" onClick={() => { setAmount(a); setCustomAmount(""); }}
                            style={{ ...pillButtonStyle, ...(amount === a ? pillButtonActiveStyle : {}) }}>
                            ₪{a.toFixed(0)}
                        </button>
                    ))}
                    <input
                        value={customAmount}
                        onChange={e => { setCustomAmount(e.target.value); setAmount(null); }}
                        type="number" min={minIls} max={maxIls !== Infinity ? maxIls : undefined} placeholder="סכום אחר"
                        style={{ ...inputStyle, width: 110, textAlign: "center", marginBottom: 0 }}
                        dir="ltr"
                    />
                </div>
                <p style={{ color: "#6b6252", fontSize: 12, margin: "0 0 4px" }}>
                    טווח: ₪{minIls.toFixed(0)}{maxIls !== Infinity ? ` – ₪${maxIls.toFixed(0)}` : " ומעלה"}
                </p>

                {submitErr && <p style={{ color: "#e5484d", fontSize: 14, marginTop: 12 }}>{submitErr}</p>}

                <button type="button" onClick={submit} disabled={submitting} style={{ ...goldButtonStyle, width: "100%", marginTop: 20, opacity: submitting ? 0.6 : 1 }}>
                    {submitting ? "שולח..." : `המשך לתשלום — ₪${effectiveAmount || 0}`}
                </button>
            </div>
        </div>
    );
}

const SERIF = "'Frank Ruhl Libre', Georgia, serif";

function FontImport() {
    return <style>{`@import url('https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&display=swap');`}</style>;
}

const pageStyle: React.CSSProperties = {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(circle at 50% 0%, #1a1a1a 0%, #050505 70%)", padding: "24px",
    fontFamily: "system-ui,-apple-system,sans-serif", direction: "rtl",
};

const cardStyle: React.CSSProperties = {
    width: "100%", maxWidth: 440, background: "linear-gradient(160deg,#161616,#0a0a0a)",
    border: "1px solid #c9a227", borderRadius: 20, padding: "30px 26px",
    boxShadow: "0 0 40px rgba(201,162,39,.06), 0 10px 40px rgba(0,0,0,.6)",
};

// Headings/body read as warm cream white — gold is reserved as an accent
// (border, dividers, primary button, selected state), not for running text,
// which otherwise reads as flat yellow on black.
const headingStyle: React.CSSProperties = {
    color: "#f3ede0", fontSize: 23, fontWeight: 700, margin: "10px 0 4px",
    fontFamily: SERIF, letterSpacing: "0.015em",
};

const labelStyle: React.CSSProperties = {
    display: "block", color: "#c7bfa8", fontSize: 13, fontWeight: 600, margin: "14px 0 6px",
    fontFamily: SERIF,
};

const dividerStyle: React.CSSProperties = { borderTop: "1px solid rgba(201,162,39,.2)", margin: "20px 0 4px" };

const inputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.03)", border: "1px solid rgba(201,162,39,.25)",
    borderRadius: 10, padding: "10px 14px", color: "#f0ebe0", fontSize: 15, outline: "none",
    marginBottom: 2,
};

const pillButtonStyle: React.CSSProperties = {
    background: "rgba(255,255,255,.03)", border: "1px solid rgba(201,162,39,.3)", color: "#d8d2c2",
    borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
    fontFamily: SERIF,
};

const pillButtonActiveStyle: React.CSSProperties = {
    background: "linear-gradient(135deg,#e9c766,#a3791f)", borderColor: "#e9c766", color: "#141414",
};

const goldButtonStyle: React.CSSProperties = {
    display: "block", textAlign: "center", background: "linear-gradient(135deg,#e9c766,#a3791f)", color: "#141414",
    textDecoration: "none", borderRadius: 12, padding: "14px", fontSize: 16, fontWeight: 700,
    fontFamily: SERIF, border: "none", cursor: "pointer",
};
