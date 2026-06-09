"use client";

import { ORPCError } from "@orpc/client";
import { deckLabel } from "@sonara/shared";
import type { LiveSessionId } from "@sonara/shared/typeid";
import { typeIdFromUuid, typeIdToUuid } from "@sonara/shared/typeid";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";

import { AppNavLinks } from "@/components/app-nav";
import { Mark } from "@/components/brand/mark";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";

// /control — legacy entry for the operator remote, now a resolver: it finds
// the caller's newest live session and forwards to its /s permalink, where
// the owner view renders the same OperatorConsole this page used to host.
// Kept (rather than deleted) so bookmarks and the muscle-memory URL survive;
// the auth / no-session states below are the only UI it still owns.

type LiveSessionSummary = Awaited<
  ReturnType<AppRouterClient["control"]["liveSessions"]>
>["sessions"][number];

const SESSIONS_POLL_MS = 3000;

// A live session's console lives at its set permalink — the set id is the
// same uuid as the liveSessionId, re-prefixed. No extra round trip.
const consoleHref = (liveSessionId: LiveSessionId): string =>
  `/s/${typeIdFromUuid("frameSet", typeIdToUuid(liveSessionId).uuid)}`;

const startedAgo = (startedAt: number): string => {
  const mins = Math.max(0, Math.round((Date.now() - startedAt) / 60_000));
  if (mins < 1) {
    return "just now";
  }
  return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
};

// The `control` router is protected, so an expired cookie surfaces here as an
// ORPCError with code UNAUTHORIZED — which we must show, not swallow. ORPCError
// implements Symbol.hasInstance, so instanceof is SSR-safe across module copies.
const isUnauthorized = (error: unknown): boolean =>
  error instanceof ORPCError && error.code === "UNAUTHORIZED";

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="flex min-h-svh flex-col bg-[color:var(--ink)] px-6 text-[color:var(--stone)]">
    <header className="flex items-center justify-between pt-7">
      <span className="flex items-center gap-2.5 text-[color:var(--paper)]/85">
        <Mark className="h-6 w-6 shrink-0" />
        <span className="font-serif text-[20px] italic">live</span>
      </span>
      <AppNavLinks current="live" />
    </header>
    <div className="flex flex-1 items-center justify-center font-mono text-[11px] uppercase tracking-[0.22em]">
      {children}
    </div>
  </main>
);

export default function ControlPage() {
  const router = useRouter();
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;

  const [sessions, setSessions] = useState<LiveSessionSummary[]>([]);
  const [authExpired, setAuthExpired] = useState(false);

  // Discover the caller's live sessions; keep polling until one shows up so
  // the page resolves as soon as the projector connects.
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        const { sessions: next } = await rpcClient.control.liveSessions();
        if (!cancelled) {
          setSessions(next);
        }
      } catch (error) {
        // An expired session must surface (not leave a stale list on screen);
        // stop polling and let the render show the sign-in prompt. Other errors
        // are transient — keep the last list and retry next tick.
        if (!cancelled && isUnauthorized(error)) {
          setAuthExpired(true);
          stopped = true;
        }
      } finally {
        if (!(cancelled || stopped)) {
          timer = setTimeout(poll, SESSIONS_POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isSignedIn]);

  // Forward to the console ONLY when it's unambiguous (exactly one live
  // session). Two or more — a stray /play tab, a second device — render the
  // picker below instead of silently guessing the newest; polling keeps
  // running, so when the list shrinks back to one this auto-resolves.
  useEffect(() => {
    if (sessions.length !== 1) {
      return;
    }
    const only = sessions[0]?.liveSessionId as LiveSessionId | undefined;
    if (only) {
      router.replace(consoleHref(only));
    }
  }, [sessions, router]);

  if (isPending) {
    return <Shell>loading…</Shell>;
  }

  if (!isSignedIn) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="font-serif text-[15px] text-[color:var(--paper)]/85">
            sign in to open your console.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/login?next=/control"
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              sign in
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (authExpired) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="font-serif text-[15px] text-[color:var(--paper)]/85">
            your sign-in expired — sign in again to get back to the console.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/login?next=/control"
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              sign in
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (sessions.length === 0) {
    return (
      <Shell>
        <div className="flex max-w-md flex-col gap-8">
          <p className="text-center font-serif text-[17px] text-[color:var(--paper)]/85">
            nothing live yet.
          </p>

          {/* The common case first: one device — this screen IS the show. */}
          <div className="flex flex-col gap-2">
            <p className="font-sans text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
              one screen?
            </p>
            <p className="font-serif text-[14px] normal-case tracking-normal text-[color:var(--paper)]/85">
              press play — this device becomes the show.
            </p>
            <Button asChild size="sm" className="w-fit">
              <Link
                href="/play"
                className="font-sans text-[11px] uppercase tracking-[0.24em]"
              >
                play
              </Link>
            </Button>
          </div>

          {/* Two devices: projector runs /play; this page catches it. */}
          <div className="flex flex-col gap-2">
            <p className="font-sans text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
              two screens?
            </p>
            <p className="font-serif text-[14px] normal-case tracking-normal leading-relaxed text-[color:var(--paper)]/85">
              open <span className="font-mono text-[12px]">sonara.fm/play</span>{" "}
              on the projector and sign in as you. the moment it&apos;s live,
              your console opens here on its own.
            </p>
            <p className="breath flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-[color:var(--signal)]"
              />
              watching for your projector…
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  if (sessions.length > 1) {
    return (
      <Shell>
        <div className="flex w-full max-w-md flex-col gap-4">
          <p className="text-center font-serif text-[17px] normal-case tracking-normal text-[color:var(--paper)]/85">
            {sessions.length} shows are live — which console?
          </p>
          <ul className="flex flex-col gap-1.5">
            {sessions.map((s) => (
              <li key={s.liveSessionId}>
                <Link
                  href={consoleHref(s.liveSessionId as LiveSessionId)}
                  className="focus-ring flex items-baseline justify-between gap-3 rounded-sm border border-[color:var(--hairline)]/30 px-3 py-2.5 transition-colors hover:border-[color:var(--paper)]/40"
                >
                  <span className="line-clamp-1 font-serif text-[13px] normal-case italic tracking-normal text-[color:var(--paper)]/85">
                    {s.prompt ||
                      (s.demoDeck ? `${deckLabel(s.demoDeck)} · deck` : "untitled show")}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                    started {startedAgo(s.startedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-center font-sans text-[10px] normal-case tracking-[0.06em] text-[color:var(--stone)]">
            stray tab? close its play screen and this list shrinks.
          </p>
        </div>
      </Shell>
    );
  }

  return <Shell>opening your console…</Shell>;
}
