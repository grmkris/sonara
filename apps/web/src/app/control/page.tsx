"use client";

import { ORPCError } from "@orpc/client";
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

  // Forward to the newest session's permalink. The set id is derivable from
  // the liveSessionId (same uuid, set_ prefix) — no extra round trip.
  useEffect(() => {
    const newest = sessions[0]?.liveSessionId as LiveSessionId | undefined;
    if (!newest) {
      return;
    }
    const setId = typeIdFromUuid("frameSet", typeIdToUuid(newest).uuid);
    router.replace(`/s/${setId}`);
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

  return <Shell>opening your console…</Shell>;
}
