import type { MetadataRoute } from "next";

// PWA manifest, served at /manifest.webmanifest and auto-linked by Next. The
// scalable SVG mark covers all icon sizes; colours match the editorial ink/
// paper system.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sonara — music, made visible",
    short_name: "Sonara",
    description:
      "It listens to whatever you're playing and paints what it hears, as it happens.",
    start_url: "/",
    display: "standalone",
    background_color: "#1a1612",
    theme_color: "#1a1612",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
