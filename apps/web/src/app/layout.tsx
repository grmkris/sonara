import type { Metadata } from "next";
import type { ReactNode } from "react";
import { mono, sans, serif } from "@/lib/fonts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Web3Provider } from "@/components/web3-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "dream · visualizer",
  description: "Dreamlike realtime AI visuals driven by music and prompt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <Web3Provider>
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
        </Web3Provider>
      </body>
    </html>
  );
}
