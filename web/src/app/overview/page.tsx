"use client";

import { Target } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import SetupChecklist from "@/components/SetupChecklist";
import LeadsContent from "@/components/LeadsContent";
import BizFindExposureCard from "@/components/BizFindExposureCard";

export default function OverviewPage() {
    return (
        <RequireAuth>
            <AppShell title="דשבורד">
                <div className="space-y-5 animate-page-in pb-10">
                    <SetupChecklist />

                    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
                            <Target className="h-5 w-5 text-slate-500" />
                            <h3 className="font-bold text-slate-800 text-sm">לידים</h3>
                        </div>
                        <LeadsContent heightClass="h-[560px]" />
                    </section>

                    <BizFindExposureCard />
                </div>
            </AppShell>
        </RequireAuth>
    );
}
