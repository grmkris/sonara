import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { mono, sans, serif } from "@/lib/fonts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sonara.fm"),
  title: {
    default: "sonara — music, made visible",
    template: "%s · sonara",
  },
  // og/twitter descriptions are kept in the 110–160 char sweet spot for link
  // unfurls; the <title> default stays short for the browser tab while the
  // social title runs longer.
  description:
    "Sonara turns your music into moving art, right in your browser. Play anything and it paints flowing visuals in time with the sound, as it happens.",
  // og:image / twitter:image come from the file-convention opengraph-image.tsx
  // + twitter-image.tsx (the branded 1200×630 card) — don't set images here too.
  openGraph: {
    type: "website",
    title: "sonara — music, made visible: a visualiser that listens",
    description:
      "Sonara turns your music into moving art, right in your browser. Play anything and it paints flowing visuals in time with the sound, as it happens.",
    siteName: "sonara",
    url: "https://sonara.fm",
  },
  twitter: {
    card: "summary_large_image",
    title: "sonara — music, made visible: a visualiser that listens",
    description:
      "Sonara turns your music into moving art, right in your browser. Play anything and it paints flowing visuals in time with the sound, as it happens.",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1612",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body>
        <SwRegister />
        <TooltipProvider delay={100}>
          {children}
          <Toaster
            position="bottom-center"
            theme="dark"
            toastOptions={{
              classNames: {
                toast:
                  "font-mono bg-[color:var(--ink)] text-[color:var(--paper)] border border-[color:var(--hairline)]/40 rounded-none",
                description: "text-[color:var(--stone)]",
                actionButton:
                  "bg-[color:var(--signal)] text-[color:var(--paper)]",
              },
            }}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}
