import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeApp } from "@/lib/platform";
import { apiFetch } from "@/lib/api";

type Navigator = { push: (path: string) => void };

let _registered = false;

// Requests push permission, registers the device token with the backend, and
// wires notification taps to deep-link into the app. No-op outside the native
// shell (isNativeApp() false) and safe to call more than once per session.
export function registerForPushNotifications(router: Navigator) {
    if (!isNativeApp() || _registered) return;
    _registered = true;

    (async () => {
        try {
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive === "prompt") {
                perm = await PushNotifications.requestPermissions();
            }
            if (perm.receive !== "granted") return;
            await PushNotifications.register();
        } catch {
            // Permission flow failed/unavailable — nothing else to do.
        }
    })();

    PushNotifications.addListener("registration", (token) => {
        apiFetch("/api/push/register-token", {
            method: "POST",
            body: JSON.stringify({ token: token.value, platform: /android/i.test(navigator.userAgent) ? "android" : "ios" }),
        }).catch(() => {});
    });

    PushNotifications.addListener("registrationError", () => {});

    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const deepLink = action.notification?.data?.deep_link as string | undefined;
        if (deepLink) router.push(deepLink);
    });
}
