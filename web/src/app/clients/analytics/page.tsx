"use client";

import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import ClientsTabs from "@/components/ClientsTabs";
import ClientAnalyticsTab from "@/components/ClientAnalyticsTab";

import { tx } from "@/lib/i18n";
export default function ClientAnalyticsPage() {
    return (
        <RequireAuth>
            <AppShell title={tx("לקוחות")}>
                <div className="space-y-5 animate-page-in">
                    <ClientsTabs />
                    <ClientAnalyticsTab />
                </div>
            </AppShell>
        </RequireAuth>
    );
}
