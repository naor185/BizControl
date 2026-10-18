"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// A BizControl link opened in the app instead of the browser — the attendance clock's barcode or NFC sticker
// (/clock/{code}) first (the owner, 2026-10-18: "touching the sticker opens the browser, not the app"). The phone
// hands the link to the app (iOS associated domains / Android app links, set in the native projects); the app opens
// on its start screen, so this moves it to the link's screen — when the app was closed (its launch link) and when it
// was already open (appUrlOpen). Native-only: nothing happens in a browser tab.
const OURS = /(^|\.)biz-control\.com$/;

export default function AppLinkHandler() {
    const router = useRouter();

    useEffect(() => {
        let remove: (() => void) | undefined;
        let cancelled = false;
        const go = (url: string | undefined) => {
            if (!url) return;
            try {
                const u = new URL(url);
                if (!OURS.test(u.hostname)) return;
                const to = u.pathname + u.search;
                if (to !== window.location.pathname + window.location.search) router.push(to);
            } catch { /* not a link */ }
        };

        (async () => {
            try {
                const { Capacitor } = await import("@capacitor/core");
                if (!Capacitor.isNativePlatform()) return;
                const { App } = await import("@capacitor/app");
                const launch = await App.getLaunchUrl();
                if (!cancelled) go(launch?.url);
                const handle = await App.addListener("appUrlOpen", e => go(e.url));
                if (cancelled) { handle.remove(); return; }
                remove = () => handle.remove();
            } catch {
                // outside the native shell, or the plugin missing — nothing to wire up
            }
        })();

        return () => { cancelled = true; remove?.(); };
    }, [router]);

    return null;
}
