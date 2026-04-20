import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@music-visualizer/shared"],
  // Keep pg + drizzle out of the client bundle — pg ships a native addon,
  // drizzle has Node-only APIs.
  serverExternalPackages: ["drizzle-orm", "pg"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fal.media" },
      { protocol: "https", hostname: "**.fal.ai" },
      { protocol: "https", hostname: "v3.fal.media" },
      { protocol: "https", hostname: "v2.fal.media" },
      { protocol: "https", hostname: "storage.googleapis.com" },
    ],
  },
  async headers() {
    return [
      {
        // Required so Reown AppKit's social-login flow can poll the OAuth
        // popup's `window.closed` from the opener. `same-origin-allow-popups`
        // is the MDN-documented value for this exact pattern.
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
