import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell configuration for BizFind — the public marketplace app
 * (separate from BizControl's own native shell, see web/capacitor.config.ts).
 *
 * Same approach as BizControl: a native iOS/Android shell that loads the
 * live production site (find.biz-control.com) over the network rather than
 * bundling a static export, since this app also has dynamic routes
 * (e.g. /b/[slug]) that a fully offline export would require restructuring.
 *
 * `webDir` is NOT the app's real content — Capacitor still requires it to
 * point at *some* local folder with an index.html, used only for edge cases
 * (offline/loading fallback before the remote URL is reachable). The real
 * screens always come from `server.url`.
 */
const config: CapacitorConfig = {
    // Android only — com.bizfind.app is what the generated android/ project
    // actually uses (applicationId). iOS uses a different id, com.bizcontrol.bizfind
    // (see ios/App/App.xcodeproj's PRODUCT_BUNDLE_IDENTIFIER and codemagic.yaml's
    // bizfind-ios workflow): com.bizfind.app was already registered on Apple's
    // side under a different account by the time BizFind's iOS signing was set
    // up (2026-09-02), so the iOS app ships under this second identifier instead.
    // This field itself only matters if the native projects are ever
    // regenerated from scratch — they're already committed and won't be.
    appId: "com.bizfind.app",
    appName: "BizFind",
    webDir: "www",
    server: {
        url: "https://find.biz-control.com",
        androidScheme: "https",
    },
};

export default config;
