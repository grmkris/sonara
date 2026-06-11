"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

// The shared app-shell nav: one quiet cluster of surface links rendered in
// each app page's own chrome. Three destinations — play (the instrument),
// studio (the library), stages (the stage-management home: your rooms, their
// QRs and face links). /stages manages stages you own; it is NOT a code-entry
// resolver — consoles are still reached contextually (bookmark, the screen's
// phone icon, scanning your own crowd QR). Console and set pages pass
// current="live": valid state, nothing highlights.
const SURFACES = [
  { href: "/play", key: "play", label: "play" },
  { href: "/studio", key: "studio", label: "studio" },
  { href: "/stages", key: "stages", label: "stages" },
] as const;

export type AppSurface = (typeof SURFACES)[number]["key"] | "live";

export const AppNavLinks = ({ current }: { current: AppSurface }) => (
  <nav
    aria-label="app surfaces"
    className="flex items-center gap-3 font-sans text-[10px] uppercase tracking-[0.24em]"
  >
    {SURFACES.map((s) => (
      <Link
        key={s.key}
        href={s.href}
        aria-current={current === s.key ? "page" : undefined}
        className={cn(
          "focus-ring transition-colors",
          current === s.key
            ? "text-[color:var(--paper)]/85"
            : "text-[color:var(--stone)] hover:text-[color:var(--paper)]"
        )}
      >
        {s.label}
      </Link>
    ))}
  </nav>
);
