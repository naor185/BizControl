import { Capacitor } from "@capacitor/core";

// True when running inside the native iOS/Android app shell (Capacitor),
// false in a regular mobile/desktop browser. Used to hide in-app purchase
// flows that must go through Apple/Google's payment systems if triggered
// from inside a native app — see web/src/app/billing/page.tsx.
export function isNativeApp(): boolean {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
}
