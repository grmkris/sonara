import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { mono, sans, serif } from "@/lib/fonts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "sonara",
  description: "Music made visible. Realtime AI visuals driven by sound and prompt.",
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
