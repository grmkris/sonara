"use client";

import { ORPCError } from "@orpc/client";
import { deckLabel } from "@sonara/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";

import { AppNavLinks } from "@/components/app-nav";
import { Mark } from "@/components/brand/mark";
import { StageManager } from "@/components/control/stage-manager";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";

// /control ("live" in the nav) — the console resolver. Every stage has its
// own permanent console at /stage/<code>/console; this alias resolves YOUR
// stages and forwards when unambiguous: 0 live → onboarding, 1 live → that
// console, several live → a NAMED picker (each entry is a stage you created
// and named — never an anonymous session id). The mixer itself never renders
// here — one page, one persona.

type StageEntry = Awaited<
  ReturnType<AppRouterClient["control"]["stages"]>
>["stages"][number];

const STAGES_POLL_MS = 3000;

const consoleHref = (stage: StageEntry): string =>
  `/stage/${stage.code}/console`;

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

// ?manage=1 suppresses the 1-live auto-forward so the stage list is reachable
// even mid-gig (the console header links here). useSearchParams must live in
// its own Suspense boundary (Next 16).
const ManageFlag = ({ onManage }: { onManage: () => void }) => {
  const searchParams = useSearchParams();
  const manage = searchParams.get("manage") === "1";
  useEffect(() => {
    if (manage) {
      onManage();
    }
  }, [manage, onManage]);
  return null;
};

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

  const [stages, setStages] = useState<StageEntry[] | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [manage, setManage] = useState(false);
  const onManage = useCallback(() => setManage(true), []);
  // Bumped after rename/create so the list refreshes immediately (the 3s poll
  // would catch up anyway; this just feels right).
  const [refreshNonce, setRefreshNonce] = useState(0);
  const onChanged = useCallback(() => setRefreshNonce((n) => n + 1), []);

  // Discover the caller's stages; keep polling so the page resolves the
  // moment a screen connects somewhere.
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        const { stages: next } = await rpcClient.control.stages();
        if (!cancelled) {
          setStages(next);
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
          timer = setTimeout(poll, STAGES_POLL_MS);
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
  }, [isSignedIn, refreshNonce]);

  const liveStages = (stages ?? []).filter((s) => s.live);

  // Forward ONLY when unambiguous (exactly one live stage). Several live —
  // a second named stage mid-gig — render the picker; polling keeps running,
  // so when the list shrinks back to one this auto-resolves.
  useEffect(() => {
    if (manage || liveStages.length !== 1) {
      return;
    }
    const [only] = liveStages;
    if (only) {
      router.replace(consoleHref(only));
    }
  }, [liveStages, router, manage]);

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

  if (stages === null) {
    return <Shell>loading…</Shell>;
  }

  if (manage || liveStages.length === 0) {
    return (
      <Shell>
        <div className="flex w-full max-w-md flex-col gap-8">
          <Suspense fallback={null}>
            <ManageFlag onManage={onManage} />
          </Suspense>
          {liveStages.length > 0 && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-center font-serif text-[15px] normal-case tracking-normal text-[color:var(--paper)]/85">
                {liveStages.length === 1
                  ? "one stage is live."
                  : `${liveStages.length} stages are live.`}
              </p>
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={
                    liveStages.length === 1 && liveStages[0]
                      ? consoleHref(liveStages[0])
                      : "/control"
                  }
                  className="font-sans text-[11px] uppercase tracking-[0.24em]"
                >
                  open the console
                </Link>
              </Button>
            </div>
          )}
          {liveStages.length === 0 && (
            <p className="text-center font-serif text-[17px] text-[color:var(--paper)]/85">
              nothing live yet.
            </p>
          )}

          {/* The common case first: one device — this screen IS the show. */}
          {liveStages.length === 0 && (
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
          )}

          {/* Two devices: projector runs /play; this page catches it. */}
          {liveStages.length === 0 && (
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
          )}

          <StageManager stages={stages} onChanged={onChanged} />
        </div>
      </Shell>
    );
  }

  if (liveStages.length > 1) {
    return (
      <Shell>
        <div className="flex w-full max-w-md flex-col gap-4">
          <p className="text-center font-serif text-[17px] normal-case tracking-normal text-[color:var(--paper)]/85">
            {liveStages.length} stages are live — which console?
          </p>
          <ul className="flex flex-col gap-1.5">
            {liveStages.map((s) => (
              <li key={s.stageId}>
                <Link
                  href={consoleHref(s)}
                  className="focus-ring flex items-baseline justify-between gap-3 rounded-sm border border-[color:var(--hairline)]/30 px-3 py-2.5 transition-colors hover:border-[color:var(--paper)]/40"
                >
                  <span className="line-clamp-1 font-serif text-[13px] normal-case italic tracking-normal text-[color:var(--paper)]/85">
                    {s.name}
                    <span className="not-italic text-[color:var(--stone)]">
                      {" · "}
                      {s.run?.prompt ||
                        (s.run?.demoDeck
                          ? `${deckLabel(s.run.demoDeck)} · deck`
                          : "idle")}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                    {s.run ? `started ${startedAgo(s.run.startedAt)}` : "live"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-center font-sans text-[10px] normal-case tracking-[0.06em] text-[color:var(--stone)]">
            each row is a stage you named — close its screen and the list
            shrinks.
          </p>

          <StageManager stages={stages} onChanged={onChanged} />
        </div>
      </Shell>
    );
  }

  return <Shell>opening your console…</Shell>;
}
