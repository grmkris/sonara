"use client";

import type { ControlSnapshot } from "@sonara/api/server";
import { InstrumentConfig } from "@sonara/shared";
import type { SonaraSceneState } from "@sonara/shared";
import { useEffect, useState } from "react";

import { InstrumentControls } from "@/components/instrument/instrument-controls";
import { LookPopover } from "@/components/stage-console/look-popover";
import { StageSheet } from "@/components/stage-console/stage-sheet";
import { StageHostPanel } from "@/components/stage/stage-host-panel";
import { Button } from "@/components/ui/button";
import { IntensityDial } from "@/components/visualizer/controls/intensity-dial";
import { PromptInput } from "@/components/visualizer/controls/prompt-input";
import { ResolutionPicker } from "@/components/visualizer/controls/resolution-picker";
import { SliderRow } from "@/components/visualizer/controls/slider-row";
import { SourceSwitcher } from "@/components/visualizer/controls/source-switcher";
import { useLookRelay } from "@/hooks/use-look-relay";
import type { ControlTarget } from "@/lib/control-actions";
import { coalesce } from "@/lib/debounce";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { useInstrumentStore } from "@/stores/instrument-store";
import { useVisualizerStore } from "@/stores/visualizer";

// THE console — one component, two mounts ("one console, two mounts",
// docs/rooms-and-roles-plan.md rev 2). The screen face embeds it `attached`
// (the canvas is the preview, PromptInput lives in the screen's left rail);
// a phone opens it `detached` at the stage console route with the preview
// card + prompt included. Same controls, same SessionSend action union —
// the transport (WS vs control router) is the caller's binding, never this
// component's concern.
//
// Capability split, and why:
//   PreviewCard / PromptInput   detached only — attached has the real canvas
//                               and the left-rail prompt.
//   SourceSwitcher, intensity,  both — fully transport-agnostic.
//   feel sliders, host panel
//   ResolutionPicker /          attached only — the resolution is a CLIENT-
//   PresetPicker                authoritative localStorage pref re-sent on
//                               every WS connect (a remote change would be
//                               clobbered on the next screen reconnect), and
//                               the render preset is a client-local shader,
//                               not session state. Moving their authority
//                               server-side is a deferred follow-up.

export interface StageConsoleProps {
  send: SessionSend;
  variant: "attached" | "detached";
  // Detached bindings, owned by the page (useRemoteSession) so this stays a
  // pure presenter and can never accidentally double-poll.
  snapshot?: ControlSnapshot | null;
  connected?: boolean;
  // Stage host panel binding: stage-keyed (permanent crowd code) or legacy
  // run-keyed (per-gig minted code).
  hostTarget?: ControlTarget | null;
  // Footer actions — rendered only when wired by the mount.
  onNewSet?: () => void;
  onReset?: () => void;
}

type SliderKey = "softness" | "surrealness" | "abstraction" | "stability";

const SLIDERS: { key: SliderKey; label: string }[] = [
  { key: "softness", label: "soft" },
  { key: "surrealness", label: "unreal" },
  { key: "abstraction", label: "abstract" },
  { key: "stability", label: "stable" },
];

const Divider = () => (
  <div aria-hidden className="h-px w-full bg-[color:var(--hairline)]/20" />
);

const StatusPill = ({
  status,
  playbackMode,
}: {
  status: "idle" | "running" | "cancelled" | "error";
  playbackMode: boolean;
}) => {
  let label: string;
  if (playbackMode) {
    label = "set";
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
      {status === "running" && !playbackMode ? "● " : ""}
      {label}
    </span>
  );
};

const PreviewCard = ({
  lastFrameUrl,
  status,
  prompt,
  playbackLabel,
  connected,
}: {
  lastFrameUrl: string | null;
  status: "idle" | "running" | "cancelled" | "error";
  prompt: string;
  // Set name when the server's source is a set — drives the pill + copy.
  playbackLabel: string | null;
  connected: boolean;
}) => {
  const playbackMode = playbackLabel !== null;
  let placeholderLabel: string;
  if (playbackMode) {
    placeholderLabel = `${playbackLabel} · on projector`;
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
          <StatusPill status={status} playbackMode={playbackMode} />
        </div>
      </div>
      <div className="px-3 py-2">
        <span className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          on screen
        </span>
        <p className="mt-1 line-clamp-2 font-serif text-[13px] leading-snug text-[color:var(--paper)]/85">
          {prompt.trim() || (playbackMode ? "playing a set" : "—")}
        </p>
      </div>
    </div>
  );
};

const Footer = ({
  onNewSet,
  onReset,
}: {
  onNewSet?: () => void;
  onReset?: () => void;
}) => {
  if (!(onNewSet || onReset)) {
    return null;
  }
  return (
    <div className="flex items-center justify-end gap-3 sm:gap-5">
      {onNewSet && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewSet}
          className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] hover:text-[color:var(--paper)]"
        >
          new set
        </Button>
      )}
      {onReset && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] hover:text-[color:var(--paper)]"
        >
          reset · ⌫
        </Button>
      )}
    </div>
  );
};

// Shared mid-section: energy + feel. Identical in both mounts.
const FeelControls = ({ send }: { send: SessionSend }) => {
  const scene = useVisualizerStore((s) => s.scene);
  const patchSlider = (key: SliderKey, value: number) =>
    send({
      patch: { [key]: value } as Partial<SonaraSceneState>,
      type: "scene.patch",
    });
  return (
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
  );
};

const AttachedConsole = ({
  send,
  hostTarget,
  onNewSet,
  onReset,
}: {
  send: SessionSend;
  hostTarget: ControlTarget | null;
  onNewSet?: () => void;
  onReset?: () => void;
}) => {
  // ?lab=1 reveals the resolution A/B. Read post-mount from
  // window.location so the page keeps prerendering (no useSearchParams
  // Suspense bailout for a dev flag).
  const [lab, setLab] = useState(false);
  useEffect(() => {
    setLab(new URLSearchParams(window.location.search).has("lab"));
  }, []);

  return (
    <div className="relative flex flex-col gap-5 rounded-sm border border-[color:var(--hairline)]/25 p-4">
      {/* Source — the Now-Showing transport: what's on the canvas (live /
          deck / set replay / idle), with the picker + stop. */}
      <SourceSwitcher send={send} mode="local" />

      <Divider />

      {/* Energy — the master audio→visual coupling. */}
      <IntensityDial send={send} />

      {/* Feel — the four scene knobs. */}
      <FeelControls send={send} />

      <Divider />

      {/* Setup-time surfaces, one tap away. */}
      <div className="flex flex-wrap items-center gap-2">
        <LookPopover />
        <StageSheet target={hostTarget} />
      </div>

      {/* Lab — A/B the render resolution. Dev instrumentation, hidden
          behind ?lab=1 (the client-authoritative localStorage pref is
          untouched by the gate). */}
      {lab && (
        <>
          <Divider />
          <ResolutionPicker send={send} />
        </>
      )}

      <Footer onNewSet={onNewSet} onReset={onReset} />
    </div>
  );
};

const DetachedConsole = ({
  send,
  snapshot,
  connected,
  hostTarget,
  onNewSet,
  onReset,
}: {
  send: SessionSend;
  snapshot: ControlSnapshot | null;
  connected: boolean;
  hostTarget: ControlTarget | null;
  onNewSet?: () => void;
  onReset?: () => void;
}) => {
  // Relay this console's look edits (preset / Feel sliders / applied profile)
  // to the screen — the console has no canvas, so the relay is how they land.
  useLookRelay(send);
  const instrument = useInstrumentStore((s) => s.config);
  const [deck, setDeck] = useState<"a" | "b">("a");
  useEffect(() => {
    const parsed = InstrumentConfig.safeParse(snapshot?.look);
    if (parsed.success) {
      useInstrumentStore.setState({ config: parsed.data });
    }
  }, [snapshot?.look]);
  const [relay] = useState(() =>
    coalesce((config: InstrumentConfig) => {
      send({ config, type: "look.set" });
    }, 100)
  );
  useEffect(
    () => () => {
      relay.flush();
    },
    [relay]
  );
  return (
    <div className="flex flex-col gap-6">
      <PreviewCard
        lastFrameUrl={
          snapshot?.currentFrameUrl ?? snapshot?.lastFrameUrl ?? null
        }
        status={snapshot?.jobStatus ?? "idle"}
        prompt={snapshot?.scene.prompt ?? ""}
        playbackLabel={
          snapshot?.source.kind === "set"
            ? (snapshot.source.label ?? "set")
            : null
        }
        connected={connected}
      />

      <InstrumentControls
        config={instrument}
        onChange={(config) => {
          useInstrumentStore.getState().setConfig(config);
          relay(config);
        }}
        deck={deck}
        onDeck={setDeck}
      />
      <StageHostPanel target={hostTarget} />

      <div className="flex flex-col gap-5">
        <PromptInput send={send} />
        <Divider />
        <SourceSwitcher send={send} mode="remote" showSets />
        <Divider />
        <IntensityDial send={send} />
        <Divider />
        <FeelControls send={send} />
        <Divider />
        {/* Same look controls as the screen — preset picker + Feel sliders +
            saveable profiles — relayed to the screen via useLookRelay. */}
        <LookPopover />
        <Footer onNewSet={onNewSet} onReset={onReset} />
      </div>
    </div>
  );
};

export const StageConsole = ({
  send,
  variant,
  snapshot = null,
  connected = false,
  hostTarget = null,
  onNewSet,
  onReset,
}: StageConsoleProps) => {
  if (variant === "detached") {
    return (
      <DetachedConsole
        connected={connected}
        hostTarget={hostTarget}
        onNewSet={onNewSet}
        onReset={onReset}
        send={send}
        snapshot={snapshot}
      />
    );
  }

  // The attached console is the INSTRUMENT: transport + intensity + feel,
  // and nothing else resident. Setup-time surfaces live one tap away —
  // presets in the look popover, the crowd stage in a sheet — and the
  // resolution A/B (dev instrumentation) only appears with ?lab=1.
  return <AttachedConsole {...{ hostTarget, onNewSet, onReset, send }} />;
};
