import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell configuration for BizControl.
 *
 * The app is a native iOS/Android shell that loads the live production site
 * (biz-control.com) over the network — it is a real installable app (icon,
 * splash screen, no visible browser chrome, works through the App Store /
 * Google Play), it just doesn't bundle a copy of the screens inside the
 * binary. This avoids a large, risky rewrite of the ~11 dynamic routes
 * (e.g. /clients/[id], /receipt/[id]) that a fully offline static-export
 * build would require (Next.js "output: export" cannot handle those without
 * restructuring them to query-based routing).
 *
 * `webDir` below is NOT the app's real content — Capacitor still requires it
 * to point at *some* local folder with an index.html. It's only used for a
 * couple of edge cases (offline/loading fallback before the remote URL is
 * reachable). The real screens always come from `server.url`.
 */
const config: CapacitorConfig = {
    appId: "com.bizcontrol.app",
    appName: "BizControl",
    webDir: "www",
    server: {
        url: "https://biz-control.com",
        // Cleartext is never used (https only); androidScheme keeps Android's
        // WebView cookies/localStorage consistent with a real https origin.
        androidScheme: "https",
        // Add other origins here if the app needs to *navigate* to them
        // (not just fetch — API calls already work via CORS regardless).
        // Likely candidates found in the codebase: Stripe checkout/portal,
        // Google/Meta OAuth screens, wa.me WhatsApp links. Add as needed
        // once you test real flows on a device/emulator:
        // allowNavigation: ["checkout.stripe.com", "accounts.google.com", "wa.me"],
    },
};

export default config;
