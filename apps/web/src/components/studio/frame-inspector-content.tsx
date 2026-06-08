"use client";

import type { LibraryFrame } from "@sonara/shared";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatMmSs } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { AddToReelPopover } from "./add-to-reel-popover";

interface FrameInspectorContentProps {
  frame: LibraryFrame;
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

const formatStamp = (date: Date): string => {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}`;
};

// Friendly name for the fal model. Falls back to whatever the row stores
// if we don't recognise it.
// Model isn't in LibraryFrame directly (we omit it from the wire shape
// since it's mostly noise). The deck + anchorUrl presence are enough
// hints for the inspector: if anchorUrl is set this was anchor-mode
// (flux-pro/v1.1-ultra), else text-mode (klein/9b).
const shortModelName = (
  _deck: string,
  _tMs: number,
  frame: LibraryFrame
): string => (frame.anchorUrl ? "anchor · flux-pro" : "text · klein/9b");

// The inspector body. Reused by the desktop right-pane wrapper and the
// mobile Sheet wrapper. All actions are URL-driven — clicking "use as
// anchor" navigates to /play?anchor=...&strength=0.55, etc. /play's
// useSearchParams consumer dispatches the WS action after the socket
// opens, then router.replace clears the params (Phase 8e).
export const FrameInspectorContent = ({
  frame,
}: FrameInspectorContentProps) => {
  const router = useRouter();

  const onUseAsAnchor = useCallback(() => {
    const qs = new URLSearchParams({
      anchor: frame.url,
      strength: "0.55",
    });
    router.push(`/play?${qs.toString()}`);
  }, [frame.url, router]);

  const onReseed = useCallback(() => {
    const qs = new URLSearchParams({
      prompt: frame.prompt,
    });
    router.push(`/play?${qs.toString()}`);
  }, [frame.prompt, router]);

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

  const downloadName = `sonara-${formatStamp(frame.createdAt)}-${frame.id.slice(-8)}.webp`;

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

      {/* Actions */}
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          variant="default"
          size="sm"
          onClick={onUseAsAnchor}
          className="font-sans text-[10px] uppercase tracking-[0.22em]"
        >
          use as anchor
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onReseed}
          className="font-sans text-[10px] uppercase tracking-[0.22em]"
        >
          reseed
        </Button>
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

      {/* Add to a curated reel */}
      <AddToReelPopover frame={frame} />

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
