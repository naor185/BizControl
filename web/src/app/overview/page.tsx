"use client";

import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import DashboardTabs from "@/components/DashboardTabs";
import BizFindExposureCard from "@/components/BizFindExposureCard";

export default function OverviewPage() {
    return (
        <RequireAuth>
            <AppShell title="דשבורד">
                <div className="space-y-5 animate-page-in">
                    <DashboardTabs />
                    <BizFindExposureCard />
                </div>
            </AppShell>
        </RequireAuth>
    );
}
