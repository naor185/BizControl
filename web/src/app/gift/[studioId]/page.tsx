"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/^http:\/\//, "https://");

type ShopInfo = {
    studio_name: string;
    logo_url: string | null;
    bit_link: string | null;
    paybox_link: string | null;
};

const PRESET_AMOUNTS = [100, 200, 300, 500];

export default function GiftCardShopPage() {
    const params = useParams();
    const studioId = params.studioId as string;

    const [info, setInfo] = useState<ShopInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadErr, setLoadErr] = useState<string | null>(null);

    const [amount, setAmount] = useState<number | null>(200);
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

    useEffect(() => {
        if (!studioId) return;
        fetch(`${API}/api/public/gift-cards/shop/${studioId}`)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(setInfo)
            .catch(() => setLoadErr("העסק לא נמצא"))
            .finally(() => setLoading(false));
    }, [studioId]);

    const effectiveAmount = amount ?? (parseFloat(customAmount) || 0);

    const submit = async () => {
        setSubmitErr(null);
        if (!effectiveAmount || effectiveAmount < 1) { setSubmitErr("יש לבחור סכום"); return; }
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
        } catch (e: unknown) {
            setSubmitErr((e as Error).message || "שגיאה בשליחת ההזמנה");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div style={pageStyle}><div style={{ color: "#c4b5fd" }}>טוען...</div></div>;
    }
    if (loadErr || !info) {
        return <div style={pageStyle}><div style={{ color: "#f87171" }}>{loadErr || "העסק לא נמצא"}</div></div>;
    }

    if (orderedAmountIls !== null) {
        return (
            <div style={pageStyle}>
                <div style={cardStyle}>
                    <div style={{ fontSize: 48, marginBottom: 12, textAlign: "center" }}>🎉</div>
                    <h2 style={{ ...headingStyle, textAlign: "center" }}>ההזמנה נקלטה!</h2>
                    <p style={{ color: "#94a3b8", textAlign: "center", lineHeight: 1.7, margin: "12px 0 24px" }}>
                        נשאר רק לשלם ₪{orderedAmountIls.toFixed(0)} דרך ביט, ונשלח לך אישור עם קוד השובר לאחר אימות התשלום.
                    </p>
                    {info.bit_link ? (
                        <a href={info.bit_link} target="_blank" rel="noopener noreferrer" style={bitButtonStyle}>
                            💳 שלם ₪{orderedAmountIls.toFixed(0)} דרך ביט
                        </a>
                    ) : (
                        <p style={{ color: "#f59e0b", textAlign: "center" }}>ניתן לתאם תשלום ישירות מול {info.studio_name}</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={pageStyle}>
            <div style={cardStyle}>
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                    <div style={{ fontSize: 40 }}>🎁</div>
                    <h1 style={headingStyle}>כרטיס מתנה — {info.studio_name}</h1>
                    <p style={{ color: "#94a3b8", fontSize: 14 }}>תן/י מתנה שתמיד מתאימה</p>
                </div>

                <label style={labelStyle}>סכום הכרטיס</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    {PRESET_AMOUNTS.map(a => (
                        <button key={a} type="button" onClick={() => { setAmount(a); setCustomAmount(""); }}
                            style={{ ...pillButtonStyle, ...(amount === a ? pillButtonActiveStyle : {}) }}>
                            ₪{a}
                        </button>
                    ))}
                    <input
                        value={customAmount}
                        onChange={e => { setCustomAmount(e.target.value); setAmount(null); }}
                        type="number" min="1" placeholder="סכום אחר"
                        style={{ ...inputStyle, width: 110, textAlign: "center" }}
                        dir="ltr"
                    />
                </div>

                <label style={labelStyle}>שם הנמען/ת *</label>
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="למי המתנה?" style={inputStyle} />

                <label style={labelStyle}>טלפון הנמען/ת (אופציונלי)</label>
                <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} type="tel" placeholder="050..." style={inputStyle} dir="ltr" />

                <label style={labelStyle}>ברכה אישית (אופציונלי)</label>
                <textarea value={personalMessage} onChange={e => setPersonalMessage(e.target.value)} rows={2} placeholder="כתוב/י כמה מילים..." style={{ ...inputStyle, resize: "none" }} />

                <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", margin: "20px 0 16px" }} />

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

                {submitErr && <p style={{ color: "#f87171", fontSize: 14, marginTop: 12 }}>{submitErr}</p>}

                <button type="button" onClick={submit} disabled={submitting} style={submitButtonStyle}>
                    {submitting ? "שולח..." : `המשך לתשלום — ₪${effectiveAmount || 0}`}
                </button>
            </div>
        </div>
    );
}

const pageStyle: React.CSSProperties = {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(135deg,#1e1b4b,#4c1d95)", padding: "24px",
    fontFamily: "system-ui,-apple-system,sans-serif", direction: "rtl",
};

const cardStyle: React.CSSProperties = {
    width: "100%", maxWidth: 440, background: "rgba(30,27,75,.6)",
    border: "1px solid rgba(167,139,250,.25)", borderRadius: 24, padding: "28px 24px",
    backdropFilter: "blur(8px)",
};

const headingStyle: React.CSSProperties = { color: "#fff", fontSize: 22, fontWeight: 900, margin: "8px 0 4px" };

const labelStyle: React.CSSProperties = { display: "block", color: "#c4b5fd", fontSize: 13, fontWeight: 600, margin: "14px 0 6px" };

const inputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)",
    borderRadius: 12, padding: "10px 14px", color: "#fff", fontSize: 15, outline: "none",
};

const pillButtonStyle: React.CSSProperties = {
    background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)", color: "#e2e8f0",
    borderRadius: 12, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
};

const pillButtonActiveStyle: React.CSSProperties = {
    background: "#7c3aed", borderColor: "#7c3aed", color: "#fff",
};

const submitButtonStyle: React.CSSProperties = {
    width: "100%", marginTop: 22, background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff",
    border: "none", borderRadius: 14, padding: "14px", fontSize: 16, fontWeight: 900, cursor: "pointer",
};

const bitButtonStyle: React.CSSProperties = {
    display: "block", textAlign: "center", background: "#7c3aed", color: "#fff", textDecoration: "none",
    borderRadius: 14, padding: "14px", fontSize: 16, fontWeight: 900,
};
