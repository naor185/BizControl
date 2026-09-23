"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Eye, Rocket, Target, type LucideIcon } from "lucide-react";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "/overview", label: "חשיפה בשוק",  icon: Eye },
    { href: "/setup",    label: "הקמת העסק",   icon: Rocket },
    { href: "/leads",    label: "לידים",       icon: Target },
];

// Shared tab bar for the "דשבורד" category, rendered at the top of each page in it.
export default function DashboardTabs() {
    const pathname = usePathname();
    return (
        <div className="overflow-x-auto">
            <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
                {TABS.map(t => {
                    const active = pathname === t.href;
                    const Icon = t.icon;
                    return (
                        <Link
                            key={t.href}
                            href={t.href}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${active ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                        >
                            <Icon className="h-4 w-4" />
                            {t.label}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
