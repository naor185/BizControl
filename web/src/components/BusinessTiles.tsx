"use client";

// "ניהול עסק" on the phone — small buttons, three to a row, every tool once (lib/businessSections, in its groups'
// order, one grid so the rows are full), with the two overview pages and logging out (the owner, 2026-10-15: "the
// buttons, not the long list"). The bar's sheet (BottomNav) and the /business page on a phone both show it.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Compass, LayoutDashboard, Lock, LogOut, type LucideIcon } from "lucide-react";
import { clearToken } from "@/lib/api";
import { useBusinessSections } from "@/lib/businessSections";
import { useNewLeadsCount } from "@/lib/useNewLeadsCount";

function Tile({ href, label, icon: Icon, badge = 0, locked = false, onNavigate }: {
    href: string; label: string; icon: LucideIcon; badge?: number; locked?: boolean; onNavigate?: () => void;
}) {
    const pathname = usePathname();
    const active = pathname === href || pathname?.startsWith(href.split("?")[0] + "/");
    return (
        <Link href={href} onClick={onNavigate}
            className={`relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl text-center transition-all active:scale-95 ${
                active ? "bg-sky-600 text-white shadow-md" : "bg-gray-50 text-gray-700 hover:bg-sky-50"}`}>
            <Icon className="w-6 h-6" aria-hidden />
            <span className="text-[11px] font-semibold leading-tight">{label}</span>
            {badge > 0 && (
                <span className="absolute top-1.5 left-1.5 bg-rose-500 text-white text-[9px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1">
                    {badge > 99 ? "99+" : badge}
                </span>
            )}
            {locked && <Lock className="absolute top-1.5 left-1.5 w-3 h-3 text-gray-400" aria-label="לא במסלול" />}
        </Link>
    );
}

export default function BusinessTiles({ active = true, onNavigate }: { active?: boolean; onNavigate?: () => void }) {
    const { groups, plan } = useBusinessSections(active);
    const newLeadsCount = useNewLeadsCount();
    const router = useRouter();

    return (
        <div className="space-y-4" dir="rtl">
            <div className="grid grid-cols-3 gap-2.5">
                <Tile href="/overview" label="סקירה" icon={Compass} badge={newLeadsCount} onNavigate={onNavigate} />
                <Tile href="/dashboard" label="לוח בקרה" icon={LayoutDashboard} onNavigate={onNavigate} />
                {groups.flatMap(group => group.items).map(item => (
                    <Tile key={item.href} href={item.href} label={item.label} icon={item.icon}
                        locked={!!item.module && !plan.has(item.module)} onNavigate={onNavigate} />
                ))}
            </div>

            <button type="button" onClick={() => { clearToken(); router.replace("/login"); }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-600 text-sm font-semibold active:scale-[0.98] transition-transform">
                <LogOut className="w-5 h-5" aria-hidden /> התנתקות
            </button>
        </div>
    );
}
