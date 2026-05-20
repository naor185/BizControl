import type { NextConfig } from "next";

const RAILWAY_URL = "https://web-production-68695.up.railway.app";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${RAILWAY_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
