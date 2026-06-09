"use client";

import type { LiveSessionId } from "@sonara/shared/typeid";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";

import { AppNavLinks } from "@/components/app-nav";
import { Mark } from "@/components/brand/mark";
import { OperatorConsole } from "@/components/control/operator-console";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// /s/[id]/control — THE console for THIS set. The set id is the spine with
// two facets: /s/<id> is the public face (viewer/projector), this page is the
// owner's lean remote for the same show — no canvas, no viewer chrome, just
// the mixer (the shape /stage gets right for the crowd). Explicit and
// bookmarkable; with several shows running, each has its own console URL —
// no "newest session" guessing anywhere.

type Lens = Awaited<ReturnType<AppRouterClient["control"]["lens"]>>;

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

const Notice = ({
  children,
  setId,
}: {
  children: React.ReactNode;
  setId: string;
}) => (
  <div className="flex flex-col items-center gap-4 pt-16 text-center">
    <p className="font-serif text-[15px] italic text-[color:var(--paper)]/85">
      {children}
    </p>
    <div className="flex items-center gap-4">
      <Button asChild variant="ghost" size="sm">
        <Link
          href={`/s/${setId}`}
          className="font-sans text-[11px] uppercase tracking-[0.24em]"
        >
          public page
        </Link>
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link
          href="/play"
          className="font-sans text-[11px] uppercase tracking-[0.24em]"
        >
          play
        </Link>
      </Button>
    </div>
  </div>
);

export default function SetConsolePage() {
  const params = useParams<{ id: string }>();
  const { id } = params;
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;

  // One lens read on mount decides the gate (live? mine?); afterwards the
  // console's own ~1s snapshot poll (useRemoteSession inside OperatorConsole)
  // is the liveness signal — no second poll loop here.
  const [lens, setLens] = useState<Lens | null>(null);
  const [failed, setFailed] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await rpcClient.control.lens({ id });
        if (!cancelled) {
          setLens(next);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, id]);

  if (isPending) {
    return <Shell>{null}</Shell>;
  }

  if (!isSignedIn) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <p className="font-serif text-[15px] italic text-[color:var(--paper)]/85">
            sign in to open this console.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/login?next=/s/${id}/control`}
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              sign in
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (failed) {
    return (
      <Shell>
        <Notice setId={id}>couldn&apos;t reach the show — try again.</Notice>
      </Shell>
    );
  }

  if (!lens) {
    return <Shell>{null}</Shell>;
  }

  if (!lens.exists || lens.tense !== "live" || !lens.live) {
    return (
      <Shell>
        <Notice setId={id}>
          this set isn&apos;t live right now — press play to start it.
        </Notice>
      </Shell>
    );
  }

  if (!lens.isOwner) {
    return (
      <Shell>
        <Notice setId={id}>this isn&apos;t your show — but you can watch.</Notice>
      </Shell>
    );
  }

  return (
    <Shell pill={<ConnectedPill connected={connected} />}>
      <div className="-mt-2 flex items-center justify-between">
        <span className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)]">
          {lens.set?.name ?? "live session"}
        </span>
        <Link
          href={`/s/${id}`}
          className="focus-ring font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          public page ↗
        </Link>
      </div>
      <OperatorConsole
        liveSessionId={lens.live.liveSessionId as LiveSessionId}
        onConnectedChange={setConnected}
      />
    </Shell>
  );
}
