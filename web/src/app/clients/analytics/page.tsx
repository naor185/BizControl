"use client";

import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import ClientsTabs from "@/components/ClientsTabs";
import ClientAnalyticsTab from "@/components/ClientAnalyticsTab";

export default function ClientAnalyticsPage() {
    return (
        <RequireAuth>
            <AppShell title="לקוחות">
                <div className="space-y-5 animate-page-in">
                    <ClientsTabs />
                    <ClientAnalyticsTab />
                </div>
            </AppShell>
        </RequireAuth>
    );
}
