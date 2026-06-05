"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { createRecorder, downloadCaptureJson } from "@/lib/demo/recorder";
import type { Recorder } from "@/lib/demo/recorder";

// Dev-time floating panel. Only mounts when `?record=<slug>` is in the URL.
// Captures every `currentFrame` transition while recording, then downloads a
// `capture.json` for the ingest CLI to consume.

const RecorderPanel = ({ slug }: { slug: string }) => {
  // Recreate the recorder when the slug changes; clean up on unmount.
  const recorder = useMemo<Recorder>(() => createRecorder(slug), [slug]);
  useEffect(() => () => recorder.dispose(), [recorder]);

  const snapshot = useSyncExternalStore(
    recorder.subscribe,
    recorder.getSnapshot,
    recorder.getSnapshot
  );

  // Shield against SSR hydration mismatches — only render after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return null;
  }

  const elapsed = `${snapshot.elapsedSec.toFixed(1)}s`;
  const count = snapshot.frames.length;

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 border border-[color:var(--signal)]/60 bg-[color:var(--ink)]/95 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--paper)] shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
      <span className="text-[color:var(--signal)]">rec</span>
      <span className="text-[color:var(--paper)]/60">slug</span>
      <span>{snapshot.slug}</span>
      <span className="text-[color:var(--paper)]/60">frames</span>
      <span className="nums">{count}</span>
      <span className="text-[color:var(--paper)]/60">t</span>
      <span className="nums">{elapsed}</span>
      {!snapshot.isRecording && snapshot.frames.length === 0 && (
        <Button variant="signal" size="sm" onClick={() => recorder.start()}>
          start
        </Button>
      )}
      {snapshot.isRecording && (
        <Button variant="signal" size="sm" onClick={() => recorder.stop()}>
          stop
        </Button>
      )}
      {!snapshot.isRecording && snapshot.frames.length > 0 && (
        <>
          <Button
            variant="signal"
            size="sm"
            onClick={() => downloadCaptureJson(snapshot)}
          >
            download
          </Button>
          <Button variant="ghost" size="sm" onClick={() => recorder.reset()}>
            reset
          </Button>
        </>
      )}
    </div>
  );
};

export const DemoRecorder = () => {
  const params = useSearchParams();
  const slug = params.get("record");
  if (!slug) {
    return null;
  }
  return <RecorderPanel slug={slug} />;
};
