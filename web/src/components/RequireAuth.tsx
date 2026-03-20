"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const token = getToken();
        if (!token) {
            router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
            return;
        }
        setReady(true);
    }, [router, pathname]);

    if (!ready) {
        return (
            <div className="min-h-screen flex items-center justify-center text-sm text-gray-500" dir="rtl">
                בודק התחברות...
            </div>
        );
    }

    return <>{children}</>;
}
