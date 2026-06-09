"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

// The shared app-shell nav: one quiet cluster of surface links rendered in
// each app page's own chrome (play / studio / the /s permalink). Deliberately
// not a nav bar — Sonara's pages own their headers; this just makes the
// surfaces mutually reachable with one consistent affordance.
const SURFACES = [
  { href: "/play", key: "play", label: "play" },
  { href: "/studio", key: "studio", label: "studio" },
] as const;

export type AppSurface = (typeof SURFACES)[number]["key"] | "s";

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
