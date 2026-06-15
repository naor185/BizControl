"use client";
import { useState, useRef, useEffect } from "react";
import { API, setToken } from "@/lib/api";
import { saveCustomer, type Customer } from "@/lib/auth";

interface Props {
    onClose: () => void;
    onSuccess: (c: Customer) => void;
}

type Mode = "otp" | "email";
type OtpStep = "phone" | "otp" | "name";
type EmailStep = "login" | "register";

export default function AuthModal({ onClose, onSuccess }: Props) {
    const [mode, setMode] = useState<Mode>("otp");

    // OTP flow
    const [otpStep, setOtpStep] = useState<OtpStep>("phone");
    const [phone, setPhone] = useState("");
    const [otp, setOtp] = useState(["", "", "", "", ""]);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [city, setCity] = useState("");
    const [otpToken, setOtpToken] = useState("");
    const [customerId, setCustomerId] = useState("");
    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Email flow
    const [emailStep, setEmailStep] = useState<EmailStep>("login");
    const [emailField, setEmailField] = useState("");
    const [password, setPassword] = useState("");
    const [regFirstName, setRegFirstName] = useState("");
    const [regLastName, setRegLastName] = useState("");
    const [regPhone, setRegPhone] = useState("");
    const [regCity, setRegCity] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (otpStep === "otp") otpRefs.current[0]?.focus();
    }, [otpStep]);

    // Try to auto-fill from browser credential manager (enables FaceID/TouchID auto-fill)
    useEffect(() => {
        if (mode !== "email" || emailStep !== "login") return;
        if (!("credentials" in navigator)) return;
        (navigator.credentials.get as Function)({ password: true })
            .then((cred: { id?: string; password?: string } | null) => {
                if (cred?.id) setEmailField(cred.id);
                if (cred && "password" in cred && (cred as { password?: string }).password) {
                    setPassword((cred as { password: string }).password);
                }
            })
            .catch(() => {});
    }, [mode, emailStep]);

    // ── OTP helpers ──────────────────────────────────────────────────────────

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
            setOtpStep("otp");
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
            setOtpToken(data.token);
            setCustomerId(data.customer.id);
            if (data.is_new) {
                setOtpStep("name");
            } else {
                _finish(data.customer, data.token);
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
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${otpToken}` },
                body: JSON.stringify({ first_name: firstName.trim(), last_name: lastName.trim(), city: city.trim() || null }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "שגיאה"); }
            _finish({
                id: customerId,
                phone: phone.trim().replace(/[-\s]/g, ""),
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                full_name: `${firstName.trim()} ${lastName.trim()}`,
                city: city.trim() || null,
            }, otpToken);
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
        if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
        if (e.key === "Enter") verifyOtp();
    };

    // ── Email helpers ─────────────────────────────────────────────────────────

    const loginEmail = async () => {
        if (!emailField.trim() || !password) { setErr("הכנס אימייל וסיסמה"); return; }
        setLoading(true); setErr(null);
        try {
            const r = await fetch(`${API}/api/marketplace/auth/login-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: emailField.trim(), password }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "שגיאה"); }
            const data = await r.json();
            setToken(data.token);
            await _storeCredential(emailField.trim(), password, data.customer.full_name);
            _finish(data.customer, data.token);
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setLoading(false); }
    };

    const registerEmail = async () => {
        if (!emailField.trim() || !password) { setErr("הכנס אימייל וסיסמה"); return; }
        if (!regFirstName.trim() || !regLastName.trim()) { setErr("שם פרטי ושם משפחה נדרשים"); return; }
        setLoading(true); setErr(null);
        try {
            const r = await fetch(`${API}/api/marketplace/auth/register-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: emailField.trim(),
                    password,
                    first_name: regFirstName.trim(),
                    last_name: regLastName.trim(),
                    phone: regPhone.trim().replace(/[-\s]/g, "") || null,
                    city: regCity.trim() || null,
                }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "שגיאה"); }
            const data = await r.json();
            setToken(data.token);
            await _storeCredential(emailField.trim(), password, data.customer.full_name);
            _finish(data.customer, data.token);
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setLoading(false); }
    };

    // Store in browser credential manager (triggers FaceID/TouchID on mobile)
    const _storeCredential = async (id: string, pwd: string, name: string) => {
        if (!("PasswordCredential" in window)) return;
        try {
            const cred = new (window as { PasswordCredential: new (d: object) => object }).PasswordCredential(
                { id, password: pwd, name }
            );
            await navigator.credentials.store(cred as Credential);
        } catch {}
    };

    const _finish = (customerData: Partial<Customer> & { id: string }, _tok?: string) => {
        const c: Customer = {
            id: customerData.id,
            phone: customerData.phone || "",
            first_name: customerData.first_name || "",
            last_name: customerData.last_name || "",
            full_name: customerData.full_name || `${customerData.first_name || ""} ${customerData.last_name || ""}`.trim(),
            city: customerData.city || null,
            favorites: [],
        };
        saveCustomer(c);
        onSuccess(c);
    };

    // ── Title helpers ─────────────────────────────────────────────────────────

    const getTitle = () => {
        if (mode === "otp") {
            if (otpStep === "phone") return "כניסה / הרשמה";
            if (otpStep === "otp") return "אימות טלפון";
            return "ברוך הבא!";
        }
        return emailStep === "login" ? "כניסה עם אימייל" : "הרשמה חדשה";
    };

    const getSubtitle = () => {
        if (mode === "otp") {
            if (otpStep === "phone") return "הכנס מספר טלפון לקבלת קוד";
            if (otpStep === "otp") return `שלחנו קוד ל-${phone}`;
            return "ספר לנו קצת על עצמך";
        }
        return emailStep === "login" ? "הכנס אימייל וסיסמה" : "צור חשבון חדש";
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={box}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
                    <div>
                        <div style={{ fontSize: "1.4rem", fontWeight: 900 }}>{getTitle()}</div>
                        <div style={{ color: "#64748b", fontSize: "0.82rem", marginTop: "0.2rem" }}>{getSubtitle()}</div>
                    </div>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: "1.4rem", cursor: "pointer", padding: "0.2rem", lineHeight: 1 }}>×</button>
                </div>

                {/* Mode tabs — only on first step */}
                {(otpStep === "phone" || (mode === "email" && emailStep !== "register")) && otpStep !== "otp" && otpStep !== "name" && (
                    <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.25rem", background: "rgba(255,255,255,.05)", borderRadius: 12, padding: "0.25rem" }}>
                        <button
                            onClick={() => { setMode("otp"); setErr(null); }}
                            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", transition: "all .2s",
                                background: mode === "otp" ? "rgba(124,58,237,.8)" : "transparent",
                                color: mode === "otp" ? "#fff" : "#64748b" }}
                        >
                            📱 קוד בוואטסאפ
                        </button>
                        <button
                            onClick={() => { setMode("email"); setEmailStep("login"); setErr(null); }}
                            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", transition: "all .2s",
                                background: mode === "email" ? "rgba(124,58,237,.8)" : "transparent",
                                color: mode === "email" ? "#fff" : "#64748b" }}
                        >
                            ✉️ אימייל וסיסמה
                        </button>
                    </div>
                )}

                {/* OTP: Phone */}
                {mode === "otp" && otpStep === "phone" && (
                    <div>
                        <input
                            type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && sendOtp()}
                            placeholder="050-0000000" dir="ltr" autoFocus style={inputStyle}
                        />
                        {err && <p style={errStyle}>{err}</p>}
                        <button onClick={sendOtp} disabled={loading} style={btnStyle}>
                            {loading ? "שולח..." : "שלח קוד אימות"}
                        </button>
                    </div>
                )}

                {/* OTP: Code */}
                {mode === "otp" && otpStep === "otp" && (
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
                        <button onClick={() => { setOtpStep("phone"); setOtp(["","","","",""]); setErr(null); }} style={linkBtnStyle}>
                            שנה מספר טלפון
                        </button>
                    </div>
                )}

                {/* OTP: Name (new user) */}
                {mode === "otp" && otpStep === "name" && (
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

                {/* Email: Login */}
                {mode === "email" && emailStep === "login" && (
                    <div>
                        <input
                            type="email" value={emailField} onChange={e => setEmailField(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && loginEmail()}
                            placeholder="אימייל" dir="ltr" autoComplete="email" autoFocus style={inputStyle}
                        />
                        <div style={{ position: "relative", marginBottom: "0.75rem" }}>
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password} onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && loginEmail()}
                                placeholder="סיסמה" dir="ltr" autoComplete="current-password"
                                style={{ ...inputStyle, marginBottom: 0, paddingLeft: "2.8rem" }}
                            />
                            <button
                                type="button" onClick={() => setShowPassword(v => !v)}
                                style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "1rem", padding: 0 }}
                            >
                                {showPassword ? "🙈" : "👁️"}
                            </button>
                        </div>
                        {err && <p style={errStyle}>{err}</p>}
                        <button onClick={loginEmail} disabled={loading} style={btnStyle}>
                            {loading ? "מתחבר..." : "התחבר"}
                        </button>
                        <button onClick={() => { setEmailStep("register"); setErr(null); }} style={linkBtnStyle}>
                            אין לך חשבון? הרשמה
                        </button>
                    </div>
                )}

                {/* Email: Register */}
                {mode === "email" && emailStep === "register" && (
                    <div>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                            <input value={regFirstName} onChange={e => setRegFirstName(e.target.value)} placeholder="שם פרטי" style={{ ...inputStyle, flex: 1 }} />
                            <input value={regLastName} onChange={e => setRegLastName(e.target.value)} placeholder="שם משפחה" style={{ ...inputStyle, flex: 1 }} />
                        </div>
                        <input
                            type="email" value={emailField} onChange={e => setEmailField(e.target.value)}
                            placeholder="אימייל" dir="ltr" autoComplete="email" style={inputStyle}
                        />
                        <div style={{ position: "relative", marginBottom: "0.75rem" }}>
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password} onChange={e => setPassword(e.target.value)}
                                placeholder="סיסמה (לפחות 6 תווים)" dir="ltr" autoComplete="new-password"
                                style={{ ...inputStyle, marginBottom: 0, paddingLeft: "2.8rem" }}
                            />
                            <button
                                type="button" onClick={() => setShowPassword(v => !v)}
                                style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "1rem", padding: 0 }}
                            >
                                {showPassword ? "🙈" : "👁️"}
                            </button>
                        </div>
                        <input value={regPhone} onChange={e => setRegPhone(e.target.value)} placeholder="טלפון (אופציונלי)" type="tel" dir="ltr" style={inputStyle} />
                        <input value={regCity} onChange={e => setRegCity(e.target.value)} placeholder="עיר (אופציונלי)" style={inputStyle} />
                        {err && <p style={errStyle}>{err}</p>}
                        <button onClick={registerEmail} disabled={loading} style={btnStyle}>
                            {loading ? "יוצר חשבון..." : "הרשמה"}
                        </button>
                        <button onClick={() => { setEmailStep("login"); setErr(null); }} style={linkBtnStyle}>
                            כבר יש לך חשבון? התחבר
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1rem",
};
const box: React.CSSProperties = {
    background: "#1e293b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 24,
    padding: "2rem 1.5rem", width: "100%", maxWidth: 380, maxHeight: "90vh", overflowY: "auto",
};
const inputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)",
    borderRadius: 12, padding: "0.75rem 1rem", color: "#fff", fontSize: "1rem", outline: "none",
    marginBottom: "0.75rem", boxSizing: "border-box",
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
