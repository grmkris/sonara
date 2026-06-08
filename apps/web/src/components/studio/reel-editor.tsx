"use client";

import type { Reel } from "@sonara/shared";
import type { ImageLibraryId } from "@sonara/shared/typeid";
import { Pencil, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { ErrorState } from "./error-state";
import { ReelEmptyDraft } from "./reel-empty-draft";
import { ReelFrameTile } from "./reel-frame-tile";

interface ReelEditorProps {
  reel: Reel | null;
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
}

const Hint = ({ children }: { children: string }) => (
  <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
    {children}
  </div>
);

// Center pane for the reels tab: the selected reel's frames in authored order,
// plus header actions (replay, rename, delete) when edit handlers are supplied.
export const ReelEditor = ({
  reel,
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
}: ReelEditorProps) => {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");

  // Reset the rename draft whenever the selected reel changes.
  useEffect(() => {
    setRenaming(false);
    setDraftName(reel?.name ?? "");
  }, [reel?.id, reel?.name]);

  if (error) {
    return <ErrorState onRetry={onRetry} />;
  }
  if (loading) {
    return <Hint>loading reel…</Hint>;
  }
  if (!reel) {
    return <Hint>select a reel</Hint>;
  }

  const submitRename = () => {
    const name = draftName.trim();
    setRenaming(false);
    if (name.length > 0 && name !== reel.name && onRename) {
      onRename(name);
    }
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 py-8 md:px-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            reel
          </span>
          {renaming && onRename ? (
            <input
              type="text"
              value={draftName}
              autoFocus
              aria-label="reel name"
              maxLength={120}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitRename();
                } else if (e.key === "Escape") {
                  setRenaming(false);
                  setDraftName(reel.name);
                }
              }}
              onBlur={submitRename}
              className="focus-ring border-b border-[color:var(--hairline)]/40 bg-transparent pb-1 font-sans text-[14px] uppercase tracking-[0.18em] text-[color:var(--paper)]"
            />
          ) : (
            <h2 className="flex items-center gap-2 font-sans text-[14px] uppercase tracking-[0.18em] text-[color:var(--paper)]/90">
              <span className="truncate">{reel.name}</span>
              {onRename && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(reel.name);
                    setRenaming(true);
                  }}
                  aria-label="rename reel"
                  className="focus-ring shrink-0 text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
                >
                  <Pencil className="size-3" strokeWidth={1.5} />
                </button>
              )}
            </h2>
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
            {reel.frames.length} frame{reel.frames.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {reel.frames.length > 0 && (
            <Link
              href={`/play?reel=${encodeURIComponent(reel.id)}`}
              className="focus-ring font-sans inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
            >
              <Play className="size-3" strokeWidth={1.5} />
              play
            </Link>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="delete reel"
              className="focus-ring inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:border-[color:var(--signal)] hover:text-[color:var(--signal)]"
            >
              <Trash2 className="size-3" strokeWidth={1.5} />
              delete
            </button>
          )}
        </div>
      </header>

      {reel.frames.length === 0 ? (
        <ReelEmptyDraft />
      ) : (
        <div
          className={cn(
            "grid gap-2",
            "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
          )}
        >
          {reel.frames.map((frame, i) => (
            <ReelFrameTile
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
              canMoveNext={i < reel.frames.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};
