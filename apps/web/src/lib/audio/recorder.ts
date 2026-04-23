"use client";

// Ring-buffered MediaRecorder tap. Used to grab a recent N-second audio
// slice from the live AudioContext graph for song recognition. Runs a
// continuous MediaRecorder with a short timeslice and keeps the last
// ~windowMs worth of chunks in a ring buffer; grabClip() concatenates
// those chunks into a single Blob that is itself a valid WebM because
// ondataavailable always emits cluster-aligned fragments within one session.

const TIMESLICE_MS = 500;
// If Opus is available we prefer it (Chrome/Edge/Firefox on desktop support
// audio/webm;codecs=opus). Safari has no tab-capture so we don't worry about
// its audio/mp4 story here — recognition needs tab capture to be worthwhile.
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mt of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return undefined;
}

export interface ClipRecorder {
  /** Returns a Blob containing roughly the last `windowMs` of audio. */
  grabClip(): Promise<{ blob: Blob; mimeType: string } | null>;
  stop(): void;
  /** Mime type chosen at construction. */
  readonly mimeType: string;
}

export function createClipRecorder(
  ctx: AudioContext,
  source: AudioNode,
  opts: { windowMs?: number } = {},
): ClipRecorder | null {
  const mimeType = pickMimeType();
  if (!mimeType) return null;

  const windowMs = Math.max(3000, opts.windowMs ?? 6000);
  const maxChunks = Math.ceil(windowMs / TIMESLICE_MS) + 1;

  // Dedicated stream destination so the recording is independent of the
  // compressor's downstream connections to analyser/destination.
  const dest = ctx.createMediaStreamDestination();
  source.connect(dest);

  const recorder = new MediaRecorder(dest.stream, {
    mimeType,
    audioBitsPerSecond: 64_000,
  });

  const ring: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    ring.push(ev.data);
    while (ring.length > maxChunks) ring.shift();
  };

  try {
    recorder.start(TIMESLICE_MS);
  } catch (err) {
    console.warn("[ClipRecorder] start failed", err);
    try {
      source.disconnect(dest);
    } catch {
      // noop
    }
    return null;
  }

  let stopped = false;

  return {
    mimeType,
    async grabClip() {
      if (stopped || ring.length === 0) return null;
      // `requestData` fires an ondataavailable synchronously from the user's
      // perspective — we await a short microtask window to ensure the chunk
      // lands in the ring before we snapshot it.
      try {
        recorder.requestData();
      } catch {
        // some browsers complain if state != "recording"; ignore
      }
      await new Promise((r) => setTimeout(r, 60));
      if (ring.length === 0) return null;
      const snapshot = ring.slice();
      const blob = new Blob(snapshot, { type: mimeType });
      return { blob, mimeType };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        recorder.stop();
      } catch {
        // noop
      }
      try {
        source.disconnect(dest);
      } catch {
        // noop
      }
      for (const track of dest.stream.getTracks()) track.stop();
      ring.length = 0;
    },
  };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // btoa needs a binary string. Chunk to avoid call-stack limits on large clips.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
    );
  }
  return btoa(binary);
}
