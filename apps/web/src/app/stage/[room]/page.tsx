"use client";

import type { StageKnob } from "@sonara/onchain";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { parseEther } from "viem";

import { Mark } from "@/components/brand/mark";
import { Button } from "@/components/ui/button";
import { rpcClient } from "@/lib/orpc";
import { useStageWriter } from "@/lib/stage/use-stage-writer";
import { cn } from "@/lib/utils";

// /stage/[room] — the audience remote. Anyone with the room code drives the
// projector by emitting Monad txs (gasless, via a sponsored smart account).
// Knob taps shape the look instantly (the projector's shader reacts in ~1s);
// prompts join a queue so everyone gets a turn. No wallet, no gas, no sign-in.

const SNAPSHOT_POLL_MS = 1500;
const SLIDER_THROTTLE_MS = 200;
const NUDGE_STEP = 0.12;

type StageSnapshot = Awaited<ReturnType<typeof rpcClient.control.stageSnapshot>>;

// A "weirder / softer" tap pair for one knob.
const KNOB_TAPS: { knob: StageKnob; down: string; up: string }[] = [
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
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) => (
  <button
    className="focus-ring flex-1 rounded-sm border border-[color:var(--hairline)]/30 px-2 py-3 font-sans text-[11px] uppercase tracking-[0.14em] text-[color:var(--paper)]/85 transition-colors active:bg-[color:var(--paper)] active:text-[color:var(--ink)] disabled:opacity-40"
    disabled={disabled}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

export default function StagePage() {
  const params = useParams<{ room: string }>();
  const {room} = params;
  const { writer, ready, error: writerError, address } = useStageWriter();

  const [snap, setSnap] = useState<StageSnapshot | null>(null);
  const [localTx, setLocalTx] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [tip, setTip] = useState("");
  const lastSliderAt = useRef(0);

  // Poll the public stage snapshot (tx counter + prompt queue).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        const next = await rpcClient.control.stageSnapshot({ room });
        if (!cancelled) {
          setSnap(next);
        }
      } catch {
        // transient — keep last snapshot, retry next tick.
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, SNAPSHOT_POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [room]);

  // Fire a write fire-and-forget; bump the optimistic counter, surface failures.
  const fire = useCallback(
    (action: (w: NonNullable<typeof writer>) => Promise<unknown>) => {
      if (!writer) {
        return;
      }
      setLocalTx((n) => n + 1);
      // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- fire-and-forget: a tap must not block the UI on tx inclusion
      action(writer).catch((error: unknown) => {
        setLocalTx((n) => Math.max(0, n - 1));
        toast.error(error instanceof Error ? error.message : "tx failed");
      });
    },
    [writer]
  );

  const nudge = (knob: StageKnob, delta: number) =>
    fire((w) => w.nudge(room, knob, delta));

  const onIntensity = (value: number) => {
    const now = Date.now();
    if (now - lastSliderAt.current < SLIDER_THROTTLE_MS) {
      return;
    }
    lastSliderAt.current = now;
    fire((w) => w.set(room, "intensity", value));
  };

  const sendPrompt = () => {
    const text = prompt.trim();
    if (!text) {
      return;
    }
    let tipWei = 0n;
    try {
      tipWei = tip ? parseEther(tip) : 0n;
    } catch {
      toast.error("bad tip amount");
      return;
    }
    fire((w) => w.prompt(room, text, tipWei));
    setPrompt("");
    setTip("");
    toast.success("prompt queued");
  };

  const txCount = Math.max(localTx, snap?.txCount ?? 0);
  const linked = ready && !!writer;

  return (
    <Shell>
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
            linked ? "text-[color:var(--paper)]/70" : "text-[color:var(--stone)]"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              linked ? "bg-[color:var(--signal)]" : "bg-[color:var(--stone)]/60"
            )}
          />
          {linked ? "gasless · linked" : "linking…"}
        </span>
      </header>

      {writerError && (
        <p className="rounded-sm border border-[color:var(--signal)]/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--signal)]">
          {writerError}
        </p>
      )}

      {/* On-chain activity + what's on screen now. */}
      <section className="flex items-center justify-between rounded-sm border border-[color:var(--hairline)]/25 px-4 py-3">
        <div>
          <p className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            on-chain taps
          </p>
          <p className="font-mono text-[28px] tabular-nums leading-none text-[color:var(--paper)]">
            {txCount}
          </p>
        </div>
        <div className="max-w-[55%] text-right">
          <p className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            now playing
          </p>
          <p className="mt-1 line-clamp-2 font-serif text-[13px] italic leading-snug text-[color:var(--paper)]/85">
            {snap?.nowPlaying?.text ?? "—"}
          </p>
        </div>
      </section>

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
          disabled={!linked}
          id="intensity"
          max={1}
          min={0}
          onChange={(e) => onIntensity(Number(e.target.value))}
          step={0.02}
          type="range"
        />
      </section>

      {/* Knob taps. */}
      <section className="grid grid-cols-2 gap-2">
        {KNOB_TAPS.map(({ knob, up, down }) => (
          <div className="flex items-stretch gap-1" key={knob}>
            <TapButton disabled={!linked} onClick={() => nudge(knob, -NUDGE_STEP)}>
              {down}
            </TapButton>
            <TapButton disabled={!linked} onClick={() => nudge(knob, NUDGE_STEP)}>
              {up}
            </TapButton>
          </div>
        ))}
      </section>

      {/* Prompt + tip-to-jump. */}
      {snap?.allowPrompts !== false && (
        <section className="flex flex-col gap-2">
          <label
            className="font-sans text-[10px] uppercase tracking-[0.2em] text-[color:var(--stone)]"
            htmlFor="prompt"
          >
            send a scene to the queue
          </label>
          <textarea
            aria-label="scene prompt"
            className="min-h-[64px] w-full resize-none rounded-sm border border-[color:var(--hairline)]/30 bg-transparent px-3 py-2 font-serif text-[14px] text-[color:var(--paper)] outline-none placeholder:text-[color:var(--stone)]/60 focus:border-[color:var(--paper)]/50"
            disabled={!linked}
            id="prompt"
            maxLength={200}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="neon jellyfish drifting over a city…"
            value={prompt}
          />
          <div className="flex items-center gap-2">
            <input
              aria-label="tip in MON to jump the queue"
              className="w-24 rounded-sm border border-[color:var(--hairline)]/30 bg-transparent px-2 py-1.5 font-mono text-[11px] text-[color:var(--paper)] outline-none placeholder:text-[color:var(--stone)]/60 focus:border-[color:var(--paper)]/50"
              disabled={!linked}
              inputMode="decimal"
              onChange={(e) => setTip(e.target.value)}
              placeholder="tip MON"
              value={tip}
            />
            <Button
              className="flex-1 font-sans text-[11px] uppercase tracking-[0.2em]"
              disabled={!linked || !prompt.trim()}
              onClick={sendPrompt}
              size="sm"
              type="button"
            >
              {tip ? "jump the line" : "queue it"}
            </Button>
          </div>
        </section>
      )}

      {/* Up next. */}
      {snap && snap.upNext.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <p className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            up next · {snap.upNext.length}
          </p>
          {snap.upNext.slice(0, 5).map((p, i) => (
            <p
              className="flex items-center gap-2 font-serif text-[12px] text-[color:var(--paper)]/70"
              key={`${p.who}-${i}`}
            >
              {p.tip !== "0" && <span aria-hidden>💰</span>}
              <span className="line-clamp-1">{p.text}</span>
            </p>
          ))}
        </section>
      )}

      <footer className="mt-auto pt-4 font-mono text-[8px] uppercase tracking-[0.22em] text-[color:var(--stone)]/60">
        {address ? `you · ${address.slice(0, 6)}…${address.slice(-4)}` : "—"}
      </footer>
    </Shell>
  );
}
