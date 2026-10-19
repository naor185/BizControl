"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The pay screen is the "שעות ושכר" tab of the workers center (app/team) since 2026-10-19 — this address still works.
export default function PayrollRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/team?tab=pay"); }, [router]);
    return null;
}
