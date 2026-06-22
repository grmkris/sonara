"use client";

import type { FrameSetSummary } from "@sonara/shared";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

interface RecordingsListProps {
  recordings: FrameSetSummary[];
  loading: boolean;
  bootstrapped: boolean;
  selectedRecordingId: string | null;
  onSelect: (setId: string) => void;
}

type DateBand = "today" | "yesterday" | "this week" | "older";

const bandOf = (date: Date, now: Date): DateBand => {
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return "today";
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) {
    return "yesterday";
  }
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  if (date >= sevenDaysAgo) {
    return "this week";
  }
  return "older";
};

const formatTime = (date: Date): string => {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
};

// Left-rail list of recording sets (auto-captured live performances), grouped
// by date band (today / yesterday / this week / older). Each card shows:
// cover thumb, name, frame count. Click selects the recording.
export const RecordingsList = ({
  recordings,
  loading,
  bootstrapped,
  selectedRecordingId,
  onSelect,
}: RecordingsListProps) => {
  const grouped = useMemo(() => {
    const now = new Date();
    const map = new Map<DateBand, FrameSetSummary[]>();
    for (const r of recordings) {
      const band = bandOf(r.createdAt, now);
      const arr = map.get(band) ?? [];
      arr.push(r);
      map.set(band, arr);
    }
    // Stable order.
    const order: DateBand[] = ["today", "yesterday", "this week", "older"];
    return order
      .map((band) => ({ band, items: map.get(band) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [recordings]);

  if (!bootstrapped || loading) {
    return (
      <div className="px-4 py-6 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        loading recordings…
      </div>
    );
  }

  if (recordings.length === 0) {
    return null;
  }

  return (
    <nav aria-label="recordings" className="flex flex-col">
      {grouped.map((g) => (
        <section key={g.band} className="flex flex-col">
          <h3 className="sticky top-0 z-10 bg-[color:var(--ink)] px-4 pt-5 pb-2 font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            {g.band}
          </h3>
          <ul className="flex flex-col">
            {g.items.map((r) => {
              const selected = r.id === selectedRecordingId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r.id)}
                    className={cn(
                      "focus-ring flex w-full items-center gap-3 px-4 py-2 text-left",
                      "border-b border-l-2 border-l-transparent border-[color:var(--hairline)]/20 transition-colors",
                      selected
                        ? "border-l-[color:var(--paper)] bg-[color:var(--paper)]/10"
                        : "hover:bg-[color:var(--paper)]/5"
                    )}
                    aria-current={selected ? "true" : undefined}
                  >
                    {r.coverUrl ? (
                      <img
                        src={r.coverUrl}
                        alt=""
                        loading="lazy"
                        className="size-10 shrink-0 rounded-sm border border-[color:var(--hairline)]/40 object-cover"
                      />
                    ) : (
                      <div className="size-10 shrink-0 rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/40" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          "truncate font-sans text-[11px] uppercase tracking-[0.18em]",
                          selected
                            ? "text-[color:var(--paper)]"
                            : "text-[color:var(--paper)]/80"
                        )}
                      >
                        {r.name || formatTime(r.createdAt)}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                        {r.frameCount} frame{r.frameCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
};
