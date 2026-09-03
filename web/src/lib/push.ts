import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeApp } from "@/lib/platform";
import { apiFetch } from "@/lib/api";

type Navigator = { push: (path: string) => void };

let _registered = false;

// Ships every step of the registration flow to the server (visible in Railway
// logs) since there's no way to see console output from the native app's
// WebView without Xcode's device console.
function debugLog(message: string) {
    apiFetch("/api/push/client-log", { method: "POST", body: JSON.stringify({ message }) }).catch(() => {});
}

// Requests push permission, registers the device token with the backend, and
// wires notification taps to deep-link into the app. No-op outside the native
// shell (isNativeApp() false) and safe to call more than once per session.
export function registerForPushNotifications(router: Navigator) {
    const native = isNativeApp();
    debugLog(`registerForPushNotifications called: isNativeApp=${native} alreadyRegistered=${_registered} ua=${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`);
    if (!native || _registered) return;
    _registered = true;

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
        apiFetch("/api/push/register-token", {
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
        if (deepLink) router.push(deepLink);
    });
}
