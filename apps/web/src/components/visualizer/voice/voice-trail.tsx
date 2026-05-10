"use client";

import { useEffect, useState } from "react";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

// Three-stage in-flight voice trail:
//
//   ▸ Heard      — live transcript (interim → final). Web Speech rarely
//                  supplies confidence, so the underline collapses to a
//                  simple dotted marker when isFinal is true.
//   ▸ Understood — LLM intent JSON. Compact chip row with a latency badge.
//   ▸ Applied    — what changed (diff chips) and whether a generation was
//                  queued, with the version number when triggered.
//
// Reads from store.voiceTrail (populated by the WS handler in
// use-ws-session.ts). Renders nothing until a voice utterance starts.

const TRAIL_AUTO_HIDE_MS = 14_000;

export function VoiceTrail() {
  const trail = useVisualizerStore((s) => s.voiceTrail);
  const clear = useVisualizerStore((s) => s.clearVoiceTrail);

  // Auto-fade after ~14s of inactivity so the trail doesn't pin a stale
  // utterance on screen forever. New partial/parsed/applied events bump
  // updatedAt and reset the timer.
  const [, force] = useState(0);
  useEffect(() => {
    if (!trail) return;
    const remaining = TRAIL_AUTO_HIDE_MS - (Date.now() - trail.updatedAt);
    if (remaining <= 0) {
      clear();
      return;
    }
    const t = setTimeout(() => {
      force((n) => n + 1);
    }, Math.max(500, remaining));
    return () => clearTimeout(t);
  }, [trail, clear]);

  if (!trail) return null;
  const fadeMs = Date.now() - trail.updatedAt;
  if (fadeMs >= TRAIL_AUTO_HIDE_MS) return null;
  const opacity = fadeMs > TRAIL_AUTO_HIDE_MS - 2_000
    ? Math.max(0, (TRAIL_AUTO_HIDE_MS - fadeMs) / 2_000)
    : 1;

  const stageHeard = trail.text.length > 0;
  const stageUnderstood = trail.intent !== null;
  const stageApplied = trail.appliedPatch !== null;

  return (
    <div
      className="pointer-events-none flex w-full max-w-[680px] flex-col gap-1.5 font-sans"
      style={{ opacity, transition: "opacity 240ms ease" }}
      aria-live="polite"
    >
      {/* Connector thread fills as stages advance. Three pills sit on top. */}
      <div className="relative">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-[color:var(--hairline)]/30" />
        <div
          className="absolute left-0 top-1/2 h-px bg-[color:var(--paper)]/55"
          style={{
            width: stageApplied ? "100%" : stageUnderstood ? "66%" : stageHeard ? "33%" : "0%",
            transition: "width 320ms ease",
          }}
        />
        <div className="relative flex items-stretch gap-2">
          <HeardPill trail={trail} active={stageHeard} />
          <UnderstoodPill trail={trail} active={stageUnderstood} />
          <AppliedPill trail={trail} active={stageApplied} />
        </div>
      </div>
    </div>
  );
}

function PillShell({
  label,
  active,
  children,
  className,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 rounded-sm border px-3 py-2 backdrop-blur-sm transition-colors",
        active
          ? "border-[color:var(--hairline)]/60 bg-black/30 text-[color:var(--paper)]"
          : "border-[color:var(--hairline)]/25 bg-black/15 text-[color:var(--stone)]/55",
        className,
      )}
    >
      <span
        className={cn(
          "font-mono text-[8px] uppercase tracking-[0.32em]",
          active ? "text-[color:var(--stone)]" : "text-[color:var(--stone)]/50",
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function HeardPill({
  trail,
  active,
}: {
  trail: NonNullable<ReturnType<typeof useVisualizerStore.getState>["voiceTrail"]>;
  active: boolean;
}) {
  const conf = trail.confidence;
  // React warns when the shorthand `textDecoration` is set alongside a
  // longhand like `textDecorationColor` — on re-render they race. Split into
  // longhand-only properties.
  const underlineStyle: React.CSSProperties = {
    textDecorationLine: trail.isFinal ? "underline" : "none",
    textDecorationStyle: typeof conf === "number" ? "solid" : "dotted",
    textDecorationColor: typeof conf === "number"
      ? `color-mix(in oklch, var(--paper) ${Math.round(conf * 100)}%, transparent)`
      : "var(--stone)",
    textUnderlineOffset: "3px",
  };

  return (
    <PillShell label="heard" active={active}>
      <div className="flex min-h-[18px] items-baseline gap-2">
        <span
          className={cn(
            "font-serif truncate text-[13px] italic",
            !trail.isFinal && "text-[color:var(--paper)]/70",
          )}
          style={underlineStyle}
        >
          {trail.text || "—"}
        </span>
      </div>
    </PillShell>
  );
}

function UnderstoodPill({
  trail,
  active,
}: {
  trail: NonNullable<ReturnType<typeof useVisualizerStore.getState>["voiceTrail"]>;
  active: boolean;
}) {
  const intent = trail.intent;
  return (
    <PillShell label="understood" active={active}>
      <div className="flex min-h-[18px] flex-wrap items-center gap-1.5">
        {!intent && (
          <span className="font-mono text-[10px] italic text-[color:var(--stone)]/60">
            …parsing
          </span>
        )}
        {intent &&
          Object.entries(intent.patch)
            .slice(0, 4)
            .map(([k, v]) => (
              <Chip key={k} k={k} v={String(v)} />
            ))}
        {intent && intent.commit && <Chip k="" v="commit" tone="signal" />}
        {intent && intent.reset && <Chip k="" v="reset" tone="warn" />}
        {intent && intent.preset && <Chip k="preset" v={intent.preset} />}
        {intent && intent.lookPreset && (
          <Chip k="look" v={intent.lookPreset} />
        )}
        {intent &&
          Object.keys(intent.patch).length === 0 &&
          !intent.commit &&
          !intent.reset &&
          !intent.preset &&
          !intent.lookPreset && (
            <span className="font-mono text-[10px] italic text-[color:var(--stone)]/60">
              atmosphere only
            </span>
          )}
        {trail.parsedLatencyMs !== null && (
          <span className="font-mono nums ml-auto shrink-0 text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]/60">
            Δ {trail.parsedLatencyMs}ms
          </span>
        )}
      </div>
    </PillShell>
  );
}

function AppliedPill({
  trail,
  active,
}: {
  trail: NonNullable<ReturnType<typeof useVisualizerStore.getState>["voiceTrail"]>;
  active: boolean;
}) {
  const patch = trail.appliedPatch;
  return (
    <PillShell label="applied" active={active}>
      <div className="flex min-h-[18px] flex-wrap items-center gap-1.5">
        {!patch && active === false && (
          <span className="font-mono text-[10px] italic text-[color:var(--stone)]/60">
            waiting
          </span>
        )}
        {patch &&
          Object.keys(patch)
            .slice(0, 4)
            .map((k) => <Chip key={k} k={`+${k}`} v="" tone="signal" />)}
        {patch && Object.keys(patch).length === 0 && (
          <span className="font-mono text-[10px] italic text-[color:var(--stone)]/60">
            no patch
          </span>
        )}
        {trail.triggered === true && (
          <span className="font-mono nums ml-auto shrink-0 text-[9px] uppercase tracking-[0.18em] text-[color:var(--paper)]/85">
            → v{(trail.triggeredVersion ?? 0).toString().padStart(2, "0")}
          </span>
        )}
        {trail.triggered === false && (
          <span className="font-mono ml-auto shrink-0 text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]/60">
            no gen
          </span>
        )}
      </div>
    </PillShell>
  );
}

function Chip({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "signal" | "warn";
}) {
  return (
    <span
      className={cn(
        "font-mono inline-flex max-w-[160px] items-baseline gap-1 truncate rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em]",
        tone === "signal"
          ? "border-[color:var(--paper)]/40 text-[color:var(--paper)]"
          : tone === "warn"
            ? "border-[color:var(--stone)]/60 text-[color:var(--stone)]"
            : "border-[color:var(--hairline)]/40 text-[color:var(--paper)]/85",
      )}
      title={`${k}${k && v ? "=" : ""}${v}`}
    >
      {k && <span className="text-[color:var(--stone)]">{k}</span>}
      {v && <span>{v}</span>}
    </span>
  );
}
