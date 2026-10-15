"use client";

import { useState } from "react";
import Link from "next/link";
import { isNativeApp } from "@/lib/platform";

export type PlanInfo = {
    subscription_plan: string;
    plan_label: string;
    plan_expires_at: string | null;
};

// Height of the bar — AppShell reserves the same amount of room so it never covers page content.
export const PLAN_BAR_HEIGHT = "2.25rem";

export const isTrialPlan = (info: PlanInfo | null) => info?.subscription_plan === "trial";

// Strip at the bottom of לוח בקרה (/dashboard) — for a business on the free trial only (the owner, 2026-10-15: a paid
// plan's "בתוקף עד" doesn't belong there): how many days are left, and renewing now, before it ends, on the
// subscription's screen (/billing). Orange with white text; red when 7 days or fewer remain. Not a buying link inside
// the apps (Apple: no buying outside the app from it).
export default function PlanBar({ info }: { info: PlanInfo }) {
    const [now] = useState(() => Date.now());
    const [isNative] = useState(() => isNativeApp());

    const days = info.plan_expires_at ? Math.ceil((new Date(info.plan_expires_at).getTime() - now) / 86_400_000) : null;
    const urgent = days !== null && days <= 7;
    const text = days === null ? info.plan_label
        : days < 0 ? "תקופת הניסיון הסתיימה"
        : days === 0 ? "תקופת הניסיון מסתיימת היום"
        : days === 1 ? "תקופת הניסיון · נשאר יום אחד"
        : `תקופת הניסיון · נשארו ${days} ימים`;

    return (
        <div
            data-tour="plan-bar"
            className={`fixed inset-x-0 z-30 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-0 md:right-60 border-t text-white flex md:grid md:grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pl-24 text-xs ${urgent ? "bg-rose-600 border-rose-700" : "bg-orange-600 border-orange-700"}`}
            style={{ height: PLAN_BAR_HEIGHT }}
            dir="rtl"
        >
            <span aria-hidden className="hidden md:block" />
            <span className="flex-1 md:flex-none min-w-0 text-center font-semibold truncate">{text}</span>
            <span className="flex items-center gap-3 shrink-0 md:justify-self-end">
                {!isNative && (
                    <Link
                        href="/billing"
                        className={`px-3 py-1 rounded-lg bg-white font-bold no-underline hover:bg-orange-50 ${urgent ? "text-rose-700" : "text-orange-700"}`}
                    >
                        חידוש מנוי
                    </Link>
                )}
            </span>
        </div>
    );
}
