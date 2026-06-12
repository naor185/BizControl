"use client";
import { useState, useRef, useEffect } from "react";
import { API, setToken } from "@/lib/api";
import { saveCustomer, type Customer } from "@/lib/auth";

interface Props {
    onClose: () => void;
    onSuccess: (c: Customer) => void;
}

type Step = "phone" | "otp" | "name";

export default function AuthModal({ onClose, onSuccess }: Props) {
    const [step, setStep] = useState<Step>("phone");
    const [phone, setPhone] = useState("");
    const [otp, setOtp] = useState(["", "", "", "", ""]);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [city, setCity] = useState("");
    const [token, setTokenState] = useState("");
    const [customerId, setCustomerId] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        if (step === "otp") otpRefs.current[0]?.focus();
    }, [step]);

    const sendOtp = async () => {
        const clean = phone.trim().replace(/[-\s]/g, "");
        if (clean.length < 9) { setErr("מספר טלפון לא תקין"); return; }
        setLoading(true); setErr(null);
        try {
            const r = await fetch(`${API}/api/marketplace/auth/request-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: clean }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "שגיאה"); }
            setStep("otp");
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setLoading(false); }
    };

    const verifyOtp = async () => {
        const code = otp.join("");
        if (code.length < 5) { setErr("הכנס את כל הספרות"); return; }
        const clean = phone.trim().replace(/[-\s]/g, "");
        setLoading(true); setErr(null);
        try {
            const r = await fetch(`${API}/api/marketplace/auth/verify-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: clean, code }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "קוד שגוי"); }
            const data = await r.json();
            setToken(data.token);
            setTokenState(data.token);
            setCustomerId(data.customer.id);

            if (data.is_new) {
                setStep("name");
            } else {
                const c: Customer = {
                    ...data.customer,
                    full_name: `${data.customer.first_name} ${data.customer.last_name}`.trim(),
                    favorites: [],
                };
                saveCustomer(c);
                onSuccess(c);
            }
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setLoading(false); }
    };

    const completeName = async () => {
        if (!firstName.trim() || !lastName.trim()) { setErr("שם פרטי ושם משפחה נדרשים"); return; }
        setLoading(true); setErr(null);
        try {
            const r = await fetch(`${API}/api/marketplace/auth/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ first_name: firstName.trim(), last_name: lastName.trim(), city: city.trim() || null }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "שגיאה"); }
            const c: Customer = {
                id: customerId,
                phone: phone.trim().replace(/[-\s]/g, ""),
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                full_name: `${firstName.trim()} ${lastName.trim()}`,
                city: city.trim() || null,
                favorites: [],
            };
            saveCustomer(c);
            onSuccess(c);
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setLoading(false); }
    };

    const handleOtpInput = (i: number, val: string) => {
        const digit = val.replace(/\D/g, "").slice(-1);
        const next = [...otp];
        next[i] = digit;
        setOtp(next);
        if (digit && i < 4) otpRefs.current[i + 1]?.focus();
    };

    const handleOtpKey = (i: number, e: React.KeyboardEvent) => {
        if (e.key === "Backspace" && !otp[i] && i > 0) {
            otpRefs.current[i - 1]?.focus();
        }
        if (e.key === "Enter") verifyOtp();
    };

    const overlay: React.CSSProperties = {
        position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex",
        alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1rem",
    };
    const box: React.CSSProperties = {
        background: "#1e293b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 24,
        padding: "2rem 1.5rem", width: "100%", maxWidth: 380,
        animation: "fadeIn .2s ease",
    };

    return (
        <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={box}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
                    <div>
                        <div style={{ fontSize: "1.4rem", fontWeight: 900 }}>
                            {step === "phone" && "כניסה / הרשמה"}
                            {step === "otp" && "אימות טלפון"}
                            {step === "name" && "ברוך הבא!"}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "0.82rem", marginTop: "0.25rem" }}>
                            {step === "phone" && "הכנס מספר טלפון לקבלת קוד"}
                            {step === "otp" && `שלחנו קוד ל-${phone}`}
                            {step === "name" && "ספר לנו קצת על עצמך"}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: "1.4rem", cursor: "pointer", padding: "0.2rem", lineHeight: 1 }}>×</button>
                </div>

                {/* Step: Phone */}
                {step === "phone" && (
                    <div>
                        <input
                            type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && sendOtp()}
                            placeholder="050-0000000" dir="ltr" autoFocus
                            style={inputStyle}
                        />
                        {err && <p style={errStyle}>{err}</p>}
                        <button onClick={sendOtp} disabled={loading} style={btnStyle}>
                            {loading ? "שולח..." : "שלח קוד אימות"}
                        </button>
                    </div>
                )}

                {/* Step: OTP */}
                {step === "otp" && (
                    <div>
                        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginBottom: "1.25rem" }} dir="ltr">
                            {otp.map((d, i) => (
                                <input
                                    key={i} ref={el => { otpRefs.current[i] = el; }}
                                    type="text" inputMode="numeric" value={d}
                                    onChange={e => handleOtpInput(i, e.target.value)}
                                    onKeyDown={e => handleOtpKey(i, e)}
                                    maxLength={1}
                                    style={{ width: 48, height: 56, textAlign: "center", fontSize: "1.5rem", fontWeight: 900, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 12, color: "#fff", outline: "none" }}
                                />
                            ))}
                        </div>
                        {err && <p style={errStyle}>{err}</p>}
                        <button onClick={verifyOtp} disabled={loading} style={btnStyle}>
                            {loading ? "מאמת..." : "אמת קוד"}
                        </button>
                        <button onClick={() => { setStep("phone"); setOtp(["","","","",""]); setErr(null); }} style={linkBtnStyle}>
                            שנה מספר טלפון
                        </button>
                    </div>
                )}

                {/* Step: Name */}
                {step === "name" && (
                    <div>
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                            <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="שם פרטי" style={{ ...inputStyle, flex: 1 }} />
                            <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="שם משפחה" style={{ ...inputStyle, flex: 1 }} />
                        </div>
                        <input value={city} onChange={e => setCity(e.target.value)} placeholder="עיר (אופציונלי)" style={{ ...inputStyle, marginBottom: "0.75rem" }} />
                        {err && <p style={errStyle}>{err}</p>}
                        <button onClick={completeName} disabled={loading} style={btnStyle}>
                            {loading ? "שומר..." : "התחל להשתמש"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)",
    borderRadius: 12, padding: "0.75rem 1rem", color: "#fff", fontSize: "1rem", outline: "none",
    marginBottom: "0.75rem",
};
const btnStyle: React.CSSProperties = {
    width: "100%", background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none",
    borderRadius: 12, color: "#fff", padding: "0.85rem", fontWeight: 800, fontSize: "0.95rem",
    cursor: "pointer",
};
const linkBtnStyle: React.CSSProperties = {
    width: "100%", background: "none", border: "none", color: "#7c3aed", fontSize: "0.82rem",
    cursor: "pointer", marginTop: "0.75rem", padding: "0.4rem",
};
const errStyle: React.CSSProperties = {
    color: "#f87171", fontSize: "0.8rem", marginBottom: "0.6rem",
};
