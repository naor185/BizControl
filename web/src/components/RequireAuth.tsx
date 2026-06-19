"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken, getCurrentUserRole } from "@/lib/api";

// Pages accessible to artist/staff role only
const ARTIST_ALLOWED = ["/calendar"];

export default function RequireAuth({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [ready, setReady] = useState(false);
    // Track if we've already confirmed auth once — don't re-check on every pathname change
    const authedRef = useRef(false);

    useEffect(() => {
        // Already verified in this session — don't re-redirect on navigation
        if (authedRef.current) {
            setReady(true);
            return;
        }

        // Small delay to let localStorage hydrate fully on mobile browsers
        const tid = setTimeout(() => {
            const token = getToken();
            if (!token) {
                router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
                return;
            }

            const role = getCurrentUserRole();
            if ((role === "artist" || role === "staff") && !ARTIST_ALLOWED.some(p => pathname?.startsWith(p))) {
                router.replace("/calendar");
                return;
            }

            authedRef.current = true;
            setReady(true);
        }, 50);

        return () => clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);  // run once on mount only — subsequent navigations don't remount RequireAuth in App Router

    if (!ready) {
        return (
            <div className="min-h-screen flex items-center justify-center text-sm text-gray-500" dir="rtl">
                בודק התחברות...
            </div>
        );
    }

    return <>{children}</>;
}
