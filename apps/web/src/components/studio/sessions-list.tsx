"use client";

import { useMemo } from "react";
import type { SessionSummary } from "@sonara/shared";
import { formatDuration } from "@/lib/format-time";
import { cn } from "@/lib/utils";

interface SessionsListProps {
  sessions: SessionSummary[];
  loading: boolean;
  bootstrapped: boolean;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}

type DateBand = "today" | "yesterday" | "this week" | "older";

function bandOf(date: Date, now: Date): DateBand {
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return "yesterday";
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  if (date >= sevenDaysAgo) return "this week";
  return "older";
}

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function formatDateLong(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Left-rail list of session summaries, grouped by date band (today /
// yesterday / this week / older). Each session card shows: sample thumb,
// time range, frame count, duration. Click selects the session.
export function SessionsList({
  sessions,
  loading,
  bootstrapped,
  selectedSessionId,
  onSelect,
}: SessionsListProps) {
  const grouped = useMemo(() => {
    const now = new Date();
    const map = new Map<DateBand, SessionSummary[]>();
    for (const s of sessions) {
      const band = bandOf(s.lastFrameAt, now);
      const arr = map.get(band) ?? [];
      arr.push(s);
      map.set(band, arr);
    }
    // Stable order.
    const order: DateBand[] = ["today", "yesterday", "this week", "older"];
    return order
      .map((band) => ({ band, items: map.get(band) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [sessions]);

  if (!bootstrapped || loading) {
    return (
      <div className="px-4 py-6 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        loading sessions…
      </div>
    );
  }

  if (sessions.length === 0) {
    return null;
  }

  return (
    <nav aria-label="library sessions" className="flex flex-col">
      {grouped.map((g) => (
        <section key={g.band} className="flex flex-col">
          <h3 className="sticky top-0 z-10 bg-[color:var(--ink)] px-4 pt-5 pb-2 font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            {g.band}
          </h3>
          <ul className="flex flex-col">
            {g.items.map((s) => {
              const selected = s.sessionId === selectedSessionId;
              return (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.sessionId)}
                    className={cn(
                      "focus-ring flex w-full items-center gap-3 px-4 py-2 text-left",
                      "border-b border-[color:var(--hairline)]/20 transition-colors",
                      selected
                        ? "bg-[color:var(--paper)]/10"
                        : "hover:bg-[color:var(--paper)]/5",
                    )}
                    aria-current={selected ? "true" : undefined}
                  >
                    {s.sampleUrl ? (
                      <img
                        src={s.sampleUrl}
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
                          "font-sans text-[11px] uppercase tracking-[0.18em]",
                          selected
                            ? "text-[color:var(--paper)]"
                            : "text-[color:var(--paper)]/80",
                        )}
                      >
                        {g.band === "older"
                          ? formatDateLong(s.lastFrameAt)
                          : formatTime(s.firstFrameAt)}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                        {s.frameCount} frame{s.frameCount !== 1 ? "s" : ""}
                        {" · "}
                        {formatDuration(s.durationMs)}
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
}
