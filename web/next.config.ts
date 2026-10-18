import type { NextConfig } from "next";

const RAILWAY_URL = "https://web-production-68695.up.railway.app";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${RAILWAY_URL}/api/:path*` },
      { source: "/uploads/:path*", destination: `${RAILWAY_URL}/uploads/:path*` },
    ];
  },
  async headers() {
    return [
      // Apple reads it to let the app open the attendance clock's links (/clock/…) instead of the browser — as JSON
      // (public/.well-known/apple-app-site-association; the app's side: ios/App/App/App.entitlements)
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "upgrade-insecure-requests",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
