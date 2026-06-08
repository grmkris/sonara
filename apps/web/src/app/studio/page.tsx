"use client";

import type { LibraryFrame, Reel, ReelSummary, SessionSummary } from "@sonara/shared";
import type { ImageLibraryId, LiveSessionId, ReelId } from "@sonara/shared/typeid";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AnonCta } from "@/components/studio/anon-cta";
import { EmptyState } from "@/components/studio/empty-state";
import { ErrorState } from "@/components/studio/error-state";
import { FrameInspector } from "@/components/studio/frame-inspector";
import { FrameInspectorContent } from "@/components/studio/frame-inspector-content";
import { ReelEditor } from "@/components/studio/reel-editor";
import { ReelsList } from "@/components/studio/reels-list";
import { SessionTimeline } from "@/components/studio/session-timeline";
import { SessionsList } from "@/components/studio/sessions-list";
import { StudioSidebarTabs } from "@/components/studio/studio-sidebar-tabs";
import type { StudioTab } from "@/components/studio/studio-sidebar-tabs";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// /studio — the user's library editor. Two tabs: "sessions" (live history,
// derived from generated frames; replayable) and "reels" (curated, named groups
// of frames the user assembles, reorders, and replays). Browse, inspect a
// frame's metadata + context, act on it (anchor / reseed / download / copy /
// add-to-reel), and replay a session or reel in /play.

const StudioFallback = () => (
  <main className="flex min-h-svh items-center justify-center bg-[color:var(--ink)] text-[color:var(--stone)]">
    <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
      loading…
    </span>
  </main>
);

const reelsHref = (reelId?: string, frameId?: string): string => {
  const qs = new URLSearchParams({ tab: "reels" });
  if (reelId) {
    qs.set("reel", reelId);
  }
  if (frameId) {
    qs.set("frame", frameId);
  }
  return `/studio?${qs.toString()}`;
};

// Right-side header tally for the sessions tab. Extracted so its conditionals
// don't inflate StudioInner's complexity.
const HeaderCount = ({
  tab,
  sessions,
  bootstrapped,
}: {
  tab: StudioTab;
  sessions: SessionSummary[];
  bootstrapped: boolean;
}) => {
  if (tab !== "sessions" || !bootstrapped || sessions.length === 0) {
    return null;
  }
  const totalFrames = sessions.reduce((sum, s) => sum + s.frameCount, 0);
  return (
    <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      {totalFrames} frame{totalFrames === 1 ? "" : "s"} · {sessions.length}{" "}
      session{sessions.length === 1 ? "" : "s"}
    </span>
  );
};

const StudioInner = () => {
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;
  const sp = useSearchParams();
  const router = useRouter();

  const tab: StudioTab = sp.get("tab") === "reels" ? "reels" : "sessions";
  const selectedSessionId = sp.get("session");
  const selectedReelId = sp.get("reel");
  const selectedFrameId = sp.get("frame");

  // --- Sessions (live history) ---
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsBootstrapped, setSessionsBootstrapped] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);

  const [frames, setFrames] = useState<LibraryFrame[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  const [framesError, setFramesError] = useState(false);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);

  // --- Reels (curated) ---
  const [reels, setReels] = useState<ReelSummary[]>([]);
  const [reelsLoading, setReelsLoading] = useState(false);
  const [reelsBootstrapped, setReelsBootstrapped] = useState(false);
  const [reelDetail, setReelDetail] = useState<Reel | null>(null);
  const [reelDetailLoading, setReelDetailLoading] = useState(false);
  const [reelDetailError, setReelDetailError] = useState(false);

  // Retry / refresh nonces.
  const [reloadNonce, setReloadNonce] = useState(0);
  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);
  const [reelsNonce, setReelsNonce] = useState(0);
  const refreshReels = useCallback(() => setReelsNonce((n) => n + 1), []);
  const [reelDetailNonce, setReelDetailNonce] = useState(0);
  const retryReelDetail = useCallback(
    () => setReelDetailNonce((n) => n + 1),
    []
  );

  // Sessions list bootstrap.
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError(false);
    const run = async () => {
      try {
        const { sessions: s } = await rpcClient.library.sessions({});
        if (cancelled) {
          return;
        }
        setSessions(s);
        setSessionsLoading(false);
        setSessionsBootstrapped(true);
      } catch {
        if (cancelled) {
          return;
        }
        setSessionsError(true);
        setSessionsLoading(false);
        setSessionsBootstrapped(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, reloadNonce]);

  // Reels list bootstrap (signed-in; refreshed via reelsNonce on mutations).
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    setReelsLoading(true);
    const run = async () => {
      try {
        const { reels: r } = await rpcClient.reels.list({});
        if (cancelled) {
          return;
        }
        setReels(r);
        setReelsLoading(false);
        setReelsBootstrapped(true);
      } catch {
        if (cancelled) {
          return;
        }
        setReelsLoading(false);
        setReelsBootstrapped(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, reelsNonce]);

  // Auto-select most recent session when on the sessions tab with none chosen.
  useEffect(() => {
    if (tab !== "sessions" || !sessionsBootstrapped || selectedSessionId) {
      return;
    }
    const [newest] = sessions;
    if (newest) {
      router.replace(`/studio?session=${encodeURIComponent(newest.sessionId)}`);
    }
  }, [tab, sessionsBootstrapped, selectedSessionId, sessions, router]);

  // Auto-select most recent reel when on the reels tab with none chosen.
  useEffect(() => {
    if (tab !== "reels" || !reelsBootstrapped || selectedReelId) {
      return;
    }
    const [newest] = reels;
    if (newest) {
      router.replace(reelsHref(newest.id));
    }
  }, [tab, reelsBootstrapped, selectedReelId, reels, router]);

  // Load session frames when the session selection changes.
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
    const run = async () => {
      try {
        const { frames: f } = await rpcClient.library.bySession({
          sessionId: selectedSessionId as LiveSessionId,
        });
        if (cancelled) {
          return;
        }
        setFrames(f);
        setLoadedSessionId(selectedSessionId);
        setFramesLoading(false);
      } catch {
        if (cancelled) {
          return;
        }
        setFramesError(true);
        setFramesLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, selectedSessionId, loadedSessionId, reloadNonce]);

  // Load reel detail when the reel selection (or retry nonce) changes.
  useEffect(() => {
    if (!isSignedIn || !selectedReelId) {
      setReelDetail(null);
      return;
    }
    let cancelled = false;
    setReelDetailLoading(true);
    setReelDetailError(false);
    const run = async () => {
      try {
        const r = await rpcClient.reels.get({ reelId: selectedReelId as ReelId });
        if (cancelled) {
          return;
        }
        setReelDetail(r);
        setReelDetailLoading(false);
      } catch {
        if (cancelled) {
          return;
        }
        setReelDetailError(true);
        setReelDetailLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, selectedReelId, reelDetailNonce]);

  const selectedFrame = useMemo(() => {
    const pool = tab === "reels" ? (reelDetail?.frames ?? []) : frames;
    return pool.find((f) => f.id === selectedFrameId) ?? null;
  }, [tab, frames, reelDetail, selectedFrameId]);

  // --- Navigation handlers ---
  const onTab = useCallback(
    (next: StudioTab) => {
      router.push(next === "reels" ? "/studio?tab=reels" : "/studio");
    },
    [router]
  );

  const onSelectSession = useCallback(
    (sessionId: string) => {
      router.push(`/studio?session=${encodeURIComponent(sessionId)}`);
    },
    [router]
  );

  const onSelectReel = useCallback(
    (reelId: string) => {
      router.push(reelsHref(reelId));
    },
    [router]
  );

  const onSelectFrame = useCallback(
    (frameId: string) => {
      if (tab === "reels") {
        if (!selectedReelId) {
          return;
        }
        router.push(reelsHref(selectedReelId, frameId));
        return;
      }
      if (!selectedSessionId) {
        return;
      }
      router.push(
        `/studio?session=${encodeURIComponent(selectedSessionId)}&frame=${encodeURIComponent(frameId)}`
      );
    },
    [router, tab, selectedReelId, selectedSessionId]
  );

  const onCloseInspector = useCallback(() => {
    if (tab === "reels") {
      router.replace(selectedReelId ? reelsHref(selectedReelId) : "/studio?tab=reels");
      return;
    }
    router.replace(
      selectedSessionId
        ? `/studio?session=${encodeURIComponent(selectedSessionId)}`
        : "/studio"
    );
  }, [router, tab, selectedReelId, selectedSessionId]);

  const onBackToList = useCallback(() => {
    router.replace(tab === "reels" ? "/studio?tab=reels" : "/studio");
  }, [router, tab]);

  // --- Reel mutations (optimistic; sidebar refreshed via refreshReels) ---
  const onCreateReel = useCallback(
    (name: string) => {
      void (async () => {
        try {
          const { reel } = await rpcClient.reels.create({ name });
          refreshReels();
          router.push(reelsHref(reel.id));
          toast(`created “${reel.name}”`, { duration: 1600 });
        } catch {
          toast.error("couldn't create reel");
        }
      })();
    },
    [refreshReels, router]
  );

  const onRenameReel = useCallback(
    (name: string) => {
      if (!(reelDetail && selectedReelId)) {
        return;
      }
      const prev = reelDetail.name;
      setReelDetail((d) => (d ? { ...d, name } : d));
      void (async () => {
        try {
          await rpcClient.reels.rename({ name, reelId: selectedReelId as ReelId });
          refreshReels();
        } catch {
          setReelDetail((d) => (d ? { ...d, name: prev } : d));
          toast.error("rename failed");
        }
      })();
    },
    [reelDetail, selectedReelId, refreshReels]
  );

  const onDeleteReel = useCallback(() => {
    if (!selectedReelId) {
      return;
    }
    void (async () => {
      try {
        await rpcClient.reels.remove({ reelId: selectedReelId as ReelId });
        refreshReels();
        router.replace("/studio?tab=reels");
        toast("reel deleted", { duration: 1600 });
      } catch {
        toast.error("couldn't delete reel");
      }
    })();
  }, [selectedReelId, refreshReels, router]);

  const onMoveFrame = useCallback(
    (frameId: string, dir: "prev" | "next") => {
      if (!(reelDetail && selectedReelId)) {
        return;
      }
      const ids = reelDetail.frames.map((f) => f.id);
      const i = ids.indexOf(frameId as ImageLibraryId);
      if (i === -1) {
        return;
      }
      const j = dir === "prev" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) {
        return;
      }
      const reordered = [...reelDetail.frames];
      const [moved] = reordered.splice(i, 1);
      if (moved) {
        reordered.splice(j, 0, moved);
      }
      const prevFrames = reelDetail.frames;
      setReelDetail((d) => (d ? { ...d, frames: reordered } : d));
      void (async () => {
        try {
          await rpcClient.reels.reorder({
            orderedFrameIds: reordered.map((f) => f.id),
            reelId: selectedReelId as ReelId,
          });
          refreshReels();
        } catch {
          setReelDetail((d) => (d ? { ...d, frames: prevFrames } : d));
          toast.error("reorder failed");
        }
      })();
    },
    [reelDetail, selectedReelId, refreshReels]
  );

  const onRemoveFrame = useCallback(
    (frameId: string) => {
      if (!(reelDetail && selectedReelId)) {
        return;
      }
      const prevFrames = reelDetail.frames;
      setReelDetail((d) =>
        d ? { ...d, frames: d.frames.filter((f) => f.id !== frameId) } : d
      );
      // If the open inspector frame was removed, close it.
      if (selectedFrameId === frameId) {
        router.replace(reelsHref(selectedReelId));
      }
      void (async () => {
        try {
          await rpcClient.reels.removeFrame({
            frameId: frameId as ImageLibraryId,
            reelId: selectedReelId as ReelId,
          });
          refreshReels();
        } catch {
          setReelDetail((d) => (d ? { ...d, frames: prevFrames } : d));
          toast.error("couldn't remove frame");
        }
      })();
    },
    [reelDetail, selectedReelId, selectedFrameId, refreshReels, router]
  );

  const onSetCover = useCallback(
    (frameId: string) => {
      if (!(reelDetail && selectedReelId)) {
        return;
      }
      const prev = reelDetail.coverFrameId;
      setReelDetail((d) =>
        d ? { ...d, coverFrameId: frameId as ImageLibraryId } : d
      );
      void (async () => {
        try {
          await rpcClient.reels.setCover({
            frameId: frameId as ImageLibraryId,
            reelId: selectedReelId as ReelId,
          });
          refreshReels();
          toast("cover set", { duration: 1400 });
        } catch {
          setReelDetail((d) => (d ? { ...d, coverFrameId: prev } : d));
          toast.error("couldn't set cover");
        }
      })();
    },
    [reelDetail, selectedReelId, refreshReels]
  );

  // Auth gate.
  if (isPending) {
    return <StudioFallback />;
  }
  if (!isSignedIn) {
    return <AnonCta />;
  }

  const showInspectorOnDesktop = !!selectedFrame;
  // Mobile: the center pane takes over once a session/reel is chosen.
  const showMobileCenter =
    tab === "reels" ? !!selectedReelId : !!selectedSessionId;

  const renderSessionsCenter = () => {
    if (!sessionsBootstrapped) {
      return (
        <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          loading…
        </div>
      );
    }
    if (sessionsError) {
      return <ErrorState onRetry={retry} />;
    }
    if (sessions.length === 0) {
      return <EmptyState />;
    }
    if (!selectedSessionId) {
      return (
        <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          select a session
        </div>
      );
    }
    if (framesError) {
      return <ErrorState onRetry={retry} />;
    }
    return (
      <SessionTimeline
        frames={frames}
        loading={framesLoading}
        selectedFrameId={selectedFrameId}
        onSelectFrame={onSelectFrame}
      />
    );
  };

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
        <HeaderCount
          tab={tab}
          sessions={sessions}
          bootstrapped={sessionsBootstrapped}
        />
      </header>

      {/* Body — 3-panel desktop / drilldown mobile */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail: tabs + the active tab's list */}
        <aside
          className={cn(
            "shrink-0 overflow-y-auto border-r border-[color:var(--hairline)]/30",
            "hidden md:block md:w-[280px]",
            !showMobileCenter && "block w-full md:w-[280px]"
          )}
        >
          <StudioSidebarTabs tab={tab} onTab={onTab} />
          {tab === "sessions" ? (
            <SessionsList
              sessions={sessions}
              loading={sessionsLoading}
              bootstrapped={sessionsBootstrapped}
              selectedSessionId={selectedSessionId}
              onSelect={onSelectSession}
            />
          ) : (
            <ReelsList
              reels={reels}
              loading={reelsLoading}
              bootstrapped={reelsBootstrapped}
              selectedReelId={selectedReelId}
              onSelect={onSelectReel}
              onCreate={onCreateReel}
            />
          )}
        </aside>

        {/* Center pane */}
        <section
          className={cn(
            "flex-1 overflow-hidden",
            !showMobileCenter && "hidden md:block"
          )}
        >
          {showMobileCenter && (
            <div className="border-b border-[color:var(--hairline)]/30 px-4 py-2 md:hidden">
              <button
                type="button"
                onClick={onBackToList}
                className="focus-ring font-sans inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] hover:text-[color:var(--paper)]"
                aria-label="back"
              >
                <ChevronLeft className="size-3" strokeWidth={1.5} />
                <span>{tab === "reels" ? "reels" : "sessions"}</span>
              </button>
            </div>
          )}

          {tab === "sessions" ? (
            renderSessionsCenter()
          ) : (
            <ReelEditor
              reel={reelDetail}
              loading={reelDetailLoading}
              error={reelDetailError}
              onRetry={retryReelDetail}
              selectedFrameId={selectedFrameId}
              onSelectFrame={onSelectFrame}
              coverFrameId={reelDetail?.coverFrameId ?? null}
              onRename={onRenameReel}
              onDelete={onDeleteReel}
              onMoveFrame={onMoveFrame}
              onRemoveFrame={onRemoveFrame}
              onSetCover={onSetCover}
            />
          )}
        </section>

        {/* Desktop inspector pane */}
        {showInspectorOnDesktop && selectedFrame && (
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-[color:var(--hairline)]/30 md:block">
            <FrameInspector frame={selectedFrame} onClose={onCloseInspector} />
          </aside>
        )}
      </div>

      {/* Mobile inspector — Sheet from the right. */}
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
};

export default function StudioPage() {
  return (
    <Suspense fallback={<StudioFallback />}>
      <StudioInner />
    </Suspense>
  );
}
