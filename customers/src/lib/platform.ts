import { Capacitor } from "@capacitor/core";

// True when running inside the native iOS/Android app shell (Capacitor),
// false in a regular mobile/desktop browser.
export function isNativeApp(): boolean {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
}
