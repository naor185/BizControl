"use client";

// ויקי — everyone's personal assistant, a toy-brick figure that moves (the owner, 2026-10-16: "she looks like Lego, a
// real animated character that moves, not a talking sticker"). Drawn inline and moved by CSS (globals.css, "ויקי"):
// she breathes, blinks and tilts her head; "wave" — she waves hello; "talk" — her mouth moves while she has something to
// say. "head" — her face in a circle (the button, the guide); "full" — all of her (when she pops in). Still for anyone
// who asked the system for less motion.
import { useId } from "react";

export type VikiPose = "idle" | "wave" | "talk";

export default function Viki({ size = 120, crop = "full", pose = "idle", still = false, className = "" }: {
    size?: number;                 // the height (full) or the circle (head)
    crop?: "full" | "head";
    pose?: VikiPose;
    still?: boolean;               // only blinking — for a small face that sits on the screen
    className?: string;
}) {
    const id = useId().replace(/[^a-zA-Z0-9]/g, "");
    const head = crop === "head";
    return (
        <svg
            viewBox={head ? "26 8 68 68" : "0 0 120 170"}
            width={head ? size : Math.round(size * 120 / 170)} height={size}
            className={`viki viki--${pose} ${still ? "viki--still" : ""} ${className}`}
            role="img" aria-label="ויקי"
        >
            <defs>
                <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#ffe36b" /><stop offset=".45" stopColor="#ffd21f" /><stop offset="1" stopColor="#e5ac00" />
                </linearGradient>
                <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#0369a1" />
                </linearGradient>
                <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#155e8a" /><stop offset="1" stopColor="#0b3d5c" />
                </linearGradient>
                <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#bae6fd" /><stop offset="1" stopColor="#38bdf8" />
                </linearGradient>
                <clipPath id={`${id}c`}><circle cx="60" cy="42" r="34" /></clipPath>
            </defs>

            <g clipPath={head ? `url(#${id}c)` : undefined}>
                {head && <rect x="20" y="0" width="80" height="90" fill={`url(#${id}bg)`} />}
                {!head && <ellipse cx="60" cy="164" rx="27" ry="4" fill="#0f172a" opacity=".14" />}

                <g className="viki-body">
                    {/* legs and hips */}
                    <rect x="32" y="117" width="27" height="38" rx="2" fill={`url(#${id}l)`} />
                    <rect x="61" y="117" width="27" height="38" rx="2" fill={`url(#${id}l)`} />
                    <rect x="31" y="151" width="29" height="8" rx="2.5" fill="#082f49" />
                    <rect x="60" y="151" width="29" height="8" rx="2.5" fill="#082f49" />
                    <rect x="31" y="109" width="58" height="9" rx="2" fill="#1e3a5f" />

                    {/* the arm that hangs */}
                    <g className="viki-arm-l">
                        <path d="M40 69 29 96" stroke="#0ea5e9" strokeWidth="11" strokeLinecap="round" />
                        <circle cx="27.4" cy="101.5" r="4.4" fill="none" stroke="#ffd21f" strokeWidth="4.2" strokeDasharray="20.5 7.1" transform="rotate(135 27.4 101.5)" />
                    </g>

                    {/* the shirt — the system's blue, a chart going up */}
                    <path d="M38.5 66h43l7.5 44h-58z" fill={`url(#${id}t)`} />
                    <path d="M52 66 60 74 68 66" fill="none" stroke="#e0f2fe" strokeWidth="2" strokeLinejoin="round" />
                    <rect x="51" y="95" width="4.2" height="8" rx="1" fill="#fff" opacity=".9" />
                    <rect x="57.4" y="90" width="4.2" height="13" rx="1" fill="#fff" opacity=".9" />
                    <rect x="63.8" y="85" width="4.2" height="18" rx="1" fill="#fff" opacity=".9" />
                    <path d="M49.5 88.5 56 83l4.5 2.8 8.5-7.6" fill="none" stroke="#fef08a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                    {/* the arm that waves */}
                    <g className="viki-arm-r">
                        <path d="M80 69 91 96" stroke="#0ea5e9" strokeWidth="11" strokeLinecap="round" />
                        <circle cx="92.6" cy="101.5" r="4.4" fill="none" stroke="#ffd21f" strokeWidth="4.2" strokeDasharray="20.5 7.1" transform="rotate(135 92.6 101.5)" />
                    </g>

                    <rect x="53" y="60" width="14" height="7" fill="#e5ac00" />

                    {/* the head */}
                    <g className="viki-head">
                        <path d="M33 30c0-12 11-19 27-19s27 7 27 19v26c0 3-2 5-5 5H38c-3 0-5-2-5-5z" fill="#6b3f1f" />
                        <rect x="38" y="21" width="44" height="41" rx="11" fill={`url(#${id}h)`} />
                        <g className="viki-eyes">
                            <ellipse cx="51" cy="45" rx="2.5" ry="3.3" fill="#1f2937" />
                            <ellipse cx="69" cy="45" rx="2.5" ry="3.3" fill="#1f2937" />
                            <circle cx="51.9" cy="43.8" r=".85" fill="#fff" />
                            <circle cx="69.9" cy="43.8" r=".85" fill="#fff" />
                        </g>
                        <path d="M46.6 39c1.6-1.4 4-1.6 5.8-.4M67.6 38.6c1.8-1.2 4.2-1 5.8.4" stroke="#5b3a1f" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                        <ellipse cx="45" cy="51.5" rx="3" ry="1.8" fill="#fb923c" opacity=".4" />
                        <ellipse cx="75" cy="51.5" rx="3" ry="1.8" fill="#fb923c" opacity=".4" />
                        <path className="viki-smile" d="M52.6 53.6c4.2 4 10.6 4 14.8 0" stroke="#7c2d12" strokeWidth="2" strokeLinecap="round" fill="none" />
                        <ellipse className="viki-mouth-open" cx="60" cy="55.8" rx="4.2" ry="2.8" fill="#7c2d12" />
                        <path d="M37.5 34c1-10.5 10-16.5 22.5-16.5S81.5 23.5 82.5 34c-7-1.5-14.5-5-19.5-10-4.5 6-13.5 9.5-25.5 10z" fill="#7c4a24" />
                        <path d="M45 22.5c4-2.6 9-3.6 14-3.4" stroke="#a16207" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".7" />
                        {/* the headset — the assistant */}
                        <path d="M35 40c0-14 11-22 25-22s25 8 25 22" stroke="#1e293b" strokeWidth="3.4" fill="none" strokeLinecap="round" />
                        <rect x="31.5" y="36" width="7" height="13" rx="3" fill="#1e293b" />
                        <rect x="81.5" y="36" width="7" height="13" rx="3" fill="#1e293b" />
                        <path d="M35 48.5c0 6 3.5 9.5 10.5 9.5" stroke="#1e293b" strokeWidth="2" fill="none" strokeLinecap="round" />
                        <circle cx="46.5" cy="58" r="2.4" fill="#38bdf8" />
                    </g>
                </g>
            </g>
        </svg>
    );
}
