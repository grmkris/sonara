"use client";

import { ORPCError } from "@orpc/client";
import type { LiveSessionId } from "@sonara/shared/typeid";
import { typeIdFromUuid, typeIdToUuid } from "@sonara/shared/typeid";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";

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
  <main className="flex min-h-svh items-center justify-center bg-[color:var(--ink)] px-6 text-[color:var(--stone)]">
    <div className="font-mono text-[11px] uppercase tracking-[0.22em]">
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
            sign in to control your live session.
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
            your session expired — sign in again to keep controlling.
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
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="font-serif text-[15px] text-[color:var(--paper)]/85">
            no live session yet.
          </p>
          <p className="font-sans text-[11px] leading-relaxed tracking-[0.06em] text-[color:var(--stone)]">
            open the visualizer on your projector and sign in with this account
            — it&apos;ll show up here, and you can drive it from this screen.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/play"
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              open the visualizer
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  return <Shell>opening your session…</Shell>;
}
