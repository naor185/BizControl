"use client";

import { useState } from "react";
import { ChevronDown, Target } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import SetupChecklist from "@/components/SetupChecklist";
import LeadsContent from "@/components/LeadsContent";
import BizFindExposureCard from "@/components/BizFindExposureCard";

const LEADS_OPEN_KEY = "bizcontrol_overview_leads_open";

function readLeadsOpen(): boolean {
    try {
        return localStorage.getItem(LEADS_OPEN_KEY) !== "0";
    } catch {
        return true;
    }
}

export default function OverviewPage() {
    const [leadsOpen, setLeadsOpen] = useState(readLeadsOpen);

    const toggleLeads = () => {
        const next = !leadsOpen;
        setLeadsOpen(next);
        try { localStorage.setItem(LEADS_OPEN_KEY, next ? "1" : "0"); } catch { /* per-viewer convenience only */ }
    };

    return (
        <RequireAuth>
            <AppShell title="דשבורד">
                <div className="space-y-5 animate-page-in pb-10">
                    <SetupChecklist />

                    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <button
                            type="button"
                            onClick={toggleLeads}
                            aria-expanded={leadsOpen}
                            className={`w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors ${leadsOpen ? "border-b border-slate-100" : ""}`}
                        >
                            <Target className="h-5 w-5 text-slate-500" />
                            <h3 className="font-bold text-slate-800 text-sm">לידים</h3>
                            <span className="mr-auto flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                                {leadsOpen ? "סגור" : "פתח"}
                                <ChevronDown className={`h-4 w-4 transition-transform ${leadsOpen ? "rotate-180" : ""}`} />
                            </span>
                        </button>
                        {leadsOpen && <LeadsContent heightClass="h-[560px]" />}
                    </section>

                    <BizFindExposureCard />
                </div>
            </AppShell>
        </RequireAuth>
    );
}
