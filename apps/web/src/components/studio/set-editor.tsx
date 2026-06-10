"use client";

import type { FrameSet, FrameSetVisibility } from "@sonara/shared";
import type { ImageLibraryId } from "@sonara/shared/typeid";
import { Pencil, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { ActivateOnStage } from "./activate-on-stage";
import { ErrorState } from "./error-state";
import { SelectModeToggle } from "./select-mode-toggle";
import { SetEmptyDraft } from "./set-empty-draft";
import { SetFrameTile } from "./set-frame-tile";
import { SetShareControls } from "./set-share-controls";

interface SetEditorProps {
  frameSet: FrameSet | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  selectedFrameId: string | null;
  onSelectFrame: (frameId: string) => void;
  // Edit affordances — only active when provided (read-only otherwise).
  coverFrameId?: ImageLibraryId | null;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  onMoveFrame?: (frameId: string, dir: "prev" | "next") => void;
  onRemoveFrame?: (frameId: string) => void;
  onSetCover?: (frameId: string) => void;
  onVisibilityChange?: (visibility: FrameSetVisibility) => void;
  // Multi-select curation mode (page-owned state) — optional so read-only
  // embeds stay untouched.
  selectMode?: boolean;
  selectedFrameIds?: string[];
  onToggleFrame?: (frameId: string, shiftKey: boolean) => void;
  onToggleSelectMode?: () => void;
}

const EMPTY_SELECTION: string[] = [];

const Hint = ({ children }: { children: string }) => (
  <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
    {children}
  </div>
);

// Center pane for the sets tab: the selected curated set's frames in authored
// order, plus header actions (play, share, rename, delete) when edit handlers
// are supplied.
export const SetEditor = ({
  frameSet,
  loading,
  error,
  onRetry,
  selectedFrameId,
  onSelectFrame,
  coverFrameId,
  onRename,
  onDelete,
  onMoveFrame,
  onRemoveFrame,
  onSetCover,
  onVisibilityChange,
  selectMode = false,
  selectedFrameIds = EMPTY_SELECTION,
  onToggleFrame,
  onToggleSelectMode,
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
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 py-8 md:px-10">
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

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {onVisibilityChange && (
            <SetShareControls
              setId={frameSet.id}
              visibility={frameSet.visibility}
              onVisibilityChange={onVisibilityChange}
            />
          )}
          {onToggleSelectMode && frameSet.frames.length > 0 && (
            <SelectModeToggle
              active={selectMode}
              onToggle={onToggleSelectMode}
            />
          )}
          {frameSet.frames.length > 0 && (
            <ActivateOnStage setId={frameSet.id} />
          )}
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
      </header>

      {frameSet.frames.length === 0 ? (
        <SetEmptyDraft />
      ) : (
        <div
          className={cn(
            "grid gap-2",
            "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
          )}
        >
          {frameSet.frames.map((frame, i) => (
            <SetFrameTile
              key={frame.id}
              frame={frame}
              index={i}
              selected={frame.id === selectedFrameId}
              isCover={coverFrameId ? frame.id === coverFrameId : false}
              onSelect={onSelectFrame}
              onMovePrev={
                onMoveFrame ? (id) => onMoveFrame(id, "prev") : undefined
              }
              onMoveNext={
                onMoveFrame ? (id) => onMoveFrame(id, "next") : undefined
              }
              onRemove={onRemoveFrame}
              onSetCover={onSetCover}
              canMovePrev={i > 0}
              canMoveNext={i < frameSet.frames.length - 1}
              selectMode={selectMode}
              checked={selectedFrameIds.includes(frame.id)}
              onToggle={onToggleFrame}
            />
          ))}
        </div>
      )}
    </div>
  );
};
