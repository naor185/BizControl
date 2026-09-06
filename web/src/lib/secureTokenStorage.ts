import { isNativeApp } from "@/lib/platform";

// Backs the access/refresh tokens with iOS Keychain / Android Keystore on
// the native app, so a real login survives things localStorage alone
// doesn't reliably survive: WebView data getting evicted under OS storage
// pressure, and (unlike localStorage) Keychain items are commonly retained
// across an app uninstall/reinstall on iOS.
//
// Every other read in the codebase (apiFetch, RequireAuth, getCurrentUserRole,
// the various direct-download helpers) calls localStorage synchronously —
// rewriting all of those to be async would be a large, risky refactor for
// what's fundamentally a durability upgrade, not a new read path. Instead,
// secure storage is the durable backing store and localStorage stays the
// synchronous runtime cache: writes go to both (best-effort on the secure
// side — never let a plugin hiccup break the login that already succeeded
// via localStorage), and app boot hydrates localStorage FROM secure storage
// before anything else runs, so a fresh WebView (evicted storage, or the
// very first launch after reinstall) still finds the real tokens.
//
// No-ops entirely on web/desktop — Keychain/Keystore don't exist there, and
// localStorage is already the right (and only) mechanism.
//
// CRITICAL: this JS ships instantly (web deploy), but the plugin's native
// Swift/Kotlin side only exists after a new Codemagic build — so there's
// always a window (and, for anyone who hasn't updated yet, a LONG window)
// where isNativeApp() is true but no native "SecureStoragePlugin" is
// actually registered. Capacitor's bridge does not reliably reject that
// call fast — on an unregistered plugin it can simply never resolve,
// hanging the promise forever with no error to catch. Since this used to
// be awaited directly on RequireAuth's boot path, that hang froze the
// entire app on "בודק התחברות..." for every single user, on both platforms,
// the moment this shipped — confirmed to be exactly what happened. Every
// call here MUST be wrapped in an explicit timeout as a result; a try/catch
// alone is not sufficient, because there may never be a rejection to catch.

const TOKEN_KEY = "bizcontrol_token";
const REFRESH_TOKEN_KEY = "bizcontrol_refresh_token";
const PLUGIN_TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("secure-storage timeout")), ms);
        p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
}

async function getPlugin() {
    if (!isNativeApp()) return null;
    try {
        const mod = await withTimeout(import("capacitor-secure-storage-plugin"), PLUGIN_TIMEOUT_MS);
        return mod.SecureStoragePlugin;
    } catch {
        // Plugin not present in this build yet (e.g. the app hasn't been
        // updated past the release that added it), or the import itself
        // hung — degrade to localStorage-only behavior rather than
        // blocking anything on it.
        return null;
    }
}

export async function mirrorTokensToSecureStorage(access: string, refresh?: string) {
    const plugin = await getPlugin();
    if (!plugin) return;
    try {
        await withTimeout(plugin.set({ key: TOKEN_KEY, value: access }), PLUGIN_TIMEOUT_MS);
        if (refresh) await withTimeout(plugin.set({ key: REFRESH_TOKEN_KEY, value: refresh }), PLUGIN_TIMEOUT_MS);
    } catch {
        // Best-effort — the localStorage write already happened and is what
        // the rest of the app actually reads this session.
    }
}

export async function clearSecureStorageTokens() {
    const plugin = await getPlugin();
    if (!plugin) return;
    try {
        await withTimeout(plugin.remove({ key: TOKEN_KEY }), PLUGIN_TIMEOUT_MS);
        await withTimeout(plugin.remove({ key: REFRESH_TOKEN_KEY }), PLUGIN_TIMEOUT_MS);
    } catch {}
}

// Call once at app boot, before any auth check reads localStorage. Restores
// localStorage from the durable secure store whenever the two have
// diverged — the ordinary case is "localStorage already has today's
// tokens, do nothing"; the case this exists for is a fresh/evicted WebView
// where localStorage is empty (or stale) but Keychain/Keystore still has
// the real session. Bounded to well under a second of possible delay even
// in the worst case (two timed-out calls), specifically so this can never
// be the reason the app sits on a loading screen.
export async function hydrateTokensFromSecureStorage(): Promise<void> {
    const plugin = await getPlugin();
    if (!plugin) return;
    try {
        const [accessRes, refreshRes] = await Promise.allSettled([
            withTimeout(plugin.get({ key: TOKEN_KEY }), PLUGIN_TIMEOUT_MS),
            withTimeout(plugin.get({ key: REFRESH_TOKEN_KEY }), PLUGIN_TIMEOUT_MS),
        ]);
        const access = accessRes.status === "fulfilled" ? accessRes.value.value : null;
        const refresh = refreshRes.status === "fulfilled" ? refreshRes.value.value : null;
        // Only fill in what's missing — never overwrite an existing
        // localStorage value. Tokens rotate on every refresh, so if both
        // stores somehow disagree, whatever localStorage already has this
        // session is the newer one (the mirror write to secure storage is
        // best-effort and could lag); secure storage's job here is only to
        // restore state when localStorage has nothing at all.
        if (access && !localStorage.getItem(TOKEN_KEY)) {
            localStorage.setItem(TOKEN_KEY, access);
        }
        if (refresh && !localStorage.getItem(REFRESH_TOKEN_KEY)) {
            localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
        }
    } catch {
        // No secure-storage session (fresh install, never logged in there,
        // or the plugin errored) — leave localStorage exactly as it is.
    }
}
