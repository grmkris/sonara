"use client";

import type { FFmpeg } from "@ffmpeg/ffmpeg";

// WebM → MP4 transcode using ffmpeg.wasm. Loaded lazily so the ~30 MB
// core never enters the initial bundle — the dynamic import below only
// resolves on the first export from a browser that recorded WebM.

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

let cached: FFmpeg | null = null;

async function loadFfmpeg(): Promise<FFmpeg> {
  if (cached) return cached;
  const { FFmpeg: FFmpegCtor } = await import("@ffmpeg/ffmpeg");
  const instance = new FFmpegCtor();
  await instance.load({
    coreURL: `${CORE_BASE}/ffmpeg-core.js`,
    wasmURL: `${CORE_BASE}/ffmpeg-core.wasm`,
  });
  cached = instance;
  return instance;
}

export async function transcodeToMp4(
  webm: Blob,
  opts: { hasAudio: boolean; onProgress?: (ratio: number) => void },
): Promise<Blob> {
  const ffmpeg = await loadFfmpeg();

  const handleProgress = ({ progress }: { progress: number }) => {
    opts.onProgress?.(Math.max(0, Math.min(1, progress)));
  };
  ffmpeg.on("progress", handleProgress);

  const inputName = "in.webm";
  const outputName = "out.mp4";

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await webm.arrayBuffer()));

    const args = [
      "-i", inputName,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      ...(opts.hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
      outputName,
    ];
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);

    const out = (await ffmpeg.readFile(outputName)) as Uint8Array;
    // Copy into a fresh ArrayBuffer — ffmpeg.wasm hands back a view into WASM
    // memory (SharedArrayBuffer when cross-origin isolated), which Blob rejects.
    return new Blob([new Uint8Array(out)], { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", handleProgress);
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(outputName).catch(() => undefined);
  }
}
