"use client";

import { getCurrentDisplacementCanvas } from "@/components/visualizer/canvas/displacement-canvas";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";

// Real-time A/V capture for the visualizer canvas. Video track is pulled
// straight off the WebGL canvas via captureStream(); audio is tapped off
// the AudioEngine compressor through a dedicated MediaStreamDestination.
// The HUD is DOM, so it is NOT in the recording — only the canvas pixels.

const FPS = 60;
const VIDEO_BITRATE = 6_000_000;
const AUDIO_BITRATE = 128_000;
const TIMESLICE_MS = 1000;

const PREFERRED_MIME_TYPES = [
  // Safari + recent Chromium produce MP4 directly — no transcode needed.
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  // Chromium / Firefox fall back to WebM. We transcode to MP4 on export.
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  for (const mt of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mt)) {
      return mt;
    }
  }
  return undefined;
}

export interface VideoRecorderHandle {
  readonly mimeType: string;
  readonly hasAudio: boolean;
  getDuration(): number;
  stop(): Promise<{ blob: Blob; mimeType: string }>;
}

export function isRecordingSupported(): boolean {
  return pickMimeType() !== undefined;
}

export function startRecording(opts: {
  withAudio: boolean;
}): VideoRecorderHandle {
  const canvas = getCurrentDisplacementCanvas();
  if (!canvas) {
    throw new Error("visualizer canvas not ready");
  }
  const mimeType = pickMimeType();
  if (!mimeType) {
    throw new Error("MediaRecorder is not supported in this browser");
  }

  const videoStream = canvas.captureStream(FPS);
  const videoTrack = videoStream.getVideoTracks()[0];
  if (!videoTrack) {
    throw new Error("canvas.captureStream produced no video track");
  }

  const audioTap = opts.withAudio
    ? (getCurrentAudioEngine()?.createRecordingStream() ?? null)
    : null;
  const audioTracks = audioTap?.stream.getAudioTracks() ?? [];

  const combined = new MediaStream([videoTrack, ...audioTracks]);
  const recorder = new MediaRecorder(combined, {
    audioBitsPerSecond: AUDIO_BITRATE,
    mimeType,
    videoBitsPerSecond: VIDEO_BITRATE,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  const startedAt = performance.now();
  recorder.start(TIMESLICE_MS);

  const cleanup = () => {
    audioTap?.dispose();
    for (const t of videoStream.getTracks()) {
      t.stop();
    }
  };

  return {
    getDuration: () => performance.now() - startedAt,
    hasAudio: audioTracks.length > 0,
    mimeType,
    stop() {
      return new Promise((resolve, reject) => {
        const finish = () => {
          cleanup();
          resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
        };
        recorder.onstop = finish;
        recorder.onerror = (ev) => {
          cleanup();
          reject(
            (ev as unknown as { error?: Error }).error ??
              new Error("MediaRecorder error")
          );
        };
        if (recorder.state === "inactive") finish();
        else recorder.stop();
      });
    },
  };
}

export function isMp4Mime(mimeType: string): boolean {
  return mimeType.startsWith("video/mp4");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function buildFilename(extension: "mp4" | "webm"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `sonara-${stamp}.${extension}`;
}
