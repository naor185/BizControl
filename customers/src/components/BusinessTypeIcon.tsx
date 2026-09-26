"use client";

import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

// A business type's icon. The icon name (Lucide) comes from the one list of
// business types (GET /api/public/business-types) — nothing about a type is hardcoded here.

const KNOWN = new Set<string>(iconNames);

export default function BusinessTypeIcon({ name, size = 16, color, strokeWidth = 1.75 }: {
    name?: string | null; size?: number; color?: string; strokeWidth?: number;
}) {
    const icon = (name && KNOWN.has(name) ? name : "store") as IconName;
    return <DynamicIcon name={icon} size={size} color={color} strokeWidth={strokeWidth} aria-hidden />;
}
