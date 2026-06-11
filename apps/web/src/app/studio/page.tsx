"use client";

import type { FrameSet, FrameSetSummary } from "@sonara/shared";
import type { FrameSetId } from "@sonara/shared/typeid";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AppNavLinks } from "@/components/app-nav";
import { AnonCta } from "@/components/studio/anon-cta";
import { EmptyState } from "@/components/studio/empty-state";
import { ErrorState } from "@/components/studio/error-state";
import { FrameInspector } from "@/components/studio/frame-inspector";
import { FrameInspectorContent } from "@/components/studio/frame-inspector-content";
import { LiveNowCard } from "@/components/studio/live-now-card";
import { SelectionBar } from "@/components/studio/selection-bar";
import { SetEditor } from "@/components/studio/set-editor";
import { SetsList } from "@/components/studio/sets-list";
import { RecordingTimeline } from "@/components/studio/recording-timeline";
import { RecordingsList } from "@/components/studio/recordings-list";
import { StagesSection } from "@/components/studio/stages-section";
import { StudioSidebarTabs } from "@/components/studio/studio-sidebar-tabs";
import type { StudioTab } from "@/components/studio/studio-sidebar-tabs";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useFrameSelection } from "@/hooks/use-frame-selection";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useSetMutations } from "@/hooks/use-set-mutations";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import { recordingsHref, setsHref } from "@/lib/studio-hrefs";
import { cn } from "@/lib/utils";

// /studio — the user's set library. Two tabs: "recordings" (auto-captured
// live performances; frame list frozen, replayable on original timing) and
// "sets" (curated, named groups of frames the user assembles, reorders, and
// replays). Browse, inspect a frame's metadata + context, act on it (anchor /
// reseed / download / copy / add-to-set), make a cut of a recording, share a
// set, and replay either in /play.

const StudioFallback = () => (
  <main className="flex min-h-svh items-center justify-center bg-[color:var(--ink)] text-[color:var(--stone)]">
    <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
      loading…
    </span>
  </main>
);



// Right-side header tally for the recordings tab. Extracted so its
// conditionals don't inflate StudioInner's complexity.
const HeaderCount = ({
  tab,
  recordings,
  bootstrapped,
}: {
  tab: StudioTab;
  recordings: FrameSetSummary[];
  bootstrapped: boolean;
}) => {
  if (tab !== "recordings" || !bootstrapped || recordings.length === 0) {
    return null;
  }
  const totalFrames = recordings.reduce((sum, r) => sum + r.frameCount, 0);
  return (
    <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      {totalFrames} frame{totalFrames === 1 ? "" : "s"} · {recordings.length}{" "}
      recording{recordings.length === 1 ? "" : "s"}
    </span>
  );
};

// Visibility gate for the floating selection bar — extracted so its
// conditionals don't inflate StudioInner's complexity.
const StudioSelectionBar = ({
  selectedFrameIds,
  onClear,
  onAddTo,
  onCreateFrom,
  onAdded,
  onCreatedFromSelection,
}: {
  selectedFrameIds: string[];
  onClear: () => void;
  onAddTo: (
    target: { id: string; name: string },
    frameIds: string[]
  ) => Promise<number | null>;
  onCreateFrom: (
    frameIds: string[],
    name: string
  ) => Promise<FrameSetSummary | null>;
  onAdded: (target: { id: string; name: string }) => void;
  onCreatedFromSelection: (set: FrameSetSummary) => void;
}) => {
  if (selectedFrameIds.length === 0) {
    return null;
  }
  return (
    <SelectionBar
      selectedFrameIds={selectedFrameIds}
      onClear={onClear}
      onAddTo={onAddTo}
      onCreateFrom={onCreateFrom}
      onAdded={onAdded}
      onCreatedFromSelection={onCreatedFromSelection}
    />
  );
};

const StudioInner = () => {
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;
  const sp = useSearchParams();
  const router = useRouter();
  const isMobile = useIsMobile();

  const tab: StudioTab = sp.get("tab") === "sets" ? "sets" : "recordings";
  const selectedRecordingId = sp.get("recording");
  const selectedSetId = sp.get("set");
  const selectedFrameId = sp.get("frame");

  // --- Recordings (auto-captured live performances) ---
  const [recordings, setRecordings] = useState<FrameSetSummary[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsBootstrapped, setRecordingsBootstrapped] = useState(false);
  const [recordingsError, setRecordingsError] = useState(false);

  const [recordingDetail, setRecordingDetail] = useState<FrameSet | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingError, setRecordingError] = useState(false);
  const [loadedRecordingId, setLoadedRecordingId] = useState<string | null>(
    null
  );

  // --- Sets (curated) ---
  const [curatedSets, setCuratedSets] = useState<FrameSetSummary[]>([]);
  const [setsLoading, setSetsLoading] = useState(false);
  const [setsBootstrapped, setSetsBootstrapped] = useState(false);
  const [setDetail, setSetDetail] = useState<FrameSet | null>(null);
  const [setDetailLoading, setSetDetailLoading] = useState(false);
  const [setDetailError, setSetDetailError] = useState(false);

  // Retry / refresh nonces.
  const [reloadNonce, setReloadNonce] = useState(0);
  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);
  const [setsNonce, setSetsNonce] = useState(0);
  const refreshSets = useCallback(() => setSetsNonce((n) => n + 1), []);
  const [setDetailNonce, setSetDetailNonce] = useState(0);
  const retrySetDetail = useCallback(() => setSetDetailNonce((n) => n + 1), []);

  // Recordings list bootstrap.
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    setRecordingsLoading(true);
    setRecordingsError(false);
    const run = async () => {
      try {
        const { sets: s } = await rpcClient.sets.list({ origin: "recording" });
        if (cancelled) {
          return;
        }
        setRecordings(s);
        setRecordingsLoading(false);
        setRecordingsBootstrapped(true);
      } catch {
        if (cancelled) {
          return;
        }
        setRecordingsError(true);
        setRecordingsLoading(false);
        setRecordingsBootstrapped(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, reloadNonce]);

  // Curated sets list bootstrap (signed-in; refreshed via setsNonce on mutations).
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    setSetsLoading(true);
    const run = async () => {
      try {
        const { sets: s } = await rpcClient.sets.list({ origin: "curated" });
        if (cancelled) {
          return;
        }
        setCuratedSets(s);
        setSetsLoading(false);
        setSetsBootstrapped(true);
      } catch {
        if (cancelled) {
          return;
        }
        setSetsLoading(false);
        setSetsBootstrapped(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, setsNonce]);

  // Auto-select most recent recording when on the recordings tab with none chosen.
  useEffect(() => {
    if (tab !== "recordings" || !recordingsBootstrapped || selectedRecordingId) {
      return;
    }
    const [newest] = recordings;
    if (newest) {
      router.replace(recordingsHref(newest.id));
    }
  }, [tab, recordingsBootstrapped, selectedRecordingId, recordings, router]);

  // Auto-select most recent set when on the sets tab with none chosen.
  useEffect(() => {
    if (tab !== "sets" || !setsBootstrapped || selectedSetId) {
      return;
    }
    const [newest] = curatedSets;
    if (newest) {
      router.replace(setsHref(newest.id));
    }
  }, [tab, setsBootstrapped, selectedSetId, curatedSets, router]);

  // Load the recording detail when the recording selection changes.
  useEffect(() => {
    if (!isSignedIn || !selectedRecordingId) {
      return;
    }
    if (loadedRecordingId === selectedRecordingId) {
      return;
    }
    let cancelled = false;
    setRecordingLoading(true);
    setRecordingError(false);
    const run = async () => {
      try {
        const detail = await rpcClient.sets.get({
          setId: selectedRecordingId as FrameSetId,
        });
        if (cancelled) {
          return;
        }
        setRecordingDetail(detail);
        setLoadedRecordingId(selectedRecordingId);
        setRecordingLoading(false);
      } catch {
        if (cancelled) {
          return;
        }
        setRecordingError(true);
        setRecordingLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, selectedRecordingId, loadedRecordingId, reloadNonce]);

  // Load the set detail when the set selection (or retry nonce) changes.
  useEffect(() => {
    if (!isSignedIn || !selectedSetId) {
      setSetDetail(null);
      return;
    }
    let cancelled = false;
    setSetDetailLoading(true);
    setSetDetailError(false);
    const run = async () => {
      try {
        const detail = await rpcClient.sets.get({
          setId: selectedSetId as FrameSetId,
        });
        if (cancelled) {
          return;
        }
        setSetDetail(detail);
        setSetDetailLoading(false);
      } catch {
        if (cancelled) {
          return;
        }
        setSetDetailError(true);
        setSetDetailLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, selectedSetId, setDetailNonce]);

  const selectedFrame = useMemo(() => {
    const pool =
      tab === "sets" ? (setDetail?.frames ?? []) : (recordingDetail?.frames ?? []);
    return pool.find((f) => f.id === selectedFrameId) ?? null;
  }, [tab, recordingDetail, setDetail, selectedFrameId]);

  // --- Multi-select curation ---
  const displayOrder = useMemo(() => {
    const pool =
      tab === "sets" ? (setDetail?.frames ?? []) : (recordingDetail?.frames ?? []);
    return pool.map((f) => f.id as string);
  }, [tab, recordingDetail, setDetail]);

  // Hopping recordings/sets drops the selection but keeps the PIN — the
  // multi-recording sweep flow. Selection itself is implicit: it exists
  // whenever frames are selected (check / cmd-click / long-press / pill).
  const selection = useFrameSelection({
    displayOrder,
    resetKey: `${tab}|${selectedRecordingId}|${selectedSetId}`,
  });
  const {
    clear: clearSelection,
    isSelecting,
    selectedFrameIds,
  } = selection;

  // A batch landed in `target`: keep select mode (next recording, same set),
  // drop the selection, and refresh whatever shows the target's frame count.
  const onSelectionAdded = useCallback(
    (target: { id: string; name: string }) => {
      clearSelection();
      refreshSets();
      if (selectedSetId === target.id) {
        retrySetDetail();
      }
    },
    [clearSelection, refreshSets, selectedSetId, retrySetDetail]
  );

  const onSelectionCreated = useCallback(
    (created: FrameSetSummary) => {
      clearSelection();
      refreshSets();
      router.push(setsHref(created.id));
    },
    [clearSelection, refreshSets, router]
  );

  // --- Navigation handlers ---
  const onTab = useCallback(
    (next: StudioTab) => {
      router.push(next === "sets" ? "/studio?tab=sets" : "/studio");
    },
    [router]
  );

  const onSelectRecording = useCallback(
    (recordingId: string) => {
      router.push(recordingsHref(recordingId));
    },
    [router]
  );

  const onSelectSet = useCallback(
    (setId: string) => {
      router.push(setsHref(setId));
    },
    [router]
  );

  // Open the inspector for a frame (double-click / plain click outside a
  // selection context / Enter later).
  const onFrameOpen = useCallback(
    (frameId: string) => {
      if (tab === "sets") {
        if (!selectedSetId) {
          return;
        }
        router.push(setsHref(selectedSetId, frameId));
        return;
      }
      if (!selectedRecordingId) {
        return;
      }
      router.push(recordingsHref(selectedRecordingId, frameId));
    },
    [router, tab, selectedSetId, selectedRecordingId]
  );

  // THE click matrix — one resolution point for both surfaces:
  // plain = inspect (or toggle while selecting); cmd/ctrl = toggle always;
  // shift = range (no anchor → plain); check/long-press = toggle always.
  const onFrameClick = useCallback(
    (frameId: string, mods: { shiftKey: boolean; metaOrCtrl: boolean }) => {
      if (mods.metaOrCtrl) {
        selection.toggle(frameId);
        return;
      }
      if (mods.shiftKey && isSelecting) {
        selection.rangeTo(frameId);
        return;
      }
      if (isSelecting) {
        selection.toggle(frameId);
        return;
      }
      onFrameOpen(frameId);
    },
    [selection, isSelecting, onFrameOpen]
  );

  const onFrameCheck = useCallback(
    (frameId: string) => selection.toggle(frameId),
    [selection]
  );

  const onCloseInspector = useCallback(() => {
    if (tab === "sets") {
      router.replace(selectedSetId ? setsHref(selectedSetId) : "/studio?tab=sets");
      return;
    }
    router.replace(recordingsHref(selectedRecordingId ?? undefined));
  }, [router, tab, selectedSetId, selectedRecordingId]);

  const onBackToList = useCallback(() => {
    router.replace(tab === "sets" ? "/studio?tab=sets" : "/studio");
  }, [router, tab]);

  // Esc clears the selection (else closes the inspector); cmd/ctrl+A selects
  // the visible pool — but only once a selection exists or the pin is on, so
  // the browser keeps its native select-all elsewhere. (Folds into the full
  // keyboard cursor in C7.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        if (selectedFrameIds.length > 0) {
          e.preventDefault();
          clearSelection();
        } else if (selectedFrameId) {
          e.preventDefault();
          onCloseInspector();
        }
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "a" &&
        isSelecting &&
        displayOrder.length > 0
      ) {
        e.preventDefault();
        selection.selectAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedFrameIds.length,
    selectedFrameId,
    clearSelection,
    onCloseInspector,
    isSelecting,
    displayOrder.length,
    selection,
  ]);

  // --- Set mutations: one hook owns optimistic updates, the serialization
  // queue, and the undo toasts (see use-set-mutations.ts). ---
  const mutations = useSetMutations({
    recordingDetail,
    refreshSets,
    retrySetDetail,
    router,
    selectedFrameId,
    selectedSetId,
    setDetail,
    setRecordingDetail,
    setSetDetail,
  });
  const onCreateSet = mutations.createSet;
  const onMakeCut = mutations.makeCut;
  const onRenameSet = mutations.renameSet;
  const onDeleteSet = mutations.deleteSet;
  const onMoveFrame = mutations.moveFrame;
  const onSetCover = mutations.setCover;
  const onSetVisibility = mutations.setVisibility;
  const onRecordingVisibility = mutations.recordingVisibility;
  const onRemoveFrame = useCallback(
    (frameId: string) => mutations.removeFrames([frameId]),
    [mutations]
  );

  // Auth gate.
  if (isPending) {
    return <StudioFallback />;
  }
  if (!isSignedIn) {
    return <AnonCta />;
  }

  const showInspectorOnDesktop = !!selectedFrame;
  // Mobile: the center pane takes over once a recording/set is chosen.
  const showMobileCenter =
    tab === "sets" ? !!selectedSetId : !!selectedRecordingId;

  const renderRecordingsCenter = () => {
    if (!recordingsBootstrapped) {
      return (
        <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          loading…
        </div>
      );
    }
    if (recordingsError) {
      return <ErrorState onRetry={retry} />;
    }
    if (recordings.length === 0) {
      return <EmptyState />;
    }
    if (!selectedRecordingId) {
      return (
        <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          select a recording
        </div>
      );
    }
    if (recordingError) {
      return <ErrorState onRetry={retry} />;
    }
    return (
      <RecordingTimeline
        recording={recordingDetail}
        loading={recordingLoading}
        selectedFrameId={selectedFrameId}
        onMakeCut={onMakeCut}
        onVisibilityChange={onRecordingVisibility}
        onFrameClick={onFrameClick}
        onFrameOpen={onFrameOpen}
        onFrameCheck={onFrameCheck}
        isSelected={selection.isSelected}
        isSelecting={isSelecting}
        pinned={selection.pinned}
        onTogglePinned={selection.togglePinned}
      />
    );
  };

  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-[color:var(--ink)] text-[color:var(--paper)]">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--hairline)]/30 px-4 py-3 md:px-10">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="focus-ring font-serif text-[13px] italic tracking-tight text-[color:var(--paper)]/85 transition-colors hover:text-[color:var(--paper)]"
          >
            sonara.fm
          </Link>
          <AppNavLinks current="studio" />
        </div>
        <HeaderCount
          tab={tab}
          recordings={recordings}
          bootstrapped={recordingsBootstrapped}
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
          <LiveNowCard />
          <StudioSidebarTabs tab={tab} onTab={onTab} />
          {tab === "recordings" ? (
            <RecordingsList
              recordings={recordings}
              loading={recordingsLoading}
              bootstrapped={recordingsBootstrapped}
              selectedRecordingId={selectedRecordingId}
              onSelect={onSelectRecording}
            />
          ) : (
            <SetsList
              sets={curatedSets}
              loading={setsLoading}
              bootstrapped={setsBootstrapped}
              selectedSetId={selectedSetId}
              onSelect={onSelectSet}
              onCreate={onCreateSet}
            />
          )}
          {/* Stages are account objects like sets — managed here, not on a
              separate resolver page. */}
          <StagesSection />
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
                <span>{tab === "sets" ? "sets" : "recordings"}</span>
              </button>
            </div>
          )}

          {tab === "recordings" ? (
            renderRecordingsCenter()
          ) : (
            <SetEditor
              frameSet={setDetail}
              loading={setDetailLoading}
              error={setDetailError}
              onRetry={retrySetDetail}
              selectedFrameId={selectedFrameId}
              coverFrameId={setDetail?.coverFrameId ?? null}
              onRename={onRenameSet}
              onDelete={onDeleteSet}
              onMoveFrame={onMoveFrame}
              onRemoveFrame={onRemoveFrame}
              onSetCover={onSetCover}
              onVisibilityChange={onSetVisibility}
              onFrameClick={onFrameClick}
              onFrameOpen={onFrameOpen}
              onFrameCheck={onFrameCheck}
              isSelected={selection.isSelected}
              isSelecting={isSelecting}
              pinned={selection.pinned}
              onTogglePinned={selection.togglePinned}
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

      {/* Floating multi-select action bar */}
      <StudioSelectionBar
        selectedFrameIds={selectedFrameIds}
        onClear={clearSelection}
        onAddTo={mutations.addToSet}
        onCreateFrom={mutations.createSetFrom}
        onAdded={onSelectionAdded}
        onCreatedFromSelection={onSelectionCreated}
      />

      {/* Mobile inspector — Sheet from the right. Gated on the breakpoint:
          the Sheet's BACKDROP is not responsive-classed, so mounting it on
          desktop (where only its content was md:hidden) dimmed the page and
          swallowed every click while the inline aside showed the inspector. */}
      <Sheet
        open={isMobile && !!selectedFrame}
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
