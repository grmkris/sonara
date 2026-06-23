"use client";

import type { LibraryFrame } from "@sonara/shared";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatFileStamp, formatMmSs } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { AddToSetPopover } from "./add-to-set-popover";

interface FrameInspectorContentProps {
  frame: LibraryFrame;
  // Present only for a member of the open curated set — edit & re-render it.
  onRegenerate?: (prompt: string) => Promise<boolean>;
}

interface FieldProps {
  label: string;
  body: string;
  mono?: boolean;
  italic?: boolean;
}

const Field = ({ label, body, mono, italic }: FieldProps) => (
  <div className="flex flex-col gap-1">
    <span className="font-sans text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
      {label}
    </span>
    <span
      className={cn(
        "text-[12px] leading-snug text-[color:var(--paper)]/90",
        mono ? "font-mono uppercase tracking-[0.12em]" : "font-sans",
        italic && "italic"
      )}
    >
      {body}
    </span>
  </div>
);

const Bar = ({ label, value }: { label: string; value: number }) => {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="w-[110px] shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--stone)]">
        {label}
      </span>
      <div className="relative h-1 flex-1 rounded-sm bg-[color:var(--hairline)]/30">
        <div
          className="absolute inset-y-0 left-0 rounded-sm bg-[color:var(--paper)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// Friendly name for the fal model. Falls back to whatever the row stores
// if we don't recognise it.
// Model isn't in LibraryFrame directly (we omit it from the wire shape
// since it's mostly noise). anchorUrl presence is enough of a hint: set
// means the frame was chained off the previous one (klein/9b/edit), unset
// means a fresh text-to-image frame.
const shortModelName = (
  _deck: string,
  _tMs: number,
  frame: LibraryFrame
): string => (frame.anchorUrl ? "chained · klein/edit" : "fresh · klein/9b");

// The inspector body. Reused by the desktop right-pane wrapper and the
// mobile Sheet wrapper. The primary action is adding the frame to a curated
// set; download + copy-prompt are utilities. (The old "use as anchor" /
// "reseed" jump-to-/play actions were removed — they silently navigated away
// and confused more than they helped.)
export const FrameInspectorContent = ({
  frame,
  onRegenerate,
}: FrameInspectorContentProps) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(frame.prompt);
  const [submitting, setSubmitting] = useState(false);
  // Close the editor when switching to a different frame.
  useEffect(() => {
    setEditing(false);
  }, [frame.id]);

  const submitRegenerate = async () => {
    if (!onRegenerate || submitting || draft.trim().length === 0) {
      return;
    }
    setSubmitting(true);
    const ok = await onRegenerate(draft);
    setSubmitting(false);
    if (ok) {
      setEditing(false);
    }
  };

  const onCopyPrompt = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(frame.prompt);
        toast("prompt copied", { duration: 1600 });
      } catch {
        toast.error("copy failed", {
          description: "clipboard permission denied",
          duration: 2400,
        });
      }
    })();
  }, [frame.prompt]);

  const downloadName = `sonara-${formatFileStamp(frame.createdAt)}-${frame.id.slice(-8)}.webp`;

  return (
    <div className="flex flex-col gap-5 p-5">
      {/* Preview */}
      <div className="relative w-full overflow-hidden rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frame.url}
          alt=""
          className="w-full"
          style={{ aspectRatio: `${frame.width}/${frame.height}` }}
        />
      </div>

      {/* Actions — "add to set" is the primary thing you do with a frame in
          the library. Hidden for example-session frames: those are synthesized
          from shared seed rows (user_id NULL), so the server's ownership check
          would reject them — a new user (who only has example sessions) would
          otherwise hit an error. Real generated frames carry a normal lse_
          session id and are addable. */}
      <div className="flex flex-col gap-1.5">
        {!frame.sessionId.startsWith("lse_example_") && (
          <AddToSetPopover frame={frame} />
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="font-sans text-[10px] uppercase tracking-[0.22em]"
          >
            <a
              href={frame.url}
              download={downloadName}
              target="_blank"
              rel="noreferrer"
            >
              download
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopyPrompt}
            className="font-sans text-[10px] uppercase tracking-[0.22em]"
          >
            copy prompt
          </Button>
        </div>

        {/* Edit & regenerate — only for a member of the open curated set. */}
        {onRegenerate &&
          (editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                autoFocus
                rows={4}
                maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                className="focus-ring resize-none rounded-sm border border-[color:var(--hairline)]/40 bg-transparent px-3 py-2 font-sans text-[12px] text-[color:var(--paper)] leading-relaxed"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="focus-ring inline-flex items-center border border-[color:var(--hairline)]/40 px-2.5 py-1 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
                >
                  cancel
                </button>
                <button
                  type="button"
                  disabled={submitting || draft.trim().length === 0}
                  onClick={() => void submitRegenerate()}
                  className="focus-ring inline-flex items-center gap-1.5 border border-[color:var(--signal)] bg-[color:var(--signal)] px-2.5 py-1 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting && (
                    <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                  )}
                  regenerate · 1 credit
                </button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(frame.prompt);
                setEditing(true);
              }}
              className="font-sans text-[10px] uppercase tracking-[0.22em]"
            >
              edit & regenerate
            </Button>
          ))}
      </div>

      {/* Metadata */}
      <section className="flex flex-col gap-3 border-t border-[color:var(--hairline)]/30 pt-4">
        <Field label="prompt" body={frame.prompt} mono={false} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="time in session" body={formatMmSs(frame.tMs)} mono />
          <Field
            label="generated"
            body={frame.createdAt.toLocaleString()}
            mono
          />
          <Field label="deck" body={frame.deck} mono />
          <Field
            label="model"
            body={shortModelName(frame.deck, frame.tMs, frame)}
            mono
          />
        </div>
        {frame.triggerReason && (
          <Field
            label="trigger"
            body={`fired by · ${frame.triggerReason}`}
            mono
          />
        )}
      </section>

      {/* "When this happened" — context block */}
      {frame.inspectorContext ? (
        <section className="flex flex-col gap-3 border-t border-[color:var(--hairline)]/30 pt-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            when this happened
          </span>
          {frame.inspectorContext.audio && (
            <div className="flex flex-col gap-1.5">
              <span className="font-sans text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
                audio mood
              </span>
              <Bar
                label="bright ↔ dark"
                value={frame.inspectorContext.audio.valence}
              />
              <Bar
                label="calm ↔ energetic"
                value={frame.inspectorContext.audio.arousal}
              />
              <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                <span>bpm</span>
                <span>{Math.round(frame.inspectorContext.audio.bpm)}</span>
              </div>
            </div>
          )}
          {frame.inspectorContext.nowPlaying && (
            <Field
              label="track playing"
              body={`${frame.inspectorContext.nowPlaying.artist} — ${frame.inspectorContext.nowPlaying.title}`}
              mono={false}
            />
          )}
          {frame.inspectorContext.driftModifier && (
            <Field
              label="drift modifier"
              body={frame.inspectorContext.driftModifier}
              mono={false}
              italic
            />
          )}
          {frame.inspectorContext.resolvedSummary && (
            <div className="flex flex-col gap-2">
              {frame.inspectorContext.resolvedSummary.lighting && (
                <Field
                  label="lighting"
                  body={frame.inspectorContext.resolvedSummary.lighting}
                  mono={false}
                />
              )}
              {frame.inspectorContext.resolvedSummary.mood && (
                <Field
                  label="mood"
                  body={frame.inspectorContext.resolvedSummary.mood}
                  mono={false}
                />
              )}
              {frame.inspectorContext.resolvedSummary.palette.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="font-sans text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
                    palette
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {frame.inspectorContext.resolvedSummary.palette.map(
                      (hex, i) => (
                        <span
                          key={`${hex}-${i}`}
                          className="size-5 rounded-sm border border-[color:var(--hairline)]/40"
                          style={{ backgroundColor: hex }}
                          title={hex}
                        />
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-2 border-t border-[color:var(--hairline)]/30 pt-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            when this happened
          </span>
          <span className="font-sans text-[11px] italic text-[color:var(--stone)]">
            no context recorded — frame predates /studio enrichment
          </span>
        </section>
      )}

      {/* Anchor reference (if anchor-mode) */}
      {frame.anchorUrl && (
        <section className="flex flex-col gap-2 border-t border-[color:var(--hairline)]/30 pt-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            anchored on
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frame.anchorUrl}
            alt=""
            className="max-w-[160px] rounded-sm border border-[color:var(--hairline)]/40"
          />
        </section>
      )}
    </div>
  );
};
