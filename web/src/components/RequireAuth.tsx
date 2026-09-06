"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken, getCurrentUserRole, isAccessTokenExpiringSoon, tryRefresh, clearToken } from "@/lib/api";
import { hydrateTokensFromSecureStorage } from "@/lib/secureTokenStorage";

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

        let cancelled = false;

        (async () => {
            // Restores localStorage from Keychain/Keystore first, in case this
            // WebView's own storage was evicted or this is a fresh install —
            // see secureTokenStorage.ts. No-op on web or if nothing's there.
            await hydrateTokensFromSecureStorage();
            // Small delay on top, to let localStorage itself finish hydrating
            // fully on mobile browsers (pre-existing behavior, kept as-is).
            await new Promise(r => setTimeout(r, 50));
            if (cancelled) return;

            let token = getToken();
            if (!token) {
                router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
                return;
            }

            // Proactively renew a near-expired access token before rendering,
            // instead of letting the first real API call discover it's dead
            // and pay for a 401-then-refresh-then-retry round trip. Silent —
            // the user never sees this happen and never sees a login screen
            // over it; only a genuine rejection (token revoked/expired past
            // its 60-day window) sends them to /login. A network error here
            // does NOT log anyone out — same "don't punish a dropped
            // connection" rule apiFetch already follows — the still-present
            // (if stale) access token is left in place and whatever the user
            // opens first will retry the refresh dance itself.
            if (isAccessTokenExpiringSoon(token)) {
                const outcome = await tryRefresh();
                if (cancelled) return;
                if (outcome === "rejected") {
                    clearToken();
                    router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
                    return;
                }
                token = getToken();
            }

            const role = getCurrentUserRole();
            if ((role === "artist" || role === "staff") && !ARTIST_ALLOWED.some(p => pathname?.startsWith(p))) {
                router.replace("/calendar");
                return;
            }

            authedRef.current = true;
            setReady(true);
        })();

        return () => { cancelled = true; };
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
