import { BiometricAuth, BiometryErrorType } from "@aparajita/capacitor-biometric-auth";
import { isNativeApp } from "@/lib/platform";

// Face ID / Touch ID on the native app only. The existing WebAuthn-based
// "Face ID / Fingerprint" button on the login page (navigator.credentials)
// stays as-is for Android Chrome / desktop, where it already works — this
// covers iOS, where WebKit never implemented the Credential Management
// API's password support, so that button silently never even appeared.
//
// This isn't a fresh biometric *login*: Face ID doesn't hand back
// credentials the server can check. It's a gate in front of the session
// that's already sitting in localStorage from the last real login — same
// pattern as every banking app's "unlock with Face ID".

export async function isNativeBiometricAvailable(): Promise<boolean> {
    if (!isNativeApp()) return false;
    try {
        const result = await BiometricAuth.checkBiometry();
        return result.isAvailable;
    } catch {
        return false;
    }
}

// Resolves true on success, false on user cancel, throws on a real device-level failure.
export async function verifyNativeBiometric(reason: string): Promise<boolean> {
    try {
        await BiometricAuth.authenticate({
            reason,
            cancelTitle: "ביטול",
            allowDeviceCredential: true,
        });
        return true;
    } catch (e) {
        const code = (e as { code?: BiometryErrorType })?.code;
        if (code === BiometryErrorType.userCancel || code === BiometryErrorType.userFallback || code === BiometryErrorType.appCancel) {
            return false;
        }
        throw e;
    }
}
