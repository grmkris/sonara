"use client";

import { ORPCError } from "@orpc/client";
import { deckLabel } from "@sonara/shared";
import type { DeckKey, SonaraSceneState } from "@sonara/shared";
import type { LiveSessionId } from "@sonara/shared/typeid";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";

import { Mark } from "@/components/brand/mark";
import { StageHostPanel } from "@/components/stage/stage-host-panel";
import { Button } from "@/components/ui/button";
import { DeckPicker } from "@/components/visualizer/controls/deck-picker";
import { IntensityDial } from "@/components/visualizer/controls/intensity-dial";
import { PromptInput } from "@/components/visualizer/controls/prompt-input";
import { SliderRow } from "@/components/visualizer/controls/slider-row";
import { useRemoteSession } from "@/hooks/use-remote-session";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

// /control — the operator remote. A signed-in user drives one of THEIR OWN
// currently-live sessions (the projector) from a second device while the
// projector shows a clean canvas. No WebSocket here: every control writes over
// the authed `control` HTTP router into the live Session, and the projector's
// canvas updates over its own socket. State is read back via ~1s snapshot polls
// (see useRemoteSession). Audio + presets stay on the Display.

type LiveSessionSummary = Awaited<
  ReturnType<AppRouterClient["control"]["liveSessions"]>
>["sessions"][number];

const SESSIONS_POLL_MS = 3000;

// The `control` router is protected, so an expired cookie surfaces here as an
// ORPCError with code UNAUTHORIZED — which we must show, not swallow. ORPCError
// implements Symbol.hasInstance, so instanceof is SSR-safe across module copies.
const isUnauthorized = (error: unknown): boolean =>
  error instanceof ORPCError && error.code === "UNAUTHORIZED";

const SLIDERS: {
  key: "softness" | "surrealness" | "abstraction" | "stability";
  label: string;
}[] = [
  { key: "softness", label: "soft" },
  { key: "surrealness", label: "unreal" },
  { key: "abstraction", label: "abstract" },
  { key: "stability", label: "stable" },
];

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="flex min-h-svh items-center justify-center bg-[color:var(--ink)] px-6 text-[color:var(--stone)]">
    <div className="font-mono text-[11px] uppercase tracking-[0.22em]">
      {children}
    </div>
  </main>
);

const Header = ({ connected }: { connected: boolean }) => (
  <header className="flex items-center justify-between">
    <span className="flex items-center gap-2 text-[color:var(--paper)]/85">
      <Mark className="h-6 w-6 shrink-0" />
      <span className="font-serif italic" style={{ fontSize: "22px" }}>
        remote
      </span>
    </span>
    <span
      className={cn(
        "flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em]",
        connected ? "text-[color:var(--paper)]/70" : "text-[color:var(--stone)]"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          connected ? "bg-[color:var(--signal)]" : "bg-[color:var(--stone)]/60"
        )}
      />
      {connected ? "linked" : "reconnecting…"}
    </span>
  </header>
);

const SessionSwitcher = ({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: LiveSessionSummary[];
  selectedId: LiveSessionId | null;
  onSelect: (id: LiveSessionId) => void;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {sessions.map((s, i) => {
      const active = s.liveSessionId === selectedId;
      let label: string;
      if (s.prompt?.trim()) {
        label = s.prompt.trim().slice(0, 22);
      } else if (s.demoDeck) {
        label = deckLabel(s.demoDeck);
      } else {
        label = `session ${i + 1}`;
      }
      return (
        <button
          key={s.liveSessionId}
          type="button"
          onClick={() => onSelect(s.liveSessionId)}
          className={cn(
            "focus-ring rounded-sm border px-2 py-1 font-sans text-[10px] uppercase tracking-[0.14em] transition-colors",
            active
              ? "border-[color:var(--paper)] bg-[color:var(--paper)] text-[color:var(--ink)]"
              : "border-[color:var(--hairline)]/30 text-[color:var(--stone)] hover:text-[color:var(--paper)]"
          )}
        >
          {label}
        </button>
      );
    })}
  </div>
);

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

export default function ControlPage() {
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;

  const [sessions, setSessions] = useState<LiveSessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<LiveSessionId | null>(null);
  const [authExpired, setAuthExpired] = useState(false);

  // Discover the caller's live sessions and keep re-resolving, so we rebind if
  // the projector closes/reopens. (The projector's liveSessionId is durable now
  // — client-owned — but re-resolving still cleanly handles it going away.)
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        const { sessions: next } = await rpcClient.control.liveSessions();
        if (!cancelled) {
          setSessions(next);
        }
      } catch (error) {
        // An expired session must surface (not leave a stale list on screen);
        // stop polling and let the render show the sign-in prompt. Other errors
        // are transient — keep the last list and retry next tick.
        if (!cancelled && isUnauthorized(error)) {
          setAuthExpired(true);
          stopped = true;
        }
      } finally {
        if (!(cancelled || stopped)) {
          timer = setTimeout(poll, SESSIONS_POLL_MS);
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
  }, [isSignedIn]);

  // Auto-select the newest live session; if the selected one disappears (the
  // projector reconnected with a fresh id, or closed), rebind to whatever's
  // live now.
  useEffect(() => {
    setSelectedId((cur) => {
      if (sessions.length === 0) {
        return null;
      }
      if (cur && sessions.some((s) => s.liveSessionId === cur)) {
        return cur;
      }
      return sessions[0]?.liveSessionId ?? null;
    });
  }, [sessions]);

  const { send, snapshot, connected } = useRemoteSession(selectedId);

  if (isPending) {
    return <Shell>loading…</Shell>;
  }

  if (!isSignedIn) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="font-serif text-[15px] text-[color:var(--paper)]/85">
            sign in to control your live session.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/login?next=/control"
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              sign in
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (authExpired) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="font-serif text-[15px] text-[color:var(--paper)]/85">
            your session expired — sign in again to keep controlling.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/login?next=/control"
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              sign in
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (sessions.length === 0) {
    return (
      <Shell>
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="font-serif text-[15px] text-[color:var(--paper)]/85">
            no live session yet.
          </p>
          <p className="font-sans text-[11px] leading-relaxed tracking-[0.06em] text-[color:var(--stone)]">
            open the visualizer on your projector and sign in with this account
            — it&apos;ll show up here, and you can drive it from this screen.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/play"
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              open the visualizer
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <main className="min-h-svh bg-[color:var(--ink)] text-[color:var(--paper)]">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-16 pt-8">
        <Header connected={connected} />

        {sessions.length > 1 && (
          <SessionSwitcher
            sessions={sessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        <PreviewCard
          lastFrameUrl={snapshot?.currentFrameUrl ?? snapshot?.lastFrameUrl ?? null}
          status={snapshot?.jobStatus ?? "idle"}
          prompt={snapshot?.scene.prompt ?? ""}
          demoMode={snapshot?.demoMode ?? false}
          demoDeck={snapshot?.demoDeck ?? null}
          connected={connected}
        />

        <StageHostPanel liveSessionId={selectedId} />

        <ControlSurface send={send} />
      </div>
    </main>
  );
}
