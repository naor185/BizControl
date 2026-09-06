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

const TOKEN_KEY = "bizcontrol_token";
const REFRESH_TOKEN_KEY = "bizcontrol_refresh_token";

async function getPlugin() {
    if (!isNativeApp()) return null;
    try {
        const mod = await import("capacitor-secure-storage-plugin");
        return mod.SecureStoragePlugin;
    } catch {
        // Plugin not present in this build yet (e.g. the app hasn't been
        // updated past the release that added it) — degrade to
        // localStorage-only behavior rather than throwing.
        return null;
    }
}

export async function mirrorTokensToSecureStorage(access: string, refresh?: string) {
    const plugin = await getPlugin();
    if (!plugin) return;
    try {
        await plugin.set({ key: TOKEN_KEY, value: access });
        if (refresh) await plugin.set({ key: REFRESH_TOKEN_KEY, value: refresh });
    } catch {
        // Best-effort — the localStorage write already happened and is what
        // the rest of the app actually reads this session.
    }
}

export async function clearSecureStorageTokens() {
    const plugin = await getPlugin();
    if (!plugin) return;
    try {
        await plugin.remove({ key: TOKEN_KEY });
        await plugin.remove({ key: REFRESH_TOKEN_KEY });
    } catch {}
}

// Call once at app boot, before any auth check reads localStorage. Restores
// localStorage from the durable secure store whenever the two have
// diverged — the ordinary case is "localStorage already has today's
// tokens, do nothing"; the case this exists for is a fresh/evicted WebView
// where localStorage is empty (or stale) but Keychain/Keystore still has
// the real session.
export async function hydrateTokensFromSecureStorage(): Promise<void> {
    const plugin = await getPlugin();
    if (!plugin) return;
    try {
        const [accessRes, refreshRes] = await Promise.allSettled([
            plugin.get({ key: TOKEN_KEY }),
            plugin.get({ key: REFRESH_TOKEN_KEY }),
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
