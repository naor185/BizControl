"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { consumeTopBackHandler } from "@/lib/backButtonStack";
import { useToast } from "@/components/ui/toast";

// Bridges Android's hardware back button (native-only — no-op in a regular
// browser tab) to the app: close an open modal/sheet first, else navigate
// back a level, else — on a root tab page with nothing to go back to —
// require a second press within 2s before actually exiting, so one stray
// tap doesn't kick you out of the app. Mirrors ROOT_PATHS in AppShell.tsx
// (the pages BottomNav's tabs already put you one tap away from).
const ROOT_PATHS = new Set(["/calendar", "/pos", "/clients", "/login"]);

export default function BackButtonHandler() {
    const router = useRouter();
    const pathname = usePathname();
    const pathRef = useRef(pathname);
    pathRef.current = pathname;
    const lastPressRef = useRef(0);
    const { toast } = useToast();
    const toastRef = useRef(toast);
    toastRef.current = toast;

    useEffect(() => {
        let remove: (() => void) | undefined;
        let cancelled = false;

        (async () => {
            try {
                const { Capacitor } = await import("@capacitor/core");
                if (!Capacitor.isNativePlatform()) return;
                const { App } = await import("@capacitor/app");
                const handle = await App.addListener("backButton", () => {
                    if (consumeTopBackHandler()) return;

                    if (!ROOT_PATHS.has(pathRef.current || "")) {
                        router.back();
                        return;
                    }

                    const now = Date.now();
                    if (now - lastPressRef.current < 2000) {
                        App.exitApp();
                    } else {
                        lastPressRef.current = now;
                        toastRef.current("לחץ שוב כדי לצאת", "info");
                    }
                });
                if (cancelled) { handle.remove(); return; }
                remove = () => handle.remove();
            } catch {
                // @capacitor/app not present in this build yet, or running
                // outside a native shell — nothing to wire up.
            }
        })();

        return () => { cancelled = true; remove?.(); };
    }, [router]);

    return null;
}
