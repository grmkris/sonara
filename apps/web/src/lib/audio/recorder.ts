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

const pickMimeType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  for (const mt of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mt)) {
      return mt;
    }
  }
  return undefined;
};

export interface ClipRecorder {
  /** Returns a Blob containing roughly the last `windowMs` of audio. */
  grabClip: () => Promise<{ blob: Blob; mimeType: string } | null>;
  stop: () => void;
  /** Mime type chosen at construction. */
  readonly mimeType: string;
}

export const createClipRecorder = (
  ctx: AudioContext,
  source: AudioNode,
  opts: { windowMs?: number } = {}
): ClipRecorder | null => {
  const mimeType = pickMimeType();
  if (!mimeType) {
    return null;
  }

  const windowMs = Math.max(3000, opts.windowMs ?? 6000);
  const maxChunks = Math.ceil(windowMs / TIMESLICE_MS) + 1;

  // Dedicated stream destination so the recording is independent of the
  // compressor's downstream connections to analyser/destination.
  const dest = ctx.createMediaStreamDestination();
  source.connect(dest);

  const recorder = new MediaRecorder(dest.stream, {
    audioBitsPerSecond: 64_000,
    mimeType,
  });

  // Chrome's MediaRecorder emits the WebM init segment (EBML + Segment header
  // + first Cluster) in the very first `ondataavailable` event; every later
  // event is pure Cluster data. If we drop the first chunk from the ring
  // (which a plain sliding window does once maxChunks fills), every grabClip
  // produces a headerless WebM that AudD cannot fingerprint ("problem with
  // creating an audio fingerprint"). Hold the init chunk out of the ring and
  // prepend it to every snapshot.
  let initChunk: Blob | null = null;
  const ring: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) {
      return;
    }
    if (initChunk === null) {
      initChunk = ev.data;
      return;
    }
    ring.push(ev.data);
    while (ring.length > maxChunks) {
      ring.shift();
    }
  };

  try {
    recorder.start(TIMESLICE_MS);
  } catch (error) {
    console.warn("[ClipRecorder] start failed", error);
    try {
      source.disconnect(dest);
    } catch {
      // noop
    }
    return null;
  }

  let stopped = false;

  return {
    async grabClip() {
      if (stopped) {
        return null;
      }
      // `requestData` fires an ondataavailable synchronously from the user's
      // perspective — we await a short microtask window to ensure the chunk
      // lands in the ring before we snapshot it.
      try {
        recorder.requestData();
      } catch {
        // some browsers complain if state != "recording"; ignore
      }
      // oxlint-disable-next-line promise/avoid-new -- REVIEW: setTimeout delay has no library-promise equivalent
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 60);
      });
      if (initChunk === null || ring.length === 0) {
        return null;
      }
      const blob = new Blob([initChunk, ...ring], { type: mimeType });
      return { blob, mimeType };
    },
    mimeType,
    stop() {
      if (stopped) {
        return;
      }
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
      for (const track of dest.stream.getTracks()) {
        track.stop();
      }
      ring.length = 0;
      initChunk = null;
    },
  };
};

export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // btoa needs a binary string. Chunk to avoid call-stack limits on large clips.
  let binary = "";
  const CHUNK = 0x80_00;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCodePoint(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    );
  }
  return btoa(binary);
};
