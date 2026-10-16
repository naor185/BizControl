// ויקי — the face of the guide (the owner, 2026-10-16: "instead of the question mark, an avatar tied to the system — she
// takes you through the steps, she's everyone's personal assistant, her name is Viki"). The system's blues, a headset.
// Drawn inline so it stays sharp at any size and needs nothing to load; each copy has its own ids (a hidden copy
// holding the shared ones would blank the others).
import { useId } from "react";

export default function VikiAvatar({ size = 36, className = "" }: { size?: number; className?: string }) {
    const id = useId().replace(/[^a-zA-Z0-9]/g, "");
    return (
        <svg width={size} height={size} viewBox="6 7 52 52" className={className} role="img" aria-label="ויקי">
            <defs>
                <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#7dd3fc" />
                    <stop offset="1" stopColor="#0284c7" />
                </linearGradient>
                <clipPath id={`${id}r`}><circle cx="32" cy="33" r="26" /></clipPath>
            </defs>
            <g clipPath={`url(#${id}r)`}>
                <rect width="64" height="64" fill={`url(#${id}bg)`} />
                {/* hair, behind */}
                <path d="M17 31c0-11 6.5-18.5 15-18.5S47 20 47 31v13c0 2-1.5 3.5-3.5 3.5h-23C18.5 47.5 17 46 17 44z" fill="#3b2314" />
                {/* shoulders — a navy top with an open collar */}
                <path d="M8 66c1-11 9.5-16.5 24-16.5S55 55 56 66z" fill="#0c4a6e" />
                <path d="M26.5 49.8 32 57l5.5-7.2z" fill="#f2c4a0" />
                <circle cx="41.5" cy="55" r="2.2" fill="#38bdf8" />
                {/* neck */}
                <path d="M28 41h8v9.5c-1.2 1.6-2.6 2.4-4 2.4s-2.8-.8-4-2.4z" fill="#e7b48f" />
                {/* face */}
                <ellipse cx="32" cy="30.5" rx="11.5" ry="13" fill="#f5cba7" />
                {/* hair, the fringe */}
                <path d="M20.5 29c.5-8 5.5-13.2 11.8-13.2 5.8 0 10.6 4.4 11.4 11.6-4.2-.6-8.6-2.6-11.6-6.2-2.4 4-6.6 6.8-11.6 7.8z" fill="#4a2c19" />
                {/* brows, eyes, cheeks, smile */}
                <path d="M25.6 27.6c1.1-.9 2.6-1 3.8-.3M34.6 27.3c1.2-.7 2.7-.6 3.8.3" stroke="#3b2314" strokeWidth="1.1" strokeLinecap="round" fill="none" />
                <ellipse cx="27.6" cy="31" rx="1.55" ry="1.8" fill="#1e293b" />
                <ellipse cx="36.4" cy="31" rx="1.55" ry="1.8" fill="#1e293b" />
                <circle cx="28.1" cy="30.4" r=".5" fill="#fff" />
                <circle cx="36.9" cy="30.4" r=".5" fill="#fff" />
                <ellipse cx="24.8" cy="35.4" rx="2.1" ry="1.3" fill="#fb7185" opacity=".35" />
                <ellipse cx="39.2" cy="35.4" rx="2.1" ry="1.3" fill="#fb7185" opacity=".35" />
                <path d="M28.6 36.6c1.9 2 4.9 2 6.8 0" stroke="#9f1239" strokeWidth="1.3" strokeLinecap="round" fill="none" />
                {/* the headset — the assistant */}
                <path d="M19.2 31.5c0-9 5.8-15.6 12.8-15.6S44.8 22.5 44.8 31.5" stroke="#0f172a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <rect x="16.4" y="28.2" width="5" height="7.6" rx="2.3" fill="#0f172a" />
                <rect x="42.6" y="28.2" width="5" height="7.6" rx="2.3" fill="#0f172a" />
                <path d="M19 35.6c0 4.2 2.6 6.4 6.6 6.4" stroke="#0f172a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <circle cx="26.4" cy="42" r="1.7" fill="#38bdf8" />
            </g>
        </svg>
    );
}
