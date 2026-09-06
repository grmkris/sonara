"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { listLocalTakes } from "@/lib/instrument/take-storage";
import type { LocalTake } from "@/lib/instrument/take-storage";
import { rpcClient } from "@/lib/orpc";

export default function TakesPage() {
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
        setSaved(await rpcClient.takes.list());
      } catch {
        /* Local recordings work without an account. */
      }
    })();
  }, []);
  return (
    <main className="take-library">
      <header>
        <Link href="/studio">← studio</Link>
        <Link href="/play">play something new ↗</Link>
      </header>
      <span className="instrument-eyebrow">the things you felt</span>
      <h1>Your performances.</h1>
      <p>Films you can return to. Instruments you can play again.</p>
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
                {take.manifest.config.a.world} × {take.manifest.config.b.world}{" "}
                · {Math.round(take.manifest.duration)}s
              </span>
            </div>
            <small>
              {take.recording ? "recovered recording" : "on this device"}
            </small>
            <span>↗</span>
          </Link>
        ))}
        {saved
          .filter((take) => !takes.some((local) => local.setId === take.setId))
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
              <small>in your library</small>
              <span>↗</span>
            </Link>
          ))}
      </div>
      {takes.length + saved.length === 0 && (
        <div className="take-empty">
          <p>Nothing captured yet.</p>
          <Button asChild>
            <Link href="/play">Make your first take</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
