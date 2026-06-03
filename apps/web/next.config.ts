import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle at .next/standalone so the Docker
  // runtime stage can copy just that + .next/static + public. Cuts the
  // image to a fraction of the full node_modules tree.
  output: "standalone",
  transpilePackages: ["@sonara/shared", "@sonara/logger"],
  // evlog ships precompiled ESM that pulls Node built-ins (async_hooks, fs).
  // Keep it external so Next doesn't bundle it into server output.
  serverExternalPackages: ["evlog"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fal.media" },
      { protocol: "https", hostname: "**.fal.ai" },
      { protocol: "https", hostname: "v3.fal.media" },
      { protocol: "https", hostname: "v2.fal.media" },
      { protocol: "https", hostname: "storage.googleapis.com" },
    ],
  },
};

export default nextConfig;
