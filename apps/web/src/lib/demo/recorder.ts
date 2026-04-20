import { useVisualizerStore } from "@/stores/visualizer-store";

// Browser-side capture state machine. Observes the zustand store's
// `currentFrame` and appends every new non-null URL (paired with the elapsed
// ms since Start) into a frames array. Intended for dev-time capture of a
// demo playthrough — see apps/web/public/demos/README.md for the workflow.

export interface CaptureFrame {
  t: number; // seconds since start()
  url: string; // raw fal CDN URL
}

export interface CaptureSnapshot {
  slug: string;
  startedAt: number | null;
  elapsedSec: number;
  frames: CaptureFrame[];
  isRecording: boolean;
}

export interface Recorder {
  getSnapshot: () => CaptureSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: () => void;
  stop: () => void;
  reset: () => void;
  dispose: () => void;
}

export function createRecorder(slug: string): Recorder {
  let startedAt: number | null = null;
  let isRecording = false;
  const frames: CaptureFrame[] = [];
  let lastUrl: string | null = null;

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  // Watch the store. Record new frames only while `isRecording` is true AND
  // the URL has actually changed. We also snapshot `lastUrl` outside the
  // recording window so the first recorded-frame isn't accidentally the same
  // image that was already on screen.
  const unsubStore = useVisualizerStore.subscribe((state) => {
    const url = state.currentFrame;
    if (url === lastUrl) return;
    if (url && isRecording && startedAt !== null) {
      const t = (performance.now() - startedAt) / 1000;
      frames.push({ t, url });
      notify();
    }
    lastUrl = url;
  });

  // Tick to keep elapsedSec monotonic in the panel display.
  const tickInterval = setInterval(() => {
    if (isRecording) notify();
  }, 250);

  return {
    getSnapshot() {
      const elapsedSec =
        startedAt === null ? 0 : (performance.now() - startedAt) / 1000;
      return {
        slug,
        startedAt,
        elapsedSec,
        frames: frames.slice(),
        isRecording,
      };
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start() {
      if (isRecording) return;
      startedAt = performance.now();
      isRecording = true;
      // Seed `lastUrl` with the current store value so we don't re-record the
      // pre-existing frame as a captured frame at t=0.
      lastUrl = useVisualizerStore.getState().currentFrame;
      notify();
    },
    stop() {
      if (!isRecording) return;
      isRecording = false;
      notify();
    },
    reset() {
      isRecording = false;
      startedAt = null;
      frames.length = 0;
      lastUrl = useVisualizerStore.getState().currentFrame;
      notify();
    },
    dispose() {
      unsubStore();
      clearInterval(tickInterval);
      listeners.clear();
    },
  };
}

export interface CaptureExport {
  slug: string;
  durationSec: number;
  frames: CaptureFrame[];
}

export function exportCapture(snapshot: CaptureSnapshot): CaptureExport {
  return {
    slug: snapshot.slug,
    durationSec: snapshot.elapsedSec,
    frames: snapshot.frames,
  };
}

export function downloadCaptureJson(snapshot: CaptureSnapshot): void {
  const payload = exportCapture(snapshot);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = "capture.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
