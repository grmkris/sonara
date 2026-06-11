"use client";

import { cn } from "@/lib/utils";

export type StudioTab = "recordings" | "sets" | "decks";

const TABS: StudioTab[] = ["recordings", "sets", "decks"];

// Two-tab header for the /studio sidebar: "recordings" (auto-captured live
// performances) and curated "sets" (named groups). URL-driven via ?tab so
// selection survives refresh + deep links.
export const StudioSidebarTabs = ({
  tab,
  onTab,
}: {
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
}) => (
  <div className="flex border-b border-[color:var(--hairline)]/30">
    {TABS.map((t) => (
      <button
        key={t}
        type="button"
        onClick={() => onTab(t)}
        aria-current={tab === t ? "true" : undefined}
        className={cn(
          "focus-ring flex-1 px-4 py-3 font-sans text-[10px] uppercase tracking-[0.24em] transition-colors",
          tab === t
            ? "border-b border-[color:var(--paper)] text-[color:var(--paper)]"
            : "text-[color:var(--stone)] hover:text-[color:var(--paper)]"
        )}
      >
        {t}
      </button>
    ))}
  </div>
);
