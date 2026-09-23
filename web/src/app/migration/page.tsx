"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import MigrationHome from "@/components/migration/MigrationHome";
import MigrationRun from "@/components/migration/MigrationRun";

function MigrationContent() {
    const id = useSearchParams().get("id");
    return id ? <MigrationRun key={id} id={id} /> : <MigrationHome />;
}

// Data import: /migration lists sources and earlier imports; /migration?id=… is one import, step by step.
export default function MigrationPage() {
    return (
        <RequireAuth>
            <AppShell title="ייבוא נתונים">
                <Suspense fallback={null}>
                    <MigrationContent />
                </Suspense>
            </AppShell>
        </RequireAuth>
    );
}
