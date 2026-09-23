"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Landmark, Target } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import SetupChecklist from "@/components/SetupChecklist";
import LeadsContent from "@/components/LeadsContent";
import BizFindExposureCard from "@/components/BizFindExposureCard";
import BillingContent from "@/components/BillingContent";
import { useNewLeadsCount } from "@/lib/useNewLeadsCount";

const LEADS_OPEN_KEY = "bizcontrol_overview_leads_open";

function readLeadsOpen(): boolean {
    try {
        return localStorage.getItem(LEADS_OPEN_KEY) !== "0";
    } catch {
        return true;
    }
}

// Lowest row of the דשבורד page. Scrolls itself into view when the page is opened for billing
// (?billing=… from the plan bar, or when Stripe sends the customer back).
function BillingSection() {
    useEffect(() => {
        if (!new URLSearchParams(window.location.search).has("billing")) return;
        const t = setTimeout(() => document.getElementById("billing")?.scrollIntoView({ behavior: "smooth", block: "start" }), 500);
        return () => clearTimeout(t);
    }, []);

    return (
        <section id="billing" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden scroll-mt-4">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
                <Landmark className="h-5 w-5 text-slate-500" />
                <h3 className="font-bold text-slate-800 text-sm">מנוי וחיוב</h3>
            </div>
            <div className="p-5">
                <BillingContent />
            </div>
        </section>
    );
}

export default function OverviewPage() {
    const [leadsOpen, setLeadsOpen] = useState(readLeadsOpen);
    const newLeads = useNewLeadsCount();

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
                            {newLeads > 0 && (
                                <span className="text-white text-xs font-bold rounded-full px-2 h-5 flex items-center" style={{ background: "var(--accent)" }}>
                                    {newLeads} {newLeads === 1 ? "חדש" : "חדשים"}
                                </span>
                            )}
                            <span className="mr-auto flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                                {leadsOpen ? "סגור" : "פתח"}
                                <ChevronDown className={`h-4 w-4 transition-transform ${leadsOpen ? "rotate-180" : ""}`} />
                            </span>
                        </button>
                        {leadsOpen && <LeadsContent heightClass="h-[560px]" />}
                    </section>

                    <BizFindExposureCard />

                    <BillingSection />
                </div>
            </AppShell>
        </RequireAuth>
    );
}
