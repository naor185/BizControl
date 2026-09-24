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

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("he-IL");
}

// Strip at the bottom of the screen: the studio's plan and how much time is left on it. AppShell shows it
// only on the דשבורד page (/overview). During a trial it also offers buying a full plan and shows what
// each plan includes (the billing section of that page). Orange with white text; red when 7 days or
// fewer remain.
export default function PlanBar({ info }: { info: PlanInfo }) {
    const [now] = useState(() => Date.now());
    const [isNative] = useState(() => isNativeApp());

    const isTrial = info.subscription_plan === "trial";
    const days = info.plan_expires_at ? Math.ceil((new Date(info.plan_expires_at).getTime() - now) / 86_400_000) : null;
    const urgent = days !== null && days <= 7;

    let text: string;
    if (days === null) {
        text = info.plan_label;
    } else if (days < 0) {
        text = `${info.plan_label} · פג תוקף ב-${fmtDate(info.plan_expires_at as string)}`;
    } else if (isTrial) {
        text = `${info.plan_label} · ${days === 0 ? "מסתיימת היום" : `נשארו ${days} ימים`}`;
    } else {
        text = `${info.plan_label} · בתוקף עד ${fmtDate(info.plan_expires_at as string)} (${days === 0 ? "היום" : `${days} ימים`})`;
    }

    return (
        <div
            className={`fixed inset-x-0 z-30 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-0 md:right-60 border-t text-white flex md:grid md:grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pl-24 text-xs ${urgent ? "bg-rose-600 border-rose-700" : "bg-orange-600 border-orange-700"}`}
            style={{ height: PLAN_BAR_HEIGHT }}
            dir="rtl"
        >
            <span aria-hidden className="hidden md:block" />
            <span className="flex-1 md:flex-none min-w-0 text-center font-semibold truncate">{text}</span>
            <span className="flex items-center gap-3 shrink-0 md:justify-self-end">
                {isTrial && (isNative ? (
                    <span className="text-white/90">לרכישה: biz-control.com</span>
                ) : (
                    <>
                        <Link
                            href="/overview?billing=plans"
                            className={`px-3 py-1 rounded-lg bg-white font-bold no-underline hover:bg-orange-50 ${urgent ? "text-rose-700" : "text-orange-700"}`}
                        >
                            רכישת מנוי מלא
                        </Link>
                        <Link href="/overview?billing=plans" className="text-white/90 hover:text-white underline">מה כלול בכל מנוי</Link>
                    </>
                ))}
                {!isTrial && (
                    <Link href="/overview?billing=plans" className="text-white/90 hover:text-white underline">פרטי מנוי</Link>
                )}
            </span>
        </div>
    );
}
