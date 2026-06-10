"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { StageScreen } from "@/components/stage-screen/stage-screen";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";

// /stage/<code>/screen — the projector face of a NAMED stage, pinned by its
// permanent code (bookmark it on the venue PC). Bare /play is the alias for
// your default stage. Ownership is enforced server-side at WS attach; the
// resolveStage gate here is UX only (clear copy instead of a dead canvas).

type Gate =
  | { kind: "checking" }
  | { kind: "not-found" }
  | { kind: "not-owner" }
  | { kind: "ok" };

const Notice = ({ children }: { children: React.ReactNode }) => (
  <main className="flex min-h-svh flex-col items-center justify-center gap-5 bg-[color:var(--ink)] px-6 text-center text-[color:var(--paper)]">
    <p className="font-serif text-[16px] italic text-[color:var(--paper)]/85">
      {children}
    </p>
  </main>
);

export default function StageScreenPage() {
  const params = useParams<{ room: string }>();
  const code = params.room.toUpperCase();
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;
  const [gate, setGate] = useState<Gate>({ kind: "checking" });

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { stage } = await rpcClient.control.resolveStage({ code });
        if (cancelled) {
          return;
        }
        if (!stage) {
          setGate({ kind: "not-found" });
        } else if (stage.isOwner) {
          setGate({ kind: "ok" });
        } else {
          setGate({ kind: "not-owner" });
        }
      } catch {
        if (!cancelled) {
          setGate({ kind: "not-found" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, code]);

  if (isPending) {
    return <main className="min-h-svh bg-[color:var(--ink)]" />;
  }

  if (!isSignedIn) {
    return (
      <Notice>
        sign in to open this stage&apos;s screen.
        <span className="mt-4 block">
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/login?next=/stage/${params.room}/screen`}
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              sign in
            </Link>
          </Button>
        </span>
      </Notice>
    );
  }

  if (gate.kind === "checking") {
    return <main className="min-h-svh bg-[color:var(--ink)]" />;
  }

  if (gate.kind === "not-found") {
    return <Notice>no stage answers to “{code}”.</Notice>;
  }

  if (gate.kind === "not-owner") {
    return (
      <Notice>
        this isn&apos;t your stage — scan the QR on the big screen to join the
        crowd instead.
        <span className="mt-4 block">
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/stage/${params.room}`}
              className="font-sans text-[11px] uppercase tracking-[0.24em]"
            >
              join the crowd
            </Link>
          </Button>
        </span>
      </Notice>
    );
  }

  return <StageScreen code={code} />;
}
