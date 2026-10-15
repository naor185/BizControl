"use client";

import { useRouter } from "next/navigation";
import { Briefcase, Lock, Zap, BarChart3 } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import BusinessTiles from "@/components/BusinessTiles";
import { useBusinessSections } from "@/lib/businessSections";
import { fillTerms, useTerms } from "@/lib/useTerms";

// No PIN on the way in: only the owner and the managers reach this page (RequireAuth, and the server keeps the workers
// out of what's behind it) — the owner, 2026-10-15. On a phone it shows the small buttons, as the bar's "ניהול עסק" does.
export default function BusinessPage() {
    const terms = useTerms();   // the business's words in the descriptions
    const router = useRouter();
    const { groups, plan } = useBusinessSections();

    return (
        <RequireAuth>
            <AppShell>
                <div className="min-h-full" dir="rtl">

                    {/* ── Premium Hero Header ── */}
                    <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-violet-950 to-indigo-950">
                        {/* Background pattern */}
                        <div className="absolute inset-0 opacity-10" style={{
                            backgroundImage: "radial-gradient(circle at 20% 80%, #7c3aed 0%, transparent 50%), radial-gradient(circle at 80% 20%, #4f46e5 0%, transparent 50%)",
                        }} />
                        <div className="relative px-6 py-8">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-12 h-12 bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl flex items-center justify-center shadow-lg">
                                            <Briefcase className="w-6 h-6 text-white" />
                                        </div>
                                        <div>
                                            <h1 className="text-2xl font-black text-white tracking-tight">ניהול עסק</h1>
                                            <p className="text-violet-300 text-sm mt-0.5">מרכז השליטה הפיננסי של העסק שלך</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 flex-wrap mt-4">
                                        {[
                                            { icon: Zap, label: "גישה מהירה" },
                                            { icon: BarChart3, label: "כל הנתונים" },
                                        ].map(tag => (
                                            <span key={tag.label} className="flex items-center gap-1.5 text-xs bg-white/10 border border-white/15 text-violet-200 px-3 py-1 rounded-full font-medium">
                                                <tag.icon className="w-3.5 h-3.5" />
                                                {tag.label}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── The section grid ── */}
                    <div className="bg-gradient-to-b from-slate-50 to-white min-h-screen p-6 space-y-8">

                            {/* on the phone — the small buttons (components/BusinessTiles) */}
                            <div className="md:hidden bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
                                <BusinessTiles />
                            </div>

                            {groups.map(group => {
                                // סקירה and לוח בקרה are in the computer's side menu already
                                const visibleItems = group.items;
                                if (visibleItems.length === 0) return null;
                                return (
                                <div key={group.groupLabel} className="hidden md:block">
                                    {/* Group header */}
                                    <div className="flex items-center gap-2 mb-4">
                                        <group.icon className="w-5 h-5 text-slate-400" />
                                        <span className="text-base font-bold text-slate-400 uppercase tracking-widest">{group.groupLabel}</span>
                                        <div className="flex-1 h-px bg-slate-200 mr-1" />
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {visibleItems.map(section => (
                                            <button
                                                key={section.href}
                                                onClick={() => router.push(section.href)}
                                                className="group relative bg-white rounded-2xl border border-slate-100 p-5 text-right hover:shadow-xl hover:shadow-slate-200/80 hover:-translate-y-1 transition-all duration-200 overflow-hidden"
                                            >
                                                {/* Same monochrome treatment as the sidebar nav icons — no
                                                    per-tile rainbow badge. The icon color is var(--foreground),
                                                    which is the same "טקסט" token the superadmin's global design
                                                    card already controls, so it's editable from there today. */}
                                                <div
                                                    className="absolute inset-0 opacity-0 group-hover:opacity-[0.06] transition-opacity duration-200 rounded-2xl"
                                                    style={{ background: "var(--primary)" }}
                                                />

                                                {section.module && !plan.has(section.module) && (
                                                    <span className="absolute top-3 left-3 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                                                        <Lock className="w-3 h-3" aria-hidden /> ב{plan.upgrade(section.module)}
                                                    </span>
                                                )}
                                                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200">
                                                    <section.icon className="w-7 h-7" style={{ color: "var(--foreground)" }} />
                                                </div>
                                                <div className="font-bold text-slate-900 text-lg mb-1">{section.label}</div>
                                                <div className="text-base text-slate-400 leading-relaxed">{fillTerms(section.description, terms)}</div>

                                                {/* Arrow */}
                                                <div className="absolute top-4 left-4 text-slate-200 group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all duration-200 text-lg">
                                                    ←
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                );
                            })}

                    </div>
                </div>
            </AppShell>
        </RequireAuth>
    );
}
