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

        // Absolute worst-case bound on the whole boot check, independent of
        // whatever any individual step below does — this screen must never
        // be able to hang forever, full stop, regardless of what future
        // changes touch this function. If nothing has decided ready/redirect
        // within 6s, just render — worst case, a stale page reloads on the
        // next tap instead of sitting frozen indefinitely.
        const hardTimeout = setTimeout(() => {
            if (!cancelled) setReady(true);
        }, 6000);

        (async () => {
          try {
            // Small delay first, to let localStorage itself finish hydrating
            // fully on mobile browsers (pre-existing behavior, kept as-is).
            await new Promise(r => setTimeout(r, 50));
            if (cancelled) return;

            let token = getToken();
            // Only touch Keychain/Keystore when localStorage has nothing —
            // that's the one case it can actually help with (a fresh/evicted
            // WebView or reinstall); an already-logged-in user's normal boot
            // never needs to call the native plugin at all. secureTokenStorage.ts
            // guards every call with its own timeout regardless, but skipping
            // it entirely on the hot path is one less thing that has to go
            // right for the common case.
            if (!token) {
                await hydrateTokensFromSecureStorage();
                if (cancelled) return;
                token = getToken();
            }
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
          } catch {
            // Whatever this is, it must not be able to leave the app stuck —
            // render anyway rather than hang with no fallback left (the
            // hard-timeout above still fires as a backstop regardless, but
            // there's no reason to wait 6s for it once we already know
            // something broke).
            setReady(true);
          } finally {
            clearTimeout(hardTimeout);
          }
        })();

        return () => { cancelled = true; clearTimeout(hardTimeout); };
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
