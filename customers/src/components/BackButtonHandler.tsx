"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { consumeTopBackHandler } from "@/lib/backButtonStack";

// Bridges Android's hardware back button (native-only — no-op in a regular
// browser tab) to the app: close an open modal first, else navigate back a
// level, else — on one of the bottom-nav's root tabs, with nothing to go
// back to — require a second press within 2s before actually exiting, so
// one stray tap doesn't kick you out of the app.
const ROOT_PATHS = new Set(["/", "/explore", "/me", "/for-business"]);

export default function BackButtonHandler() {
    const router = useRouter();
    const pathname = usePathname();
    const pathRef = useRef(pathname);
    pathRef.current = pathname;
    const lastPressRef = useRef(0);
    const [toastMsg, setToastMsg] = useState<string | null>(null);

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
                        setToastMsg("לחץ שוב כדי לצאת");
                        setTimeout(() => setToastMsg(null), 2000);
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

    if (!toastMsg) return null;
    return (
        <div
            dir="rtl"
            style={{
                position: "fixed", bottom: 76, left: "50%", transform: "translateX(-50%)",
                background: "#111", border: "1px solid rgba(255,255,255,.14)", color: "#fff", padding: "0.6rem 1.1rem", borderRadius: 12,
                fontSize: "0.85rem", fontWeight: 600, zIndex: 200, boxShadow: "0 4px 16px rgba(0,0,0,.3)",
            }}
        >
            {toastMsg}
        </div>
    );
}
