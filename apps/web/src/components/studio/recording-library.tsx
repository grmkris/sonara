"use client";
import type { FrameSetSummary } from "@sonara/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StudioSidebarTabs } from "@/components/studio/studio-sidebar-tabs";
import { Button } from "@/components/ui/button";
import { experienceLabel } from "@/lib/instrument/catalog";
import { listLocalTakes } from "@/lib/instrument/take-storage";
import type { LocalTake } from "@/lib/instrument/take-storage";
import { rpcClient } from "@/lib/orpc";

const storageLabel = (take: LocalTake) => {
  if (take.recording) {
    return "Recovered on this device";
  }
  return take.setId ? "On this device · saved to account" : "On this device";
};

export const RecordingLibrary = () => {
  const router = useRouter();
  const [legacy, setLegacy] = useState<FrameSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [takes, setTakes] = useState<LocalTake[]>([]);
  const [saved, setSaved] = useState<
    Awaited<ReturnType<typeof rpcClient.takes.list>>
  >([]);
  useEffect(() => {
    void (async () => {
      try {
        setTakes(await listLocalTakes());
      } catch {
        toast.error("Local recording storage is unavailable.");
      }
      try {
        const [performances, recordings] = await Promise.all([
          rpcClient.takes.list(),
          rpcClient.sets.list({ origin: "recording" }),
        ]);
        setSaved(performances);
        const takeIds = new Set(performances.map((take) => take.setId));
        setLegacy(
          recordings.sets.filter((recording) => !takeIds.has(recording.id))
        );
      } catch {
        /* Local recordings work without an account. */
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  return (
    <main className="take-library">
      <header>
        <Link href="/">sonara.fm</Link>
        <Link href="/play">Play ↗</Link>
      </header>
      <StudioSidebarTabs
        tab="recordings"
        onTab={() => router.push("/studio?tab=sets")}
      />
      <span className="instrument-eyebrow">Studio / Recordings</span>
      <h1>Your recordings.</h1>
      <p>Replay, shape, and share the moments you made.</p>
      {loading && <output>Opening your recordings…</output>}
      <div className="take-list">
        {takes.toReversed().map((take) => (
          <Link
            className="take-row"
            key={take.manifest.id}
            href={`/studio/takes/${take.manifest.id}`}
          >
            <span className="take-orbit" aria-hidden>
              ◉
            </span>
            <div>
              <h2>{take.manifest.name}</h2>
              <span>
                {experienceLabel(take.manifest.config)} ·{" "}
                {Math.round(take.manifest.duration)}s
              </span>
            </div>
            <small>{storageLabel(take)}</small>
            <span>↗</span>
          </Link>
        ))}
        {saved
          .filter(
            (take) =>
              !takes.some(
                (local) =>
                  local.setId === take.setId ||
                  local.manifest.id === take.manifest?.id
              )
          )
          .map((take) => (
            <Link
              className="take-row"
              key={take.setId}
              href={`/studio/takes/${take.setId}`}
            >
              <span className="take-orbit" aria-hidden>
                ◉
              </span>
              <div>
                <h2>{take.name}</h2>
                <span>
                  {take.manifest
                    ? `${Math.round(take.manifest.duration)}s`
                    : "upload incomplete"}
                </span>
              </div>
              <small>Saved to account</small>
              <span>↗</span>
            </Link>
          ))}
        {legacy.map((recording) => (
          <Link
            className="take-row"
            key={recording.id}
            href={`/studio?recording=${recording.id}`}
          >
            <span className="take-orbit" aria-hidden>
              ◉
            </span>
            <div>
              <h2>{recording.name}</h2>
              <span>{recording.frameCount} frames</span>
            </div>
            <small>Saved to account</small>
            <span>↗</span>
          </Link>
        ))}
      </div>
      {!loading && takes.length + saved.length + legacy.length === 0 && (
        <div className="take-empty">
          <p>Nothing captured yet.</p>
          <Button asChild>
            <Link href="/play">Make your first take</Link>
          </Button>
        </div>
      )}
    </main>
  );
};
