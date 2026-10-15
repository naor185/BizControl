"use client";

// "ניהול עסק" on the phone — the categories (lib/businessSections), each opening its screens as small buttons, and a
// search over every screen (the owner, 2026-10-15: "a clean menu, eight tiles, each opens its screens"). A category with
// one screen opens it straight. What shows follows the plan and, for a manager, what the owner allowed. The bar's sheet
// (BottomNav) and the /business page on a phone both show it.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, Lock, LogOut, Search, X, type LucideIcon } from "lucide-react";
import { clearToken } from "@/lib/api";
import { useBusinessSections, type BusinessItem } from "@/lib/businessSections";
import { useNewLeadsCount } from "@/lib/useNewLeadsCount";

function Tile({ item, badge = 0, locked = false, onNavigate }: {
    item: BusinessItem; badge?: number; locked?: boolean; onNavigate?: () => void;
}) {
    const pathname = usePathname();
    const path = item.href.split("?")[0];
    const active = pathname === path || pathname?.startsWith(path + "/");
    return (
        <Link href={item.href} onClick={onNavigate}
            className={`relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl text-center transition-all active:scale-95 ${
                active ? "bg-sky-600 text-white shadow-md" : "bg-gray-50 text-gray-700 hover:bg-sky-50"}`}>
            <item.icon className="w-6 h-6" aria-hidden />
            <span className="text-[11px] font-semibold leading-tight">{item.label}</span>
            {badge > 0 && (
                <span className="absolute top-1.5 left-1.5 bg-rose-500 text-white text-[9px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1">
                    {badge > 99 ? "99+" : badge}
                </span>
            )}
            {locked && <Lock className="absolute top-1.5 left-1.5 w-3 h-3 text-gray-400" aria-label="לא במסלול" />}
        </Link>
    );
}

function CategoryTile({ label, icon: Icon, count, badge, onOpen }: {
    label: string; icon: LucideIcon; count: number; badge: number; onOpen: () => void;
}) {
    return (
        <button type="button" onClick={onOpen}
            className="relative flex flex-col items-start gap-2 p-3.5 rounded-2xl bg-gray-50 hover:bg-sky-50 text-right transition-all active:scale-[0.97]">
            <Icon className="w-6 h-6 text-sky-600" aria-hidden />
            <span className="text-sm font-bold text-gray-800 leading-tight">{label}</span>
            <span className="text-[11px] text-gray-500">{count === 1 ? "מסך אחד" : `${count} מסכים`}</span>
            {badge > 0 && <span className="absolute top-3 left-3 w-2.5 h-2.5 rounded-full bg-rose-500" aria-label="יש חדש" />}
        </button>
    );
}

export default function BusinessTiles({ active = true, onNavigate }: { active?: boolean; onNavigate?: () => void }) {
    const { groups, plan } = useBusinessSections(active);
    const newLeadsCount = useNewLeadsCount();
    const router = useRouter();
    const [open, setOpen] = useState<string | null>(null);      // the category shown
    const [query, setQuery] = useState("");

    const badgeOf = (item: BusinessItem) => (item.href === "/overview" ? newLeadsCount : 0);
    const lockedOf = (item: BusinessItem) => !!item.module && !plan.has(item.module);
    const go = (item: BusinessItem) => { onNavigate?.(); router.push(item.href); };

    const q = query.trim();
    const found = q ? groups.flatMap(g => g.items).filter(i => i.label.includes(q) || i.description.includes(q)) : [];
    const category = open ? groups.find(g => g.groupLabel === open) : undefined;

    return (
        <div className="space-y-4" dir="rtl">
            <label className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-3 h-11 focus-within:border-sky-400">
                <Search className="w-4 h-4 text-gray-400 shrink-0" aria-hidden />
                <input value={query} onChange={e => { setQuery(e.target.value); setOpen(null); }} placeholder="חיפוש מסך…"
                    className="flex-1 min-w-0 bg-transparent outline-none text-base" aria-label="חיפוש מסך" />
                {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label="ניקוי החיפוש" className="p-1 text-gray-400">
                        <X className="w-4 h-4" aria-hidden />
                    </button>
                )}
            </label>

            {q ? (
                found.length ? (
                    <div className="grid grid-cols-3 gap-2.5">
                        {found.map(item => <Tile key={item.href} item={item} badge={badgeOf(item)} locked={lockedOf(item)} onNavigate={onNavigate} />)}
                    </div>
                ) : (
                    <p className="text-center text-sm text-gray-500 py-6">לא נמצא מסך בשם הזה</p>
                )
            ) : category ? (
                <div className="space-y-3">
                    <button type="button" onClick={() => setOpen(null)}
                        className="flex items-center gap-1.5 text-sm font-bold text-sky-700">
                        <ChevronRight className="w-4 h-4" aria-hidden /> כל הקטגוריות
                    </button>
                    <div className="flex items-center gap-2">
                        <category.icon className="w-5 h-5 text-sky-600" aria-hidden />
                        <span className="text-base font-black text-gray-800">{category.groupLabel}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {category.items.map(item => <Tile key={item.href} item={item} badge={badgeOf(item)} locked={lockedOf(item)} onNavigate={onNavigate} />)}
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2.5">
                    {groups.map(g => (
                        <CategoryTile key={g.groupLabel} label={g.groupLabel} icon={g.icon} count={g.items.length}
                            badge={g.items.reduce((n, i) => n + badgeOf(i), 0)}
                            onOpen={() => (g.items.length === 1 ? go(g.items[0]) : setOpen(g.groupLabel))} />
                    ))}
                </div>
            )}

            <button type="button" onClick={() => { clearToken(); router.replace("/login"); }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-600 text-sm font-semibold active:scale-[0.98] transition-transform">
                <LogOut className="w-5 h-5" aria-hidden /> התנתקות
            </button>
        </div>
    );
}
