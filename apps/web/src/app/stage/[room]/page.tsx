"use client";

import type { StageActivityEvent, StageKnobName } from "@sonara/shared";
import { MAX_STAGE_PROMPT_CHARS } from "@sonara/shared";
import { Mic, MicOff } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Mark } from "@/components/brand/mark";
import { HandleGlyph } from "@/components/stage/handle-glyph";
import { OwnerConsoleBanner } from "@/components/stage/owner-console-banner";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { rpcClient } from "@/lib/orpc";
import { getOrCreateStageHandle } from "@/lib/stage/handle";
import { createLatencyTracker } from "@/lib/stage/latency";
import { useStageFeed } from "@/lib/stage/use-stage-feed";
import { cn } from "@/lib/utils";

// /stage/[room] — the audience remote. Anyone with the room code drives the
// projector: knob taps shape the look instantly, prompts queue for the wall.
// No wallet, no sign-in, no charge to the crowd — generation a prompt
// triggers is paid by the stage owner's credits, and the dwell queue rotates
// submissions so everyone gets a turn.
//
// Live state arrives over the public /ws/stage feed (no polling): activity
// counter, queue — plus this device's own "tap → on screen" latency, matched
// against its handle in the feed.

const SLIDER_THROTTLE_MS = 200;
const NUDGE_STEP = 0.12;

// A "weirder / softer" tap pair for one knob.
const KNOB_TAPS: { knob: StageKnobName; down: string; up: string }[] = [
  { down: "calmer", knob: "surrealness", up: "weirder" },
  { down: "sharper", knob: "softness", up: "softer" },
  { down: "literal", knob: "abstraction", up: "abstract" },
  { down: "looser", knob: "stability", up: "steadier" },
];

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="flex min-h-svh flex-col bg-[color:var(--ink)] px-5 pb-10 pt-7 text-[color:var(--paper)]">
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6">
      {children}
    </div>
  </main>
);

const TapButton = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    className="focus-ring flex-1 rounded-sm border border-[color:var(--hairline)]/30 px-2 py-3 font-sans text-[11px] uppercase tracking-[0.14em] text-[color:var(--paper)]/85 transition-colors active:bg-[color:var(--paper)] active:text-[color:var(--ink)]"
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

// Mic toggle in the composer's corner. Speech-to-text is the browser's Web
// Speech API (same hook as /play's prompt dictation) — the transcript streams
// into the textarea, the user reviews, then sends. Hidden entirely when the
// browser lacks SpeechRecognition; the typed flow is unaffected.
const ComposerMic = ({
  listening,
  onToggle,
  supported,
}: {
  listening: boolean;
  onToggle: () => void;
  supported: boolean;
}) => {
  if (!supported) {
    return null;
  }
  return (
    <button
      type="button"
      aria-label={listening ? "stop dictating" : "speak your prompt"}
      aria-pressed={listening}
      onClick={onToggle}
      className={cn(
        "focus-ring absolute bottom-2 right-2 flex items-center gap-1.5 rounded-sm px-1.5 py-1 transition-colors",
        listening
          ? "text-[color:var(--signal)]"
          : "text-[color:var(--stone)] hover:text-[color:var(--paper)]"
      )}
    >
      {listening ? (
        <MicOff className="size-4" strokeWidth={1.5} />
      ) : (
        <Mic className="size-4" strokeWidth={1.5} />
      )}
    </button>
  );
};

// The fate of YOUR prompt, printed under the send button: queued (with
// position) → on the wall. Derived entirely from the live feed — the cue is
// the persistent answer to "did it work?", so no success toast is needed.
// Distinct keys remount the line on each transition, replaying the
// wire-print animation so the state change lands.
const PromptFateCue = ({
  who,
  queuedPosition,
  onWall,
}: {
  who: string;
  queuedPosition: number | null;
  onWall: boolean;
}) => {
  if (onWall) {
    return (
      <p
        className="wire-print flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--signal)]"
        key="on-wall"
      >
        <span
          aria-hidden
          className="size-1.5 animate-pulse rounded-full bg-[color:var(--signal)]"
        />
        yours is on the wall
      </p>
    );
  }
  if (queuedPosition !== null) {
    return (
      <p
        className="wire-print flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--signal)]"
        key={`queued-${queuedPosition}`}
      >
        <HandleGlyph className="shrink-0" size={10} who={who} />
        yours is in — #{queuedPosition} in line
      </p>
    );
  }
  return null;
};

// The composer: free to use; one queued prompt per handle (a re-submit
// replaces yours). The parent owns the actual RPC fire.
const PromptComposer = ({
  onSend,
  who,
  queuedPosition,
  onWall,
}: {
  onSend: (text: string) => void;
  who: string;
  queuedPosition: number | null;
  onWall: boolean;
}) => {
  const [prompt, setPrompt] = useState("");

  // Voice dictation: the live transcript streams straight into `prompt`
  // (clamped to the field's limit), so the textarea doubles as the listening
  // display. Review-then-send: dictation never submits by itself.
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const { supported, listening, start, stop } = useVoiceRecognition({
    onResult: (text) => setPrompt(text.slice(0, MAX_STAGE_PROMPT_CHARS)),
  });
  const toggleMic = () => {
    if (listening) {
      stop();
      return;
    }
    setPrompt("");
    start();
    promptRef.current?.focus();
  };

  const send = () => {
    const text = prompt.trim();
    if (!text) {
      return;
    }
    onSend(text);
    setPrompt("");
  };

  return (
    <section className="relative flex flex-col gap-2.5 overflow-hidden rounded-sm border border-[color:var(--signal)]/35 p-4">
      {/* Corner glow — the composer is the headline act of the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 -top-10 size-36 rounded-full bg-[color:var(--signal)]/10 blur-2xl"
      />
      <label
        className="font-serif text-[17px] italic leading-snug text-[color:var(--paper)]/90"
        htmlFor="prompt"
      >
        put your scene on the wall.
      </label>
      <div className="relative">
        <textarea
          aria-label="scene prompt"
          className="min-h-[80px] w-full resize-none rounded-sm border border-[color:var(--paper)]/30 bg-[color:var(--paper)]/5 px-3 py-2.5 pr-10 font-serif text-[16px] text-[color:var(--paper)] outline-none placeholder:text-[color:var(--stone)]/70 focus:border-[color:var(--signal)]/70 focus:bg-[color:var(--paper)]/10"
          id="prompt"
          maxLength={MAX_STAGE_PROMPT_CHARS}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="neon jellyfish drifting over a city…"
          ref={promptRef}
          value={prompt}
        />
        <ComposerMic
          listening={listening}
          onToggle={toggleMic}
          supported={supported}
        />
      </div>
      {listening && (
        <p className="breath flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--signal)]">
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-[color:var(--signal)]"
          />
          listening — speak your scene, then queue it
        </p>
      )}
      <button
        className="focus-ring flex items-center justify-center rounded-sm bg-[color:var(--signal)] px-4 py-3 text-[color:var(--ink)] shadow-[0_0_28px_-10px_var(--signal)] transition-all active:scale-[0.98] disabled:opacity-35 disabled:shadow-none"
        disabled={!prompt.trim()}
        onClick={send}
        type="button"
      >
        <span className="font-serif text-[17px] italic leading-none">
          put it on screen →
        </span>
      </button>
      <PromptFateCue
        who={who}
        queuedPosition={queuedPosition}
        onWall={onWall}
      />
    </section>
  );
};

export default function StagePage() {
  const params = useParams<{ room: string }>();
  const { room } = params;
  const [handle, setHandle] = useState("anon");
  useEffect(() => {
    setHandle(getOrCreateStageHandle());
  }, []);

  const [localTaps, setLocalTaps] = useState(0);
  const lastSliderAt = useRef(0);

  // "tap → on screen" latency: mark every send, match the first feed event
  // carrying our own handle. Honest end-to-end (server fold included).
  const trackerRef = useRef(createLatencyTracker());
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const onActivity = useCallback((event: StageActivityEvent) => {
    const ms = trackerRef.current.match(event.who, handleRef.current);
    if (ms !== null) {
      setLatencyMs(ms);
    }
  }, []);

  // Live room state over the public stage feed WebSocket.
  const feed = useStageFeed(room, onActivity);

  // Fire a write fire-and-forget; bump the optimistic counter, surface failures.
  const fire = useCallback((action: () => Promise<unknown>) => {
    const mark = trackerRef.current.markSend();
    setLocalTaps((n) => n + 1);
    // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- fire-and-forget: a tap must not block the UI
    action().catch((error: unknown) => {
      trackerRef.current.cancel(mark);
      setLocalTaps((n) => Math.max(0, n - 1));
      toast.error(error instanceof Error ? error.message : "send failed");
    });
  }, []);

  const nudge = (knob: StageKnobName, delta: number) =>
    fire(() => rpcClient.stage.tap({ delta, from: handle, knob, room }));

  const onIntensity = (value: number) => {
    const now = Date.now();
    if (now - lastSliderAt.current < SLIDER_THROTTLE_MS) {
      return;
    }
    lastSliderAt.current = now;
    fire(() =>
      rpcClient.stage.setKnob({
        from: handle,
        knob: "intensity",
        level: value,
        room,
      })
    );
  };

  const sendPrompt = (text: string) => {
    fire(async () => {
      const { queued } = await rpcClient.stage.submitPrompt({
        from: handle,
        room,
        text,
      });
      // Success needs no toast — the composer's fate cue ("yours is in —
      // #N in line") is the persistent answer; only the duplicate case
      // still warrants a transient note.
      if (!queued) {
        toast("that one's already in the queue");
      }
    });
  };

  // YOUR prompt's place in the feed, for the composer's fate cue.
  const queueIndex = feed.queue.upNext.findIndex((p) => p.who === handle);
  const queuedPosition = queueIndex === -1 ? null : queueIndex + 1;
  const onWall = feed.queue.nowPlaying?.who === handle;

  const tapCount = Math.max(localTaps, feed.tapCount);

  return (
    <Shell>
      {/* Owner scanning their own QR → jump to the console (crowd never sees this). */}
      <OwnerConsoleBanner code={room} />
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Mark className="h-6 w-6 shrink-0" />
          <span className="font-serif text-[22px] italic">stage</span>
          <span className="rounded-sm border border-[color:var(--hairline)]/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
            {room}
          </span>
        </span>
        <span
          className={cn(
            "flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em]",
            feed.connected
              ? "text-[color:var(--paper)]/70"
              : "text-[color:var(--stone)]"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              feed.connected
                ? "bg-[color:var(--signal)]"
                : "bg-[color:var(--stone)]/60"
            )}
          />
          {feed.connected ? "live" : "connecting…"}
        </span>
      </header>

      {/* Crowd activity + what's on screen now. */}
      <section className="flex items-center justify-between rounded-sm border border-[color:var(--hairline)]/25 px-4 py-3">
        <div>
          <p className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            crowd taps
          </p>
          <p className="font-mono text-[28px] tabular-nums leading-none text-[color:var(--paper)]">
            {tapCount}
          </p>
          {latencyMs !== null && (
            <p
              className="wire-print mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--paper)]/80"
              key={latencyMs}
            >
              <span
                aria-hidden
                className="size-1 rounded-full bg-[color:var(--signal)]"
              />
              tap → on screen · {(latencyMs / 1000).toFixed(2)}s
            </p>
          )}
        </div>
        <div className="max-w-[55%] text-right">
          <p className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            now playing
          </p>
          <p className="mt-1 line-clamp-2 font-serif text-[13px] italic leading-snug text-[color:var(--paper)]/85">
            {feed.queue.nowPlaying?.text ?? "—"}
          </p>
        </div>
      </section>

      {/* Prompt FIRST — it's the headline act. The knobs live below so they
          can't steal focus. */}
      {feed.allowPrompts && (
        <PromptComposer
          onSend={sendPrompt}
          who={handle}
          queuedPosition={queuedPosition}
          onWall={onWall}
        />
      )}

      {/* Intensity — "how much image is generated". */}
      <section className="flex flex-col gap-2">
        <label
          className="font-sans text-[10px] uppercase tracking-[0.2em] text-[color:var(--stone)]"
          htmlFor="intensity"
        >
          intensity — how alive
        </label>
        <input
          aria-label="intensity"
          className="w-full accent-[color:var(--signal)]"
          defaultValue={0.5}
          id="intensity"
          max={1}
          min={0}
          onChange={(e) => onIntensity(Number(e.target.value))}
          step={0.02}
          type="range"
        />
      </section>

      {/* Knob taps — free, always. */}
      <section className="grid grid-cols-2 gap-2">
        {KNOB_TAPS.map(({ knob, up, down }) => (
          <div className="flex items-stretch gap-1" key={knob}>
            <TapButton onClick={() => nudge(knob, -NUDGE_STEP)}>
              {down}
            </TapButton>
            <TapButton onClick={() => nudge(knob, NUDGE_STEP)}>{up}</TapButton>
          </div>
        ))}
      </section>

      {/* Up next — attributed to its sender's handle. */}
      {feed.queue.upNext.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <p className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            up next · {feed.queue.upNext.length}
          </p>
          {feed.queue.upNext.slice(0, 5).map((p, i) => (
            <p
              className="flex items-center gap-2 font-serif text-[12px] text-[color:var(--paper)]/70"
              key={`${p.who}-${i}`}
            >
              <HandleGlyph className="shrink-0" size={10} who={p.who} />
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--stone)]">
                {p.who}
              </span>
              <span className="line-clamp-1">{p.text}</span>
            </p>
          ))}
        </section>
      )}

      <footer className="mt-auto pt-4 font-mono text-[8px] uppercase tracking-[0.22em] text-[color:var(--stone)]/60">
        you · {handle}
      </footer>
    </Shell>
  );
}
