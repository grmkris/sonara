"use client";

import type { LibraryFrame, SessionSummary } from "@sonara/shared";
import type { LiveSessionId } from "@sonara/shared/typeid";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AnonCta } from "@/components/studio/anon-cta";
import { EmptyState } from "@/components/studio/empty-state";
import { ErrorState } from "@/components/studio/error-state";
import { FrameInspector } from "@/components/studio/frame-inspector";
import { FrameInspectorContent } from "@/components/studio/frame-inspector-content";
import { SessionTimeline } from "@/components/studio/session-timeline";
import { SessionsList } from "@/components/studio/sessions-list";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// /studio — the user's library editor. Browse past sessions, scrub a
// time-coded timeline of generated frames, inspect any frame's
// metadata + context, and act on it (use as anchor / reseed / download /
// copy prompt). Audio replay is out of scope at this stage.

export default function StudioPage() {
  return (
    <Suspense fallback={<StudioFallback />}>
      <StudioInner />
    </Suspense>
  );
}

function StudioFallback() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[color:var(--ink)] text-[color:var(--stone)]">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
        loading…
      </span>
    </main>
  );
}

function StudioInner() {
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;
  const sp = useSearchParams();
  const router = useRouter();

  const selectedSessionId = sp.get("session");
  const selectedFrameId = sp.get("frame");

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsBootstrapped, setSessionsBootstrapped] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);

  const [frames, setFrames] = useState<LibraryFrame[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  const [framesError, setFramesError] = useState(false);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);

  // Retry nonce — bumped by the ErrorState retry button to re-run the fetches.
  const [reloadNonce, setReloadNonce] = useState(0);
  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);

  // Sessions list bootstrap.
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError(false);
    rpcClient.library
      .sessions({})
      .then(({ sessions: s }) => {
        if (cancelled) {
          return;
        }
        setSessions(s);
        setSessionsLoading(false);
        setSessionsBootstrapped(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        // Surface the error instead of flipping to a "0 sessions" empty state,
        // which would read as "you have no library" on a transient failure.
        setSessionsError(true);
        setSessionsLoading(false);
        setSessionsBootstrapped(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, reloadNonce]);

  // Auto-select most recent session when none is selected yet.
  useEffect(() => {
    if (!sessionsBootstrapped) {
      return;
    }
    if (selectedSessionId) {
      return;
    }
    if (sessions.length === 0) {
      return;
    }
    const newest = sessions[0];
    if (newest) {
      router.replace(`/studio?session=${encodeURIComponent(newest.sessionId)}`);
    }
  }, [sessionsBootstrapped, selectedSessionId, sessions, router]);

  // Load frames when the session selection changes.
  useEffect(() => {
    if (!isSignedIn || !selectedSessionId) {
      return;
    }
    if (loadedSessionId === selectedSessionId) {
      return;
    }
    let cancelled = false;
    setFramesLoading(true);
    setFramesError(false);
    rpcClient.library
      .bySession({ sessionId: selectedSessionId as LiveSessionId })
      .then(({ frames: f }) => {
        if (cancelled) {
          return;
        }
        setFrames(f);
        setLoadedSessionId(selectedSessionId);
        setFramesLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setFramesError(true);
        setFramesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, selectedSessionId, loadedSessionId, reloadNonce]);

  const selectedFrame = useMemo(
    () => frames.find((f) => f.id === selectedFrameId) ?? null,
    [frames, selectedFrameId]
  );

  const onSelectSession = useCallback(
    (sessionId: string) => {
      router.push(`/studio?session=${encodeURIComponent(sessionId)}`);
    },
    [router]
  );

  const onSelectFrame = useCallback(
    (frameId: string) => {
      if (!selectedSessionId) {
        return;
      }
      router.push(
        `/studio?session=${encodeURIComponent(selectedSessionId)}&frame=${encodeURIComponent(frameId)}`
      );
    },
    [router, selectedSessionId]
  );

  const onCloseInspector = useCallback(() => {
    if (!selectedSessionId) {
      router.replace("/studio");
      return;
    }
    router.replace(`/studio?session=${encodeURIComponent(selectedSessionId)}`);
  }, [router, selectedSessionId]);

  const onBackToSessions = useCallback(() => {
    router.replace("/studio");
  }, [router]);

  // Auth gate. Wait for the session resolution; show anon CTA when
  // confirmed unauthenticated.
  if (isPending) {
    return <StudioFallback />;
  }
  if (!isSignedIn) {
    return <AnonCta />;
  }

  const totalFrames = sessions.reduce((sum, s) => sum + s.frameCount, 0);
  const showInspectorOnDesktop = !!selectedFrame;
  const showMobileTimeline = !!selectedSessionId;

  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-[color:var(--ink)] text-[color:var(--paper)]">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--hairline)]/30 px-4 py-3 md:px-10">
        <div className="flex items-center gap-4">
          <Link
            href="/play"
            className="focus-ring font-sans inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
          >
            <ChevronLeft className="size-3" strokeWidth={1.5} />
            <span>/play</span>
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--paper)]/85">
            studio
          </span>
        </div>
        {sessionsBootstrapped && sessions.length > 0 && (
          <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
            {totalFrames} frame{totalFrames !== 1 ? "s" : ""} ·{" "}
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        )}
      </header>

      {/* Body — 3-panel desktop / drilldown mobile */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sessions sidebar */}
        <aside
          className={cn(
            "shrink-0 overflow-y-auto border-r border-[color:var(--hairline)]/30",
            // Desktop: always visible at 280px.
            "hidden md:block md:w-[280px]",
            // Mobile: takes the full width when no session is selected.
            !showMobileTimeline && "block w-full md:w-[280px]"
          )}
        >
          <SessionsList
            sessions={sessions}
            loading={sessionsLoading}
            bootstrapped={sessionsBootstrapped}
            selectedSessionId={selectedSessionId}
            onSelect={onSelectSession}
          />
        </aside>

        {/* Center: timeline OR empty/no-selection state */}
        <section
          className={cn(
            "flex-1 overflow-hidden",
            // Mobile: hide when no session selected (sidebar takes over).
            !showMobileTimeline && "hidden md:block"
          )}
        >
          {/* Mobile back link */}
          {showMobileTimeline && (
            <div className="border-b border-[color:var(--hairline)]/30 px-4 py-2 md:hidden">
              <button
                type="button"
                onClick={onBackToSessions}
                className="focus-ring font-sans inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] hover:text-[color:var(--paper)]"
                aria-label="back to sessions"
              >
                <ChevronLeft className="size-3" strokeWidth={1.5} />
                <span>sessions</span>
              </button>
            </div>
          )}

          {!sessionsBootstrapped ? (
            <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
              loading…
            </div>
          ) : sessionsError ? (
            <ErrorState onRetry={retry} />
          ) : sessions.length === 0 ? (
            <EmptyState />
          ) : selectedSessionId ? (
            framesError ? (
              <ErrorState onRetry={retry} />
            ) : (
              <SessionTimeline
                frames={frames}
                loading={framesLoading}
                selectedFrameId={selectedFrameId}
                onSelectFrame={onSelectFrame}
              />
            )
          ) : (
            <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
              select a session
            </div>
          )}
        </section>

        {/* Desktop inspector pane */}
        {showInspectorOnDesktop && selectedFrame && (
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-[color:var(--hairline)]/30 md:block">
            <FrameInspector frame={selectedFrame} onClose={onCloseInspector} />
          </aside>
        )}
      </div>

      {/* Mobile inspector — Sheet sliding in from the right. Open state
          mirrors selectedFrame; closing clears the ?frame= param. */}
      <Sheet
        open={!!selectedFrame}
        onOpenChange={(open) => {
          if (!open) {
            onCloseInspector();
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-[min(420px,95vw)] border-l border-[color:var(--hairline)]/30 bg-[color:var(--ink)]/95 p-0 backdrop-blur-md md:hidden"
        >
          <SheetTitle className="border-b border-[color:var(--hairline)]/30 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            inspector
          </SheetTitle>
          <div className="max-h-[calc(100svh-50px)] overflow-y-auto">
            {selectedFrame && <FrameInspectorContent frame={selectedFrame} />}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
