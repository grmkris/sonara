"use client";

import { formatUsdc, parseUsdc } from "@sonara/onchain";
import type { StageKnob, StagePayment } from "@sonara/onchain";
import type { StageActivityEvent } from "@sonara/shared";
import { Mic, MicOff } from "lucide-react";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Mark } from "@/components/brand/mark";
import { AddressGlyph, shortAddress } from "@/components/stage/address-glyph";
import { BlockPulse } from "@/components/stage/block-pulse";
import { rpcClient } from "@/lib/orpc";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { createLatencyTracker } from "@/lib/stage/latency";
import { useStageFeed } from "@/lib/stage/use-stage-feed";
import { useStageWriter } from "@/lib/stage/use-stage-writer";
import { cn } from "@/lib/utils";

// /stage/[room] — the audience remote. Anyone with the room code drives the
// projector by emitting Monad txs (gasless, via a sponsored smart account).
// Knob taps shape the look instantly and stay free; prompts cost USDC (base
// price + optional tip for queue priority), pulled from the smart account —
// still no wallet app, no gas, no sign-in. Short on USDC? The funding panel
// shows the account address + the Circle testnet faucet.
//
// Live state arrives over the public /ws/stage feed (no polling): tx counter,
// queue, block heartbeat — plus this device's own "tap → on-chain" latency,
// measured against the feed and linked to the explorer.

const SLIDER_THROTTLE_MS = 200;
const NUDGE_STEP = 0.12;
const USDC_FAUCET_URL = "https://faucet.circle.com";
const EXPLORER_TX_URL = "https://testnet.monadexplorer.com/tx/";

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

// Why an airdrop didn't land, in stage-page voice.
const DRIP_ERRORS: Record<string, string> = {
  already_funded: "you can already afford a prompt",
  cooldown: "one airdrop per hour — spend it first",
  faucet_dry: "house faucet is empty — try the circle faucet",
  unavailable: "airdrops are off right now — try the circle faucet",
};

// Shown when the smart account can't cover a prompt. Primary path: the house
// faucet drips testnet USDC straight to this wallet (control.stageAirdrop).
// Fallback: send USDC yourself (address as text + QR) or the Circle faucet.
// The top-up: a bright, friendly "free credits" slab backed by the house
// faucet — deliberately NOT styled like a real payment button (a pay-sheet
// look made test users afraid they were being charged). On success the
// balance credits OPTIMISTICALLY (creditLocally) so the composer unlocks
// instantly instead of waiting out the 15s balance poll; the panel unmounts
// the moment the wallet can afford a prompt.
const FundPanel = ({
  address,
  room,
  onCredited,
}: {
  address: string;
  room: string;
  onCredited: (units: bigint) => void;
}) => {
  const [qr, setQr] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "confirming" | "paid">("idle");
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    void (async () => {
      setQr(await QRCode.toDataURL(address, { margin: 1, width: 240 }));
    })();
  }, [address]);

  const topUp = async (): Promise<void> => {
    setPhase("confirming");
    try {
      const result = await rpcClient.control.stageAirdrop({ address, room });
      if (result.ok) {
        onCredited(BigInt(result.units));
        setPhase("paid");
        toast.success("credits added — go drop a scene");
      } else {
        setPhase("idle");
        toast.error(DRIP_ERRORS[result.reason] ?? "couldn't add credits");
      }
    } catch {
      setPhase("idle");
      toast.error("couldn't add credits");
    }
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("address copied");
    } catch {
      toast.error("couldn't copy — long-press to copy");
    }
  };

  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-sm border border-[color:var(--signal)]/40 p-4">
      {/* Corner glow — quiet atmosphere tying the panel to the signal slab. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-[color:var(--signal)]/10 blur-2xl"
      />
      <p className="font-serif text-[17px] italic leading-snug text-[color:var(--paper)]/90">
        grab free credits to drop a scene.
      </p>
      <p className="-mt-2 font-sans text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        prompts cost a little testnet usdc · the house has you covered
      </p>
      <button
        type="button"
        disabled={phase !== "idle"}
        onClick={topUp}
        className={cn(
          "focus-ring flex w-full flex-col items-center gap-0.5 rounded-sm bg-[color:var(--signal)] px-4 py-4 text-[color:var(--ink)] shadow-[0_0_36px_-10px_var(--signal)] transition-all active:scale-[0.98]",
          phase !== "idle" && "animate-pulse opacity-80"
        )}
      >
        <span className="font-serif text-[18px] italic leading-none">
          {phase === "idle" && "get free credits"}
          {phase === "confirming" && "sending…"}
          {phase === "paid" && "✓ credits added"}
        </span>
        {phase === "idle" && (
          <span className="font-sans text-[9px] uppercase tracking-[0.24em] opacity-70">
            free · enough for your next scenes
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setShowManual((v) => !v)}
        className="focus-ring w-fit font-sans text-[10px] uppercase tracking-[0.2em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
      >
        {showManual ? "▾ hide" : "▸ or fund it yourself"}
      </button>
      {showManual && (
        <div className="flex items-center gap-3">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="your stage wallet address"
              className="size-24 rounded-sm bg-white p-1"
              src={qr}
            />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <button
              className="focus-ring break-all text-left font-mono text-[10px] text-[color:var(--paper)]/80"
              onClick={copy}
              type="button"
            >
              {address}
              <span className="ml-2 font-sans text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
                copy
              </span>
            </button>
            <a
              className="focus-ring font-sans text-[10px] uppercase tracking-[0.2em] text-[color:var(--paper)]/85 underline underline-offset-4"
              href={USDC_FAUCET_URL}
              rel="noreferrer"
              target="_blank"
            >
              or get usdc from circle ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

// Mic toggle in the composer's corner. Speech-to-text is the browser's Web
// Speech API (same hook as /play's prompt dictation) — the transcript streams
// into the textarea, the user reviews, and the SEND still pays on-chain, so
// dictation never auto-spends. Hidden entirely when the browser lacks
// SpeechRecognition; the typed flow is unaffected.
const ComposerMic = ({
  disabled,
  listening,
  onToggle,
  supported,
}: {
  disabled: boolean;
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
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "focus-ring absolute bottom-2 right-2 flex items-center gap-1.5 rounded-sm px-1.5 py-1 transition-colors",
        listening
          ? "text-[color:var(--signal)]"
          : "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
        disabled && "cursor-not-allowed opacity-40"
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

// The paid part of the page: composer + tip + send gating + funding panel.
// Owns the text/tip inputs and the affordability math; the parent owns the
// actual on-chain fire (and the optimistic balance/tx bookkeeping).
const PromptComposer = ({
  linked,
  address,
  room,
  payment,
  balanceUnits,
  onSend,
  onCredited,
}: {
  linked: boolean;
  address: string | null;
  room: string;
  payment: StagePayment | null;
  balanceUnits: bigint | null;
  onSend: (text: string, tipUnits: bigint, cost: bigint) => void;
  onCredited: (units: bigint) => void;
}) => {
  const [prompt, setPrompt] = useState("");
  const [tip, setTip] = useState("");

  // Voice dictation: the live transcript streams straight into `prompt`
  // (clamped to the field's 200-char limit), so the textarea doubles as the
  // listening display. Review-then-pay: dictation never submits by itself.
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const { supported, listening, start, stop } = useVoiceRecognition({
    onResult: (text) => setPrompt(text.slice(0, 200)),
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

  // What the entered tip parses to (null = malformed input), and what the
  // whole prompt would cost. Used to gate the send button before the chain
  // rejects an unaffordable transferFrom.
  const promptPrice = payment?.promptPriceUnits ?? null;
  const tipUnits = (() => {
    if (!tip) {
      return 0n;
    }
    try {
      return parseUsdc(tip);
    } catch {
      return null;
    }
  })();
  const cost =
    promptPrice !== null && tipUnits !== null ? promptPrice + tipUnits : null;
  const canAfford =
    cost !== null && balanceUnits !== null && balanceUnits >= cost;
  const needsFunds =
    promptPrice !== null && balanceUnits !== null && balanceUnits < promptPrice;

  const send = () => {
    const text = prompt.trim();
    if (!text) {
      return;
    }
    if (tipUnits === null) {
      toast.error("bad tip amount");
      return;
    }
    if (cost === null || !canAfford) {
      toast.error("not enough usdc — fund your stage wallet");
      return;
    }
    onSend(text, tipUnits, cost);
    setPrompt("");
    setTip("");
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
        {promptPrice !== null && (
          <span className="ml-2 font-sans text-[9px] uppercase not-italic tracking-[0.22em] text-[color:var(--stone)]">
            {formatUsdc(promptPrice)} usdc
          </span>
        )}
      </label>
      <div className="relative">
        <textarea
          aria-label="scene prompt"
          className="min-h-[80px] w-full resize-none rounded-sm border border-[color:var(--paper)]/30 bg-[color:var(--paper)]/5 px-3 py-2.5 pr-10 font-serif text-[16px] text-[color:var(--paper)] outline-none placeholder:text-[color:var(--stone)]/70 focus:border-[color:var(--signal)]/70 focus:bg-[color:var(--paper)]/10"
          disabled={!linked}
          id="prompt"
          maxLength={200}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="neon jellyfish drifting over a city…"
          ref={promptRef}
          value={prompt}
        />
        <ComposerMic
          disabled={!linked}
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
      <div className="flex items-center gap-2">
        <input
          aria-label="tip in USDC to jump the queue"
          className="w-24 rounded-sm border border-[color:var(--hairline)]/30 bg-transparent px-2 py-1.5 font-mono text-[16px] text-[color:var(--paper)] outline-none placeholder:text-[color:var(--stone)]/60 focus:border-[color:var(--paper)]/50"
          disabled={!linked}
          inputMode="decimal"
          onChange={(e) => setTip(e.target.value)}
          placeholder="tip usdc"
          value={tip}
        />
        <button
          className="focus-ring flex flex-1 items-center justify-center rounded-sm bg-[color:var(--signal)] px-4 py-3 text-[color:var(--ink)] shadow-[0_0_28px_-10px_var(--signal)] transition-all active:scale-[0.98] disabled:opacity-35 disabled:shadow-none"
          disabled={!linked || !prompt.trim() || !canAfford}
          onClick={send}
          type="button"
        >
          <span className="font-serif text-[17px] italic leading-none">
            {tip ? "jump the line ↑" : "put it on screen →"}
          </span>
        </button>
      </div>
      {needsFunds && address && (
        <FundPanel address={address} onCredited={onCredited} room={room} />
      )}
    </section>
  );
};

export default function StagePage() {
  const params = useParams<{ room: string }>();
  const { room } = params;
  const {
    writer,
    ready,
    error: writerError,
    address,
    payment,
    balanceUnits,
    spendLocally,
    creditLocally,
  } = useStageWriter();

  const [localTx, setLocalTx] = useState(0);
  const lastSliderAt = useRef(0);

  // "tap → on-chain" latency: mark every send, match the first feed event
  // from our own smart account. Honest end-to-end (bundler included).
  const trackerRef = useRef(createLatencyTracker());
  const [latency, setLatency] = useState<{ ms: number; txHash: string } | null>(
    null
  );
  const onActivity = useCallback(
    (event: StageActivityEvent) => {
      const ms = trackerRef.current.match(event.who, address);
      if (ms !== null) {
        setLatency({ ms, txHash: event.txHash });
      }
    },
    [address]
  );

  // Live room state over the public stage feed WebSocket.
  const feed = useStageFeed(room, onActivity);

  // Fire a write fire-and-forget; bump the optimistic counter, surface failures.
  const fire = useCallback(
    (action: (w: NonNullable<typeof writer>) => Promise<unknown>) => {
      if (!writer) {
        return;
      }
      const mark = trackerRef.current.markSend();
      setLocalTx((n) => n + 1);
      // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- fire-and-forget: a tap must not block the UI on tx inclusion
      action(writer).catch((error: unknown) => {
        trackerRef.current.cancel(mark);
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

  const sendPrompt = (text: string, tipUnits: bigint, cost: bigint) => {
    fire((w) => w.prompt(room, text, tipUnits));
    spendLocally(cost);
    toast.success(`prompt queued · ${formatUsdc(cost)} usdc`);
  };

  const txCount = Math.max(localTx, feed.txCount);
  const linked = ready && !!writer;
  const raisedUnits = BigInt(feed.revenueUnits);

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
        <span className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em]",
              linked
                ? "text-[color:var(--paper)]/70"
                : "text-[color:var(--stone)]"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                linked
                  ? "bg-[color:var(--signal)]"
                  : "bg-[color:var(--stone)]/60"
              )}
            />
            {linked ? "gasless · linked" : "linking…"}
            {balanceUnits !== null && (
              <span className="text-[color:var(--paper)]/85">
                · {formatUsdc(balanceUnits)} usdc
              </span>
            )}
          </span>
          <BlockPulse blockNumber={feed.blockNumber} dense />
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
          {raisedUnits > 0n && (
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
              {formatUsdc(raisedUnits)} usdc raised
            </p>
          )}
          {latency && (
            <a
              className="wire-print focus-ring mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--paper)]/80"
              href={`${EXPLORER_TX_URL}${latency.txHash}`}
              key={latency.txHash}
              rel="noreferrer"
              target="_blank"
            >
              <span
                aria-hidden
                className="size-1 rounded-full bg-[color:var(--signal)]"
              />
              tap → on-chain · {(latency.ms / 1000).toFixed(2)}s ↗
            </a>
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

      {/* Prompt FIRST — it's the headline act (paid in USDC; tip jumps the
          queue). The free knobs live below so they can't steal focus. */}
      {feed.allowPrompts && (
        <PromptComposer
          address={address}
          balanceUnits={balanceUnits}
          linked={linked}
          onCredited={creditLocally}
          onSend={sendPrompt}
          payment={payment}
          room={room}
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
          disabled={!linked}
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
            <TapButton disabled={!linked} onClick={() => nudge(knob, -NUDGE_STEP)}>
              {down}
            </TapButton>
            <TapButton disabled={!linked} onClick={() => nudge(knob, NUDGE_STEP)}>
              {up}
            </TapButton>
          </div>
        ))}
      </section>

      {/* Up next — attributed to its on-chain sender. */}
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
              <AddressGlyph address={p.who} className="shrink-0" size={10} />
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--stone)]">
                {shortAddress(p.who)}
              </span>
              <span className="line-clamp-1">{p.text}</span>
              {p.tip !== "0" && (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--signal)]">
                  +{formatUsdc(BigInt(p.tip))} usdc
                </span>
              )}
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
