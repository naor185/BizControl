"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { usePlan } from "@/lib/usePlan";
import { isNativeApp } from "@/lib/platform";

// A part of the system the business's plan doesn't include (owner, 2026-10-10: every plan a fixed bundle). On the
// website: what it is, locked, and the plan that has it, with a way to the plans. Inside the apps: only that it isn't
// in the plan — nothing about buying (Apple 3.1.1). `compact` for a section inside a page.
export default function PlanLock({ module, feature, compact = false, children }: {
    module: string;
    feature: string;
    compact?: boolean;
    children: React.ReactNode;
}) {
    const plan = usePlan();
    const [isNative] = useState(() => isNativeApp());
    if (!plan.ready) return null;
    if (plan.has(module)) return <>{children}</>;
    const upgrade = isNative ? null : plan.upgrade(module);
    return (
        <div className={compact
            ? "flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 md:col-span-2"
            : "max-w-md mx-auto my-10 text-center bg-white border border-slate-200 rounded-2xl p-8"}>
            <Lock className={compact ? "w-5 h-5 text-slate-400 shrink-0" : "w-8 h-8 mx-auto text-slate-400 mb-3"} aria-hidden />
            <div className={compact ? "flex-1 min-w-0" : ""}>
                <p className="font-bold text-slate-800">{feature}</p>
                <p className="text-sm text-slate-500 mt-0.5">{upgrade ? `זמין במסלול ${upgrade}.` : "לא כלול במסלול שלך."}</p>
            </div>
            {upgrade && (
                <Link href="/billing" className={`inline-block text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded-xl px-4 py-2 ${compact ? "shrink-0" : "mt-4"}`}>
                    למסלולים
                </Link>
            )}
        </div>
    );
}
