"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, BellOff, Crown, Lock, Smartphone, Users, type LucideIcon } from "lucide-react";
import { getCurrentUserRole } from "@/lib/api";
import { isNativeApp } from "@/lib/platform";
import { usePlan } from "@/lib/usePlan";

type TabDef = {
    href: string;
    label: string;
    icon: LucideIcon;
    isActive: (pathname: string, tab: string | null) => boolean;
    managersOnly?: boolean;
    module?: string;            // in the business's plan — otherwise locked (website) or not shown (apps)
};

const TABS: TabDef[] = [
    { href: "/clients",           label: "לקוחות",        icon: Users,      isActive: (p, t) => p === "/clients" && t !== "club" },
    { href: "/clients?tab=club",  label: "מועדון לקוחות", icon: Crown,      isActive: (p, t) => p === "/clients" && t === "club", module: "customer_club" },
    { href: "/clients/analytics", label: "אנליטיקה",      icon: BarChart3,  isActive: p => p === "/clients/analytics", managersOnly: true },
    { href: "/clients/marketing-optouts", label: "הוסרו מהודעות", icon: BellOff, isActive: p => p === "/clients/marketing-optouts", managersOnly: true },
    { href: "/wallet",            label: "כרטיס דיגיטלי", icon: Smartphone, isActive: p => p === "/wallet", managersOnly: true, module: "wallet" },
];

function ClientsTabsInner({ clubCount }: { clubCount?: number }) {
    const pathname = usePathname();
    const tab = useSearchParams().get("tab");
    const [role] = useState(() => getCurrentUserRole());
    const isFieldStaff = role === "artist" || role === "staff";
    const plan = usePlan();
    const [isNative] = useState(() => isNativeApp());

    return (
        <div className="overflow-x-auto">
            <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
                {TABS.filter(t => !(t.managersOnly && isFieldStaff) && !(t.module && isNative && !plan.has(t.module))).map(t => {
                    const active = t.isActive(pathname, tab);
                    const Icon = t.module && !plan.has(t.module) ? Lock : t.icon;
                    return (
                        <Link
                            key={t.href}
                            href={t.href}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${active ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                        >
                            <Icon className="h-4 w-4" />
                            {t.label}
                            {t.href === "/clients?tab=club" && (clubCount ?? 0) > 0 && (
                                <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">{clubCount}</span>
                            )}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

// One shared tab bar for everything client-related, rendered at the top of each
// page in the area (list/club, leads, analytics, wallet card).
export default function ClientsTabs({ clubCount }: { clubCount?: number }) {
    return (
        <Suspense fallback={<div className="h-11" />}>
            <ClientsTabsInner clubCount={clubCount} />
        </Suspense>
    );
}
