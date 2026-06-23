"use client";

import type { FrameSet, FrameSetVisibility, SetLook } from "@sonara/shared";
import type { ImageLibraryId } from "@sonara/shared/typeid";
import { Pencil, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { useTimelinePlayback } from "@/hooks/use-timeline-playback";
import type { FrameDragPayload, TileClickMods } from "@/lib/curation-dnd";

import { ActivateOnStage } from "./activate-on-stage";
import { ErrorState } from "./error-state";
import { SetEmptyDraft } from "./set-empty-draft";
import { SetHeaderMenu } from "./set-header-menu";
import { SetLookEditor } from "./set-look-editor";
import { SetShareControls } from "./set-share-controls";
import { SetTimelineTrack } from "./set-timeline-track";
import { TimelinePreview } from "./timeline-preview";
import { Tip } from "./tip";

// Display width for un-pinned frames when the set has no authored look — their
// real replay cadence is reactive, so the timeline shows a representative hold.
const DEFAULT_NOMINAL_MS = 2500;
const EMPTY_FRAMES: FrameSet["frames"] = [];

interface SetEditorProps {
  frameSet: FrameSet | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  selectedFrameId: string | null;
  // Edit affordances — only active when provided (read-only otherwise).
  coverFrameId?: ImageLibraryId | null;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  onMoveFrame?: (frameId: string, dir: "prev" | "next") => void;
  onRemoveFrame?: (frameId: string) => void;
  onSetCover?: (frameId: string) => void;
  onVisibilityChange?: (visibility: FrameSetVisibility) => void;
  onLookChange?: (look: SetLook | null) => void;
  // Pin/clear a member frame's authored hold duration (timeline trim).
  onSetFrameDuration?: (frameId: string, durationMs: number | null) => void;
  // Draft mode: this set is a frozen source (built-in / recording) edited
  // client-side. Presence swaps the header to a Save-as-set / reset cluster;
  // nothing persists until onSave clones it into the library.
  draft?: {
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onReset: () => void;
  };
  // Whether multi-select is offered (off for built-in drafts — their seed
  // frames aren't user-owned, so the selection bar's add-to-set would reject).
  selectable?: boolean;
  // Selection v2 (page-owned): the page resolves the click matrix; the editor
  // just threads gestures + visual state.
  onFrameClick: (frameId: string, mods: TileClickMods) => void;
  onFrameOpen: (frameId: string) => void;
  onFrameCheck: (frameId: string) => void;
  isSelected: (frameId: string) => boolean;
  isSelecting: boolean;
  pinned: boolean;
  onTogglePinned: () => void;
  // Marquee sweep over the track (desktop): live hit ids while dragging.
  onMarquee: (ids: string[], additive: boolean) => void;
  // Sub-threshold click on whitespace clears the selection.
  onWhitespaceClick: () => void;
  marqueeEnabled?: boolean;
  // Drag payload factory (page decides single tile vs whole selection).
  // Present only when the set is editable — also gates the drop targets.
  getDragPayload?: (frameId: string) => FrameDragPayload;
  // Keyboard cursor wiring (page-owned selection + mutations).
  selectionApi: {
    toggle: (id: string) => void;
    rangeTo: (id: string) => void;
    selectedFrameIds: string[];
  };
  onRemoveFrames?: (ids: string[]) => void;
}

// Header action cluster — extracted to keep SetEditor under the complexity
// budget.
const SetHeaderActions = ({
  frameSet,
  pinned,
  onTogglePinned,
  onVisibilityChange,
  onDelete,
  draft,
  selectable = true,
}: {
  frameSet: FrameSet;
  pinned: boolean;
  onTogglePinned: () => void;
  onVisibilityChange?: (visibility: FrameSetVisibility) => void;
  onDelete?: () => void;
  draft?: SetEditorProps["draft"];
  selectable?: boolean;
}) => (
  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
    {frameSet.frames.length > 0 && <ActivateOnStage setId={frameSet.id} />}
    {onVisibilityChange && (
      <SetShareControls
        setId={frameSet.id}
        visibility={frameSet.visibility}
        onVisibilityChange={onVisibilityChange}
      />
    )}
    {/* Draft mode shows the save / discard pair inline — they're the active
        editing actions, only present while a frozen source is being cut. */}
    {draft?.dirty && (
      <Tip text="Discard your unsaved edits">
        <button
          type="button"
          onClick={draft.onReset}
          aria-label="discard edits"
          className="focus-ring inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
        >
          <RotateCcw className="size-3" strokeWidth={1.5} />
          reset
        </button>
      </Tip>
    )}
    {draft && (
      <Tip text="Save this arrangement as a new set in your library">
        <button
          type="button"
          onClick={draft.onSave}
          disabled={draft.saving}
          className="focus-ring inline-flex items-center gap-1.5 border border-[color:var(--paper)]/70 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)] transition-colors hover:bg-[color:var(--paper)]/10 disabled:opacity-50"
        >
          <Save className="size-3" strokeWidth={1.5} />
          {draft.saving ? "saving…" : "save as set"}
        </button>
      </Tip>
    )}
    {/* Secondary, occasional actions tuck into the overflow menu. */}
    <SetHeaderMenu
      canSelect={selectable && frameSet.frames.length > 0}
      selectActive={pinned}
      onToggleSelect={onTogglePinned}
      onDelete={onDelete}
    />
  </div>
);

const Hint = ({ children }: { children: string }) => (
  <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
    {children}
  </div>
);

// The set's saved look (preset + reactivity + cadence) surfaced on the timeline
// surface — applied across every frame at playback, so it reads as a property
// of the whole track, not a header action. Renders nothing for sources that
// can't carry a look (recordings / built-ins pass no onChange).
const LookBar = ({
  look,
  onChange,
}: {
  look: FrameSet["look"];
  onChange?: (look: SetLook | null) => void;
}) => {
  if (!onChange) {
    return null;
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2.5">
      <SetLookEditor look={look} onChange={onChange} />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
        {look
          ? "applied across this set at playback"
          : "no look · plays with app defaults"}
      </span>
    </div>
  );
};

// Center pane for the sets tab: the selected curated set rendered as an
// editable, non-destructive timeline (frames as clips on a time axis; width =
// hold duration), plus header actions (play, share, rename, delete) when edit
// handlers are supplied.
export const SetEditor = ({
  frameSet,
  loading,
  error,
  onRetry,
  selectedFrameId,
  coverFrameId,
  onRename,
  onDelete,
  onMoveFrame,
  onRemoveFrame,
  onSetCover,
  onVisibilityChange,
  onLookChange,
  onSetFrameDuration,
  draft,
  selectable = true,
  onFrameClick,
  onFrameOpen,
  onFrameCheck,
  isSelected,
  isSelecting,
  pinned,
  onTogglePinned,
  onMarquee,
  onWhitespaceClick,
  marqueeEnabled = true,
  getDragPayload,
  selectionApi,
  onRemoveFrames,
}: SetEditorProps) => {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(true);

  // Display/playback fallback for un-pinned frames (the set's calm cadence).
  const nominalMs = frameSet?.look?.cadence.calm ?? DEFAULT_NOMINAL_MS;
  // The timeline is the playback clock: this drives the preview's frames AND
  // the playhead, so play sweeps both and scrub/ruler seeks the preview.
  const playback = useTimelinePlayback({
    active: previewExpanded,
    frames: frameSet?.frames ?? EMPTY_FRAMES,
    nominalMs,
    playing: previewPlaying,
  });

  // Reset the rename draft whenever the selected set changes.
  useEffect(() => {
    setRenaming(false);
    setDraftName(frameSet?.name ?? "");
  }, [frameSet?.id, frameSet?.name]);

  if (error) {
    return <ErrorState onRetry={onRetry} />;
  }
  if (loading) {
    return <Hint>loading set…</Hint>;
  }
  if (!frameSet) {
    return <Hint>select a set</Hint>;
  }

  const submitRename = () => {
    const name = draftName.trim();
    setRenaming(false);
    if (name.length > 0 && name !== frameSet.name && onRename) {
      onRename(name);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-8 md:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            set
          </span>
          {renaming && onRename ? (
            <input
              type="text"
              value={draftName}
              autoFocus
              aria-label="set name"
              maxLength={120}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitRename();
                } else if (e.key === "Escape") {
                  setRenaming(false);
                  setDraftName(frameSet.name);
                }
              }}
              onBlur={submitRename}
              className="focus-ring border-b border-[color:var(--hairline)]/40 bg-transparent pb-1 font-sans text-[14px] uppercase tracking-[0.18em] text-[color:var(--paper)]"
            />
          ) : (
            <h2 className="flex items-center gap-2 font-sans text-[14px] uppercase tracking-[0.18em] text-[color:var(--paper)]/90">
              <span className="truncate">{frameSet.name}</span>
              {onRename && (
                <Tip text="Rename this set">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(frameSet.name);
                      setRenaming(true);
                    }}
                    aria-label="rename set"
                    className="focus-ring shrink-0 text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
                  >
                    <Pencil className="size-3" strokeWidth={1.5} />
                  </button>
                </Tip>
              )}
            </h2>
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
            {frameSet.frames.length} frame
            {frameSet.frames.length === 1 ? "" : "s"}
          </span>
        </div>

        <SetHeaderActions
          frameSet={frameSet}
          pinned={pinned}
          onTogglePinned={onTogglePinned}
          onVisibilityChange={onVisibilityChange}
          onDelete={onDelete}
          draft={draft}
          selectable={selectable}
        />
      </header>

      {draft && (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
          editing a copy · changes aren&apos;t saved until you “save as set”
        </p>
      )}

      {frameSet.frames.length === 0 ? (
        <SetEmptyDraft />
      ) : (
        <>
          <TimelinePreview
            look={frameSet.look}
            expanded={previewExpanded}
            setExpanded={setPreviewExpanded}
            playing={previewPlaying}
            setPlaying={setPreviewPlaying}
          />
          <LookBar look={frameSet.look} onChange={onLookChange} />
          <SetTimelineTrack
            frames={frameSet.frames}
            setId={frameSet.id}
            nominalMs={nominalMs}
            coverFrameId={coverFrameId ?? null}
            selectedFrameId={selectedFrameId}
            onFrameClick={onFrameClick}
            onFrameOpen={onFrameOpen}
            onFrameCheck={onFrameCheck}
            isSelected={isSelected}
            isSelecting={isSelecting}
            onMarquee={onMarquee}
            onWhitespaceClick={onWhitespaceClick}
            marqueeEnabled={marqueeEnabled}
            selectionApi={selectionApi}
            getDragPayload={getDragPayload}
            onRemoveFrame={onRemoveFrame}
            onRemoveFrames={onRemoveFrames}
            onSetCover={onSetCover}
            onMoveFrame={onMoveFrame}
            onSetFrameDuration={onSetFrameDuration}
            playheadMs={playback.playheadMs}
            onSeek={playback.seekTo}
            currentFrameId={playback.currentFrameId}
          />
        </>
      )}
    </div>
  );
};
