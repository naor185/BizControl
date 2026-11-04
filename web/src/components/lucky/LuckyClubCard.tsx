"use client";
import Link from "next/link";
import { ChevronLeft, Trophy } from "lucide-react";
import { usePlan } from "@/lib/usePlan";
import { tx } from "@/lib/i18n";

// Lucky Club's way in, at the top of the club tab — only where the business has it (module lucky_club; while it's
// tried out, the superadmin turns it on per business), so nothing is offered to the rest.
export default function LuckyClubCard() {
    const plan = usePlan();
    if (!plan.ready || !plan.has("lucky_club")) return null;
    return (
        <Link href="/clients/lucky"
            className="group flex items-center gap-4 rounded-2xl border border-amber-200 bg-gradient-to-l from-amber-50 to-white px-5 py-4 shadow-sm transition hover:border-amber-300 hover:shadow">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
                <Trophy className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block font-bold text-slate-900">{tx("Lucky Club — הגרלות ופרסים")}</span>
                <span className="block text-sm text-slate-600">{tx("הגרלה בין הלקוחות שלך, עם פרס לכל זוכה")}</span>
            </span>
            <ChevronLeft className="h-5 w-5 shrink-0 text-amber-600 ltr:-scale-x-100" aria-hidden />
        </Link>
    );
}
