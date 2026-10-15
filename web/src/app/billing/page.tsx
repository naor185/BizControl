"use client";

// Subscription & billing — its own screen in "ניהול עסק" (the owner, 2026-10-15: "ניצול החודש" and the plans don't
// belong on the overview): the plan and the time left on it, this month's use, renewing. Payment returns here
// (?billing=success / canceled — api/billing_routes), and the notices about the plan link here.
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import BillingContent from "@/components/BillingContent";

export default function BillingPage() {
    return (
        <RequireAuth>
            <AppShell title="מנוי וחיוב">
                <div className="max-w-5xl pb-10">
                    <BillingContent />
                </div>
            </AppShell>
        </RequireAuth>
    );
}
