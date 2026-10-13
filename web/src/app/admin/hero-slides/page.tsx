"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The HERO's pictures moved into the superadmin's "הגדרות BizFind" (components/admin/BizFindHero.tsx, 2026-10-13) —
// an old link leads there.
export default function HeroSlidesPage() {
    const router = useRouter();
    useEffect(() => { router.replace("/admin?tab=bizfind"); }, [router]);
    return null;
}
