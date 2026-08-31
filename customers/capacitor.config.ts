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
    appId: "com.bizfind.app",
    appName: "BizFind",
    webDir: "www",
    server: {
        url: "https://find.biz-control.com",
        androidScheme: "https",
    },
};

export default config;
