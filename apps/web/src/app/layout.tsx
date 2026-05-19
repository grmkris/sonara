import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { mono, sans, serif } from "@/lib/fonts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sonara.fm"),
  title: {
    default: "sonara — music, made visible",
    template: "%s · sonara",
  },
  description:
    "A browser-based visualiser that listens to what you play and paints what it hears — in realtime, at 60 frames a second.",
  openGraph: {
    type: "website",
    title: "sonara — music, made visible",
    description:
      "Realtime AI visuals driven by sound, voice, and prompt. No install, runs in the browser.",
    siteName: "sonara",
    url: "https://sonara.fm",
    images: [
      {
        url: "/library/wild/img_01krh2j35wf23vwphhkfxpyefv.webp",
        width: 1024,
        height: 1024,
        alt: "sonara visualiser still",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "sonara — music, made visible",
    description:
      "Realtime AI visuals driven by sound, voice, and prompt. No install, runs in the browser.",
    images: ["/library/wild/img_01krh2j35wf23vwphhkfxpyefv.webp"],
  },
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
        <TooltipProvider delayDuration={100}>
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
