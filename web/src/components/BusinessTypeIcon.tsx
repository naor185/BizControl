"use client";

import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

// A business type's icon and colors. The icon name (Lucide) and the color come from the one list of
// business types (GET /api/public/business-types) — nothing about a type is hardcoded here.

const KNOWN = new Set<string>(iconNames);

export default function BusinessTypeIcon({ name, size = 16, color, strokeWidth = 1.75 }: {
    name?: string | null; size?: number; color?: string; strokeWidth?: number;
}) {
    const icon = (name && KNOWN.has(name) ? name : "store") as IconName;
    return <DynamicIcon name={icon} size={size} color={color} strokeWidth={strokeWidth} aria-hidden />;
}

function mix(hex: string, withHex: string, weight: number): string {
    const a = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "475569";
    const b = withHex.slice(1);
    const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
    const out = [0, 2, 4].map(i => Math.round(ch(a, i) * (1 - weight) + ch(b, i) * weight));
    return "#" + out.map(v => v.toString(16).padStart(2, "0")).join("");
}

// A card background: the type's color, a little lighter at the top.
export function typeGradient(color?: string | null): string {
    const c = color || "#475569";
    return `linear-gradient(135deg, ${mix(c, "#ffffff", 0.25)}, ${c})`;
}

// A chip: a very light tint of the type's color with the color itself for the text.
export function typeTint(color?: string | null): { bg: string; color: string } {
    const c = color || "#475569";
    return { bg: mix(c, "#ffffff", 0.88), color: c };
}
