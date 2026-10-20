"use client";

import { useState, InputHTMLAttributes } from "react";

import { tx } from "@/lib/i18n";
// Shared password field with an accessible show/hide eye toggle.
// The eye icon defaults to a dark, high-contrast slate (accessible on light
// backgrounds). On dark panels pass `iconClassName` (e.g. "text-white/70
// hover:text-white") so the icon keeps sufficient contrast.
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { iconClassName?: string };

const EYE = (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EYE_OFF = (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
);

export default function PasswordInput({ className = "", iconClassName = "text-slate-600 hover:text-slate-900", ...props }: Props) {
    const [show, setShow] = useState(false);
    return (
        // the eye and the room left for it on the same side — the field's own direction: a password typed left to right
        // (dir="ltr") on a Hebrew page had its room on the right and the eye on the left, over the password (2026-10-20)
        <div className="relative" dir={props.dir}>
            <input {...props} type={show ? "text" : "password"} className={`${className} pe-11`} />
            <button
                type="button"
                onClick={() => setShow(v => !v)}
                tabIndex={-1}
                aria-label={show ? tx("הסתר סיסמה") : tx("הצג סיסמה")}
                title={show ? tx("הסתר סיסמה") : tx("הצג סיסמה")}
                className={`absolute end-3 top-1/2 -translate-y-1/2 transition-colors ${iconClassName}`}
            >
                {show ? EYE_OFF : EYE}
            </button>
        </div>
    );
}
