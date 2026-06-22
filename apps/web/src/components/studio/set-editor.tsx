"use client";

import type { FrameSet, FrameSetVisibility, SetLook } from "@sonara/shared";
import type { ImageLibraryId } from "@sonara/shared/typeid";
import { Pencil, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { FrameDragPayload } from "@/lib/curation-dnd";

import { ActivateOnStage } from "./activate-on-stage";
import { ErrorState } from "./error-state";
import { SelectModeToggle } from "./select-mode-toggle";
import { SetEmptyDraft } from "./set-empty-draft";
import type { TileClickMods } from "./set-frame-tile";
import { SetLookEditor } from "./set-look-editor";
import { SetShareControls } from "./set-share-controls";
import { SetTimelineTrack } from "./set-timeline-track";

// Display width for un-pinned frames when the set has no authored look — their
// real replay cadence is reactive, so the timeline shows a representative hold.
const DEFAULT_NOMINAL_MS = 2500;

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
  onLookChange,
  onDelete,
}: {
  frameSet: FrameSet;
  pinned: boolean;
  onTogglePinned: () => void;
  onVisibilityChange?: (visibility: FrameSetVisibility) => void;
  onLookChange?: (look: SetLook | null) => void;
  onDelete?: () => void;
}) => (
  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
    {onLookChange && (
      <SetLookEditor look={frameSet.look} onChange={onLookChange} />
    )}
    {onVisibilityChange && (
      <SetShareControls
        setId={frameSet.id}
        visibility={frameSet.visibility}
        onVisibilityChange={onVisibilityChange}
      />
    )}
    {frameSet.frames.length > 0 && (
      <SelectModeToggle active={pinned} onToggle={onTogglePinned} />
    )}
    {frameSet.frames.length > 0 && <ActivateOnStage setId={frameSet.id} />}
    {frameSet.frames.length > 0 && (
      <Link
        href={`/play?set=${encodeURIComponent(frameSet.id)}`}
        className="focus-ring font-sans inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
      >
        <Play className="size-3" strokeWidth={1.5} />
        preview
      </Link>
    )}
    {onDelete && (
      <button
        type="button"
        onClick={onDelete}
        aria-label="delete set"
        className="focus-ring inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:border-[color:var(--signal)] hover:text-[color:var(--signal)]"
      >
        <Trash2 className="size-3" strokeWidth={1.5} />
        delete
      </button>
    )}
  </div>
);

const Hint = ({ children }: { children: string }) => (
  <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
    {children}
  </div>
);

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
    <div className="flex h-full flex-col gap-4 px-6 py-8 md:px-10">
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
          onLookChange={onLookChange}
          onDelete={onDelete}
        />
      </header>

      {frameSet.frames.length === 0 ? (
        <SetEmptyDraft />
      ) : (
        <SetTimelineTrack
          frames={frameSet.frames}
          setId={frameSet.id}
          nominalMs={frameSet.look?.cadence.calm ?? DEFAULT_NOMINAL_MS}
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
        />
      )}
    </div>
  );
};
