"use client";

import { deckLabel } from "@sonara/shared";
import type { DeckKey, SonaraSceneState } from "@sonara/shared";
import type { LiveSessionId } from "@sonara/shared/typeid";
import { useEffect } from "react";

import { StageHostPanel } from "@/components/stage/stage-host-panel";
import { DeckPicker } from "@/components/visualizer/controls/deck-picker";
import { IntensityDial } from "@/components/visualizer/controls/intensity-dial";
import { PromptInput } from "@/components/visualizer/controls/prompt-input";
import { SliderRow } from "@/components/visualizer/controls/slider-row";
import { useRemoteSession } from "@/hooks/use-remote-session";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

// The operator mixer, extracted from /control so the /s/[id] owner view can
// mount the exact same surface. It owns the remote-session binding: ~1s
// snapshot polls hydrate the shared zustand store and every control writes
// over the authed `control` HTTP router (see useRemoteSession). The host page
// keeps discovery/auth chrome; this renders preview + stage panel + controls.

const SLIDERS: {
  key: "softness" | "surrealness" | "abstraction" | "stability";
  label: string;
}[] = [
  { key: "softness", label: "soft" },
  { key: "surrealness", label: "unreal" },
  { key: "abstraction", label: "abstract" },
  { key: "stability", label: "stable" },
];

const StatusPill = ({
  status,
  demoMode,
}: {
  status: "idle" | "running" | "cancelled" | "error";
  demoMode: boolean;
}) => {
  let label: string;
  if (demoMode) {
    label = "deck";
  } else if (status === "running") {
    label = "generating";
  } else if (status === "error") {
    label = "error";
  } else {
    label = "live";
  }
  const tone =
    status === "error"
      ? "border-[color:var(--signal)] text-[color:var(--signal)]"
      : "border-[color:var(--paper)]/50 text-[color:var(--paper)]";
  return (
    <span
      className={cn(
        "rounded-sm border bg-[color:var(--ink)]/70 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-[0.18em] backdrop-blur-sm",
        tone
      )}
    >
      {status === "running" && !demoMode ? "● " : ""}
      {label}
    </span>
  );
};

const PreviewCard = ({
  lastFrameUrl,
  status,
  prompt,
  demoMode,
  demoDeck,
  connected,
}: {
  lastFrameUrl: string | null;
  status: "idle" | "running" | "cancelled" | "error";
  prompt: string;
  demoMode: boolean;
  demoDeck: DeckKey | null;
  connected: boolean;
}) => {
  let placeholderLabel: string;
  if (demoMode) {
    placeholderLabel = `${demoDeck ? deckLabel(demoDeck) : "deck"} · on projector`;
  } else if (connected) {
    placeholderLabel = "no frame yet";
  } else {
    placeholderLabel = "—";
  }
  return (
    <div className="overflow-hidden rounded-sm border border-[color:var(--hairline)]/25">
      <div className="relative aspect-video w-full bg-[color:var(--ink)]">
        {lastFrameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lastFrameUrl}
            alt="latest frame"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
            {placeholderLabel}
          </div>
        )}
        <div className="absolute left-2 top-2 flex items-center gap-1.5">
          <StatusPill status={status} demoMode={demoMode} />
        </div>
      </div>
      <div className="px-3 py-2">
        <span className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          on screen
        </span>
        <p className="mt-1 line-clamp-2 font-serif text-[13px] leading-snug text-[color:var(--paper)]/85">
          {prompt.trim() || (demoMode ? "playing a deck" : "—")}
        </p>
      </div>
    </div>
  );
};

const Divider = () => (
  <div aria-hidden className="h-px w-full bg-[color:var(--hairline)]/20" />
);

const ControlSurface = ({ send }: { send: SessionSend }) => {
  const scene = useVisualizerStore((s) => s.scene);

  const patchSlider = (key: (typeof SLIDERS)[number]["key"], value: number) =>
    send({
      patch: { [key]: value } as Partial<SonaraSceneState>,
      type: "scene.patch",
    });

  return (
    <div className="flex flex-col gap-5">
      <PromptInput send={send} />

      <Divider />

      <DeckPicker send={send} />

      <Divider />

      <IntensityDial send={send} />

      <Divider />

      <div className="flex flex-col gap-3">
        {SLIDERS.map((s) => (
          <SliderRow
            key={s.key}
            label={s.label}
            value={scene[s.key]}
            onChange={(v) => patchSlider(s.key, v)}
          />
        ))}
      </div>
    </div>
  );
};

export const OperatorConsole = ({
  liveSessionId,
  onConnectedChange,
}: {
  liveSessionId: LiveSessionId | null;
  // Lets the host page surface link state in its own chrome (the /control
  // header pill) without mounting a second snapshot poller.
  onConnectedChange?: (connected: boolean) => void;
}) => {
  const { send, snapshot, connected } = useRemoteSession(liveSessionId);

  useEffect(() => {
    onConnectedChange?.(connected);
  }, [connected, onConnectedChange]);

  return (
    <div className="flex flex-col gap-6">
      <PreviewCard
        lastFrameUrl={snapshot?.currentFrameUrl ?? snapshot?.lastFrameUrl ?? null}
        status={snapshot?.jobStatus ?? "idle"}
        prompt={snapshot?.scene.prompt ?? ""}
        demoMode={snapshot?.demoMode ?? false}
        demoDeck={snapshot?.demoDeck ?? null}
        connected={connected}
      />

      <StageHostPanel liveSessionId={liveSessionId} />

      <ControlSurface send={send} />
    </div>
  );
};
