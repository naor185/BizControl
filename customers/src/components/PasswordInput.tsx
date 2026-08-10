"use client";

import { useState, CSSProperties, InputHTMLAttributes } from "react";

// Shared password field with an accessible show/hide eye toggle.
// The eye icon defaults to a dark, high-contrast slate (accessible on the
// light card backgrounds used across BizFind). Pass `iconColor` to override
// (e.g. a light color on a dark background).
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { iconColor?: string };

const EYE = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EYE_OFF = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
);

export default function PasswordInput({ style, iconColor = "#334155", ...props }: Props) {
    const [show, setShow] = useState(false);
    const s = (style || {}) as CSSProperties;
    // Move outer margins to the wrapper so the eye stays vertically centered on the input.
    const { margin, marginBottom, marginTop, marginInline, ...inputRest } = s;
    return (
        <div style={{ position: "relative", margin, marginBottom, marginTop, marginInline }}>
            <input {...props} type={show ? "text" : "password"} style={{ ...inputRest, paddingLeft: "2.8rem" }} />
            <button
                type="button"
                onClick={() => setShow(v => !v)}
                tabIndex={-1}
                aria-label={show ? "הסתר סיסמה" : "הצג סיסמה"}
                title={show ? "הסתר סיסמה" : "הצג סיסמה"}
                style={{
                    position: "absolute", left: "0.85rem", top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", padding: 0, cursor: "pointer", color: iconColor,
                    display: "flex", alignItems: "center", lineHeight: 0,
                }}
            >
                {show ? EYE_OFF : EYE}
            </button>
        </div>
    );
}
