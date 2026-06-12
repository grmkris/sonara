"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";
import { toast } from "sonner";

import { AppNavLinks } from "@/components/app-nav";
import { Mark } from "@/components/brand/mark";
import { StageConsole } from "@/components/stage-console/stage-console";
import { Button } from "@/components/ui/button";
import { useRemoteSession } from "@/hooks/use-remote-session";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// /stage/<code>/console — THE console for this stage, at a PERMANENT URL
// (bookmark it on the phone; it outlives every set). Bare /control is the
// resolver alias that lands here. Polls control.stages() so the "no screen
// connected" state self-resolves the moment the projector opens.

type StageEntry = Awaited<
  ReturnType<AppRouterClient["control"]["stages"]>
>["stages"][number];

const STAGES_POLL_MS = 3000;

const Shell = ({
  children,
  pill,
}: {
  children: React.ReactNode;
  pill?: React.ReactNode;
}) => (
  <main className="min-h-svh bg-[color:var(--ink)] px-5 pb-16 text-[color:var(--paper)]">
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 pt-7">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2.5 text-[color:var(--paper)]/85">
          <Mark className="h-6 w-6 shrink-0" />
          <span className="font-serif text-[20px] italic">console</span>
        </span>
        <div className="flex items-center gap-4">
          <AppNavLinks current="live" />
          {pill}
        </div>
      </header>
      {children}
    </div>
  </main>
);

const ConnectedPill = ({ connected }: { connected: boolean }) => (
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
);

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col items-center gap-4 pt-16 text-center">
    {children}
  </div>
);

// The live console: page owns the binding, StageConsole presents.
const LiveStageConsole = ({ stage }: { stage: StageEntry }) => {
  const { send, snapshot, connected } = useRemoteSession({
    stageId: stage.stageId,
  });
  return (
    <Shell pill={<ConnectedPill connected={connected} />}>
      <div className="-mt-2 flex items-center justify-between">
        <span className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)]">
          {stage.name} · {stage.code}
        </span>
        <span className="flex items-center gap-4">
          <Link
            href="/stages"
            className="focus-ring font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
          >
            stages
          </Link>
          <Link
            href={`/stage/${stage.code}`}
            className="focus-ring font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
          >
            crowd page ↗
          </Link>
        </span>
      </div>
      <StageConsole
        variant="detached"
        send={send}
        snapshot={snapshot}
        connected={connected}
        hostTarget={{ stageId: stage.stageId }}
        onNewSet={() => send({ type: "set.new" })}
        onReset={() => send({ type: "session.reset" })}
      />
    </Shell>
  );
};

export default function StageConsolePage() {
  const params = useParams<{ room: string }>();
  const code = params.room.toUpperCase();
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;

  // Poll the caller's stages and pick this one by code. Keeps polling in the
  // not-live state so "open the screen on the display" self-resolves here.
  const [stage, setStage] = useState<StageEntry | null | undefined>();

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        const { stages } = await rpcClient.control.stages();
        if (!cancelled) {
          setStage(stages.find((s) => s.code === code) ?? null);
        }
      } catch {
        // transient — keep the last state
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, STAGES_POLL_MS);
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
  }, [isSignedIn, code]);

  if (isPending) {
    return <Shell>{null}</Shell>;
  }

  if (!isSignedIn) {
    return (
      <Shell>
        <Centered>
          <p className="font-serif text-[15px] italic text-[color:var(--paper)]/85">
            sign in to open this console.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/login?next=/stage/${params.room}/console`}
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              sign in
            </Link>
          </Button>
        </Centered>
      </Shell>
    );
  }

  if (stage === undefined) {
    return <Shell>{null}</Shell>;
  }

  if (stage === null) {
    return (
      <Shell>
        <Centered>
          <p className="font-serif text-[15px] italic text-[color:var(--paper)]/85">
            none of your stages answers to “{code}”.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/stages"
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              your stages
            </Link>
          </Button>
        </Centered>
      </Shell>
    );
  }

  if (!stage.live) {
    const screenUrl =
      typeof window === "undefined"
        ? `/stage/${stage.code}/screen`
        : `${window.location.origin}/stage/${stage.code}/screen`;
    return (
      <Shell>
        <Centered>
          <p className="font-serif text-[15px] italic text-[color:var(--paper)]/85">
            no screen connected to <strong>{stage.name}</strong> — open{" "}
            <span className="font-mono text-[13px] not-italic">/play</span> (or
            this stage&apos;s screen link) on the display.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="font-sans text-[11px] uppercase tracking-[0.24em]"
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(screenUrl);
                  toast.success("screen link copied");
                } catch {
                  toast.error("couldn't copy");
                }
              })();
            }}
          >
            copy screen link
          </Button>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
            watching for your projector…
          </p>
        </Centered>
      </Shell>
    );
  }

  return <LiveStageConsole stage={stage} />;
}
