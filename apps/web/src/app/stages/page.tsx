"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppNavLinks } from "@/components/app-nav";
import { StageCard } from "@/components/stages/stage-card";
import type { StageEntry } from "@/components/stages/stage-card";
import { AnonCta } from "@/components/studio/anon-cta";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";

// The stage-management home: every stage you own as a card — liveness, the
// permanent code, the crowd QR, and the three face links. Polled lightly so
// the live dots can be trusted while a show is on (the console polls the
// same RPC at 3s; here 5s is plenty — this page is a lobby, not a console).

const STAGES_POLL_MS = 5000;

const CreateStage = ({ onChanged }: { onChanged: () => void }) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const create = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    try {
      await rpcClient.control.createStage({ name });
      setNewName("");
      setCreating(false);
      onChanged();
      toast.success(`“${name}” created`);
    } catch {
      toast.error("couldn't create the stage");
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-2">
        <input
          // oxlint-disable-next-line no-autofocus -- entered via the new-stage button
          autoFocus
          aria-label="new stage name"
          value={newName}
          maxLength={60}
          placeholder="stage name — “main floor”, “bar screen”…"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void create();
            }
            if (e.key === "Escape") {
              setCreating(false);
              setNewName("");
            }
          }}
          className="focus-ring min-w-0 flex-1 rounded-sm border border-[color:var(--hairline)]/40 bg-transparent px-2 py-1.5 font-serif text-[13px] italic text-[color:var(--paper)] placeholder:text-[color:var(--stone)]/60"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void create()}
          className="font-sans text-[10px] uppercase tracking-[0.24em]"
        >
          create
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setCreating(true)}
      className="focus-ring w-fit font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
    >
      + new stage
    </button>
  );
};

export default function StagesPage() {
  const { data: sessionData, isPending } = useSession();
  const isSignedIn = !!sessionData?.session;

  const [stages, setStages] = useState<StageEntry[]>([]);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [nonce, setNonce] = useState(0);
  const onChanged = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    let cancelled = false;
    const fetchStages = async (): Promise<void> => {
      try {
        const { stages: next } = await rpcClient.control.stages();
        if (!cancelled) {
          setStages(next);
          setBootstrapped(true);
        }
      } catch {
        // transient — keep the last list; bootstrapped flips on first success
      }
    };
    void fetchStages();
    const interval = setInterval(() => void fetchStages(), STAGES_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isSignedIn, nonce]);

  if (isPending) {
    return <main className="min-h-svh bg-[color:var(--ink)]" />;
  }
  if (!isSignedIn) {
    return (
      <AnonCta
        surface="stages"
        heading={
          <>
            sign in to manage
            <br />
            your stages.
          </>
        }
        body="A stage is your permanent room: a code the crowd can join, a QR you can print, a screen for the projector, and a console for your phone."
        next="/stages"
      />
    );
  }

  return (
    <main className="relative flex min-h-svh flex-col bg-[color:var(--ink)] text-[color:var(--paper)]">
      {/* Header — same chrome as /studio */}
      <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--hairline)]/30 px-4 py-3 md:px-10">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="focus-ring font-serif text-[13px] italic tracking-tight text-[color:var(--paper)]/85 transition-colors hover:text-[color:var(--paper)]"
          >
            sonara.fm
          </Link>
          <AppNavLinks current="stages" />
        </div>
      </header>

      <div className="flex flex-1 justify-center overflow-y-auto px-4 py-8 md:px-10 md:py-12">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <p className="font-sans text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            your stages
          </p>
          {bootstrapped && stages.length === 0 && (
            <p className="font-serif text-[15px] italic text-[color:var(--paper)]/70">
              No stages yet — create one and it gets a permanent code, a crowd
              QR, a screen, and a console.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {stages.map((s) => (
              <StageCard key={s.stageId} stage={s} onChanged={onChanged} />
            ))}
          </ul>
          {bootstrapped && <CreateStage onChanged={onChanged} />}
        </div>
      </div>
    </main>
  );
}
