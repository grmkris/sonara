import type { Metadata } from "next";
import type { ReactNode } from "react";
import { kaku, mincho, plex } from "@/lib/fonts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "夢 · dream",
  description: "Dreamlike realtime AI visuals driven by music and prompt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${mincho.variable} ${kaku.variable} ${plex.variable}`}
    >
      <body>
        <TooltipProvider delayDuration={100}>
          {children}
          <Toaster
            position="bottom-center"
            theme="dark"
            toastOptions={{
              classNames: {
                toast:
                  "font-plex bg-[color:var(--ink)] text-[color:var(--paper)] border border-[color:var(--hairline)]/40 rounded-none",
                description: "text-[color:var(--stone)]",
                actionButton: "bg-[color:var(--hanko)] text-[color:var(--paper)]",
              },
            }}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}
