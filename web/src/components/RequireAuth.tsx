"use client";

import { tx } from "@/lib/i18n";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken, getCurrentUserRole, isAccessTokenExpiringSoon, tryRefresh, clearToken } from "@/lib/api";
import { hydrateTokensFromSecureStorage } from "@/lib/secureTokenStorage";
import { isWorker, refreshWorkerPerms, workerPages } from "@/lib/workerPerms";

// The pages a worker (artist / staff) reaches: their own — the calendar, the health declarations they sign, the clock,
// their shifts — and what the owner opened to them: the till, clients and leads (lib/workerPerms, 2026-10-27)
const workerMayOpen = (pathname: string | null) => workerPages().some(p => pathname?.startsWith(p));

// Every screen has its own RequireAuth, mounted again on each move between screens — so the check ran again each time
// and "בודק התחברות..." flashed for a moment (the owner, 2026-10-18). Once it passed in this visit, a screen opens at
// once while its token is still there (and a worker only where a worker may go); the check itself stays for the first
// screen, and every request still renews or rejects the token (lib/api).
let checkedThisVisit = false;
const allowedNow = (pathname: string | null) => {
    if (!checkedThisVisit || !getToken()) return false;
    return !(isWorker(getCurrentUserRole()) && !workerMayOpen(pathname));
};

export default function RequireAuth({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [ready, setReady] = useState(() => allowedNow(pathname));

    useEffect(() => {
        if (ready) return;               // checked earlier in this visit

        let cancelled = false;
        // When the check can't finish (it hung, or something threw): the screen opens only with a token in hand —
        // never without one. Without one: the sign-in screen (the owner, 2026-10-20: a fresh install of the app showed
        // the calendar without signing in — the Keychain lookup outran the 6 seconds and this opened the screen).
        const openOrSignIn = () => {
            if (getToken()) setReady(true);
            else router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
        };

        // Absolute worst-case bound on the whole boot check, independent of
        // whatever any individual step below does — this screen must never
        // be able to hang forever, full stop, regardless of what future
        // changes touch this function. If nothing has decided ready/redirect
        // within 6s, just render — worst case, a stale page reloads on the
        // next tap instead of sitting frozen indefinitely.
        const hardTimeout = setTimeout(() => {
            if (!cancelled) openOrSignIn();
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
            if (isWorker(role)) {
                await refreshWorkerPerms();          // what the owner opened to them — asked again on each visit
                if (cancelled) return;
                if (!workerMayOpen(pathname)) {
                    router.replace("/calendar");
                    return;
                }
            }

            checkedThisVisit = true;
            setReady(true);
          } catch {
            // Whatever this is, it must not be able to leave the app stuck — and must not open the screen for
            // someone who isn't signed in: with a token the screen opens, without one the sign-in screen.
            if (!cancelled) openOrSignIn();
          } finally {
            clearTimeout(hardTimeout);
          }
        })();

        return () => { cancelled = true; clearTimeout(hardTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);  // once, when the screen opens

    if (!ready) {
        return (
            // the server draws this in Hebrew; the browser says it in the user's language
            <div className="min-h-screen flex items-center justify-center text-sm text-gray-500" suppressHydrationWarning>
                {tx("בודק התחברות...")}
            </div>
        );
    }

    return <>{children}</>;
}
