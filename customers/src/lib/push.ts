import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeApp } from "@/lib/platform";
import { apiFetch, getToken } from "@/lib/api";

let _registered = false;

// Ships every step of the registration flow to the server (visible in Railway
// logs) since there's no way to see console output from the native app's
// WebView without Xcode's device console.
function debugLog(message: string) {
    if (!getToken()) return;
    apiFetch("/api/marketplace/auth/push/client-log", { method: "POST", body: JSON.stringify({ message }) }).catch(() => {});
}

// Requests push permission, registers the device token with the backend, and
// deep-links notification taps into the app. No-op outside the native shell
// and safe to call more than once per session (e.g. on login and on mount).
export function registerForPushNotifications() {
    const native = isNativeApp();
    if (!native || _registered) return;
    if (!getToken()) return; // only register once the customer is actually logged in
    _registered = true;
    debugLog(`registerForPushNotifications called: isNativeApp=${native} ua=${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`);

    (async () => {
        try {
            let perm = await PushNotifications.checkPermissions();
            debugLog(`checkPermissions -> ${JSON.stringify(perm)}`);
            if (perm.receive === "prompt") {
                perm = await PushNotifications.requestPermissions();
                debugLog(`requestPermissions -> ${JSON.stringify(perm)}`);
            }
            if (perm.receive !== "granted") {
                debugLog(`permission not granted, aborting: receive=${perm.receive}`);
                return;
            }
            await PushNotifications.register();
            debugLog("PushNotifications.register() resolved");
        } catch (e: any) {
            debugLog(`permission/register flow threw: ${e?.message || String(e)}`);
        }
    })();

    PushNotifications.addListener("registration", (token) => {
        const platform = /android/i.test(navigator.userAgent) ? "android" : "ios";
        debugLog(`registration event fired: platform=${platform} tokenLen=${token.value?.length} tokenPrefix=${token.value?.slice(0, 24)}`);
        apiFetch("/api/marketplace/auth/push/register-token", {
            method: "POST",
            body: JSON.stringify({ token: token.value, platform }),
        })
            .then(() => debugLog("register-token POST succeeded"))
            .catch((e: any) => debugLog(`register-token POST failed: ${e?.message || String(e)}`));
    });

    PushNotifications.addListener("registrationError", (err) => {
        debugLog(`registrationError event fired: ${JSON.stringify(err)}`);
    });

    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const deepLink = action.notification?.data?.deep_link as string | undefined;
        if (deepLink) window.location.href = deepLink;
    });
}
