import type { MetadataRoute } from "next";

// PWA manifest, served at /manifest.webmanifest and auto-linked by Next. The
// scalable SVG mark covers modern browsers; the PNG + maskable entries give
// Android "add to home screen" a properly-padded, un-cropped install icon.
// All icons are generated from the canonical mark by brand/scripts/build.ts.
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#1a1612",
    description:
      "It listens to whatever you're playing and paints what it hears, as it happens.",
    display: "standalone",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    name: "Sonara — music, made visible",
    short_name: "Sonara",
    start_url: "/",
    theme_color: "#1a1612",
  };
}
