// oxlint-disable promise/prefer-await-to-then, promise/prefer-await-to-callbacks, promise/avoid-new, eslint/no-await-in-loop -- REVIEW: ordered recorder queue bridges browser events without blocking the render loop
import type { TakeEvent } from "@sonara/shared";

import type { AudioEngine } from "@/lib/audio/analyzer";

import type { InstrumentRuntime } from "./runtime";
import { appendChunk, saveLocalTake } from "./take-storage";
import type { ChunkKind, LocalTake } from "./take-storage";

export class TakeRecorder {
  take: LocalTake;
  private runtime: InstrumentRuntime;
  private recorders: MediaRecorder[] = [];
  private stream: MediaStream | null = null;
  private audioTap: ReturnType<AudioEngine["createRecordingStream"]> = null;
  private queue = Promise.resolve();
  private events: TakeEvent[] = [];
  private origin = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private stopping: Promise<LocalTake> | null = null;
  private pendingBytes = 0;
  private images = new Map<string, number>();
  private previousEvent: InstrumentRuntime["onEvent"];
  onError: ((message: string) => void) | null = null;
  constructor(runtime: InstrumentRuntime, name: string) {
    this.runtime = runtime;
    this.previousEvent = runtime.onEvent;
    this.take = {
      counts: { audio: 0, events: 0, images: 0, masks: 0, video: 0 },
      manifest: {
        config: structuredClone(runtime.config),
        createdAt: new Date().toISOString(),
        duration: 0,
        engine: "sonara-1",
        id: crypto.randomUUID(),
        name: name || "Untitled performance",
        version: 1,
      },
      recording: true,
    };
  }
  async start(
    audio: AudioEngine | null,
    imageUrl: string | null = null
  ): Promise<void> {
    if (typeof MediaRecorder === "undefined") {
      throw new TypeError("Recording is unavailable in this browser.");
    }
    await saveLocalTake(this.take);
    this.audioTap = audio?.createRecordingStream() ?? null;
    this.stream = this.runtime.renderer.canvas.captureStream(30);
    for (const track of this.audioTap?.stream.getAudioTracks() ?? []) {
      this.stream.addTrack(track);
    }
    this.runtime.reset();
    this.origin = this.runtime.elapsed;
    if (imageUrl) {
      this.captureImage(imageUrl, 0);
    }
    this.events.push({
      config: structuredClone(this.runtime.config),
      kind: "scene",
      time: 0,
    });
    this.runtime.onEvent = (event) => {
      this.previousEvent?.(event);
      if (event.kind === "image") {
        this.captureImage(event.url, Math.max(0, event.time - this.origin));
      } else {
        this.events.push({
          ...event,
          time: Math.max(0, event.time - this.origin),
        });
      }
    };
    this.addRecorder(this.stream, "video", [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/mp4",
    ]);
    if (this.audioTap) {
      this.addRecorder(this.audioTap.stream, "audio", [
        "audio/webm;codecs=opus",
        "audio/mp4",
      ]);
    }
    this.timer = setInterval(() => {
      this.flushEvents();
    }, 1000);
  }
  private captureImage(url: string, time: number): void {
    this.queue = this.queue
      .then(async () => {
        let index = this.images.get(url);
        if (index === undefined) {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) {
            throw new Error("Could not preserve an image input in this take.");
          }
          const bitmap = await createImageBitmap(await response.blob());
          const scale = Math.min(
            1,
            1280 / Math.max(bitmap.width, bitmap.height)
          );
          const canvas = new OffscreenCanvas(
            Math.round(bitmap.width * scale),
            Math.round(bitmap.height * scale)
          );
          canvas
            .getContext("2d")
            ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          const blob = await canvas.convertToBlob({
            quality: 0.85,
            type: "image/jpeg",
          });
          index = this.take.counts.images;
          await appendChunk(this.take, "images", blob);
          this.images.set(url, index);
        }
        this.events.push({ kind: "image", time, url: `take-image:${index}` });
      })
      .catch((error: unknown) => {
        this.onError?.(
          error instanceof Error
            ? error.message
            : "Could not preserve the image input."
        );
        if (!this.stopped) {
          this.stopAfterFailure();
        }
      });
  }
  private stopAfterFailure(): void {
    void this.stop().catch(() => {
      /* Saved chunks remain recoverable if storage is full. */
    });
  }
  private addRecorder(
    stream: MediaStream,
    kind: "audio" | "video",
    formats: string[]
  ): void {
    const mimeType = formats.find((format) =>
      MediaRecorder.isTypeSupported(format)
    );
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      ...(kind === "video" ? { videoBitsPerSecond: 8_000_000 } : {}),
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) {
        this.enqueue(kind, event.data);
      }
    });
    recorder.addEventListener("error", () => {
      this.onError?.(
        "Recording stopped unexpectedly. The saved chunks remain in Studio."
      );
      void this.stop();
    });
    this.recorders.push(recorder);
    recorder.start(1000);
  }
  private enqueue(kind: ChunkKind, blob: Blob): void {
    this.pendingBytes += blob.size;
    if (this.pendingBytes > 64 * 1024 * 1024) {
      this.pendingBytes -= blob.size;
      this.onError?.("Storage cannot keep up. Finishing the recoverable take.");
      void this.stop();
      return;
    }
    this.queue = this.queue
      .then(async () => {
        const data =
          kind === "masks"
            ? await new Response(
                blob.stream().pipeThrough(new CompressionStream("gzip"))
              ).blob()
            : blob;
        for (let offset = 0; offset < data.size; offset += 3 * 1024 * 1024) {
          await appendChunk(
            this.take,
            kind,
            data.slice(
              offset,
              offset + 3 * 1024 * 1024,
              kind === "masks" ? "application/gzip" : blob.type
            )
          );
        }
        this.pendingBytes -= blob.size;
      })
      .catch((error: unknown) => {
        this.onError?.(
          error instanceof Error ? error.message : "Recording storage is full."
        );
        if (!this.stopped) {
          void this.stop();
        }
      });
  }
  private flushEvents(): void {
    if (!this.stopped) {
      this.take.manifest.duration = Math.max(
        0,
        this.runtime.elapsed - this.origin
      );
    }
    if (this.events.length === 0) {
      return;
    }
    this.enqueue(
      "events",
      new Blob([JSON.stringify(this.events)], { type: "application/json" })
    );
    this.events = [];
  }
  recordMask(pixels: Uint8Array, width: number, height: number): void {
    if (this.stopped) {
      return;
    }
    const header = new ArrayBuffer(16);
    const view = new DataView(header);
    view.setFloat64(0, Math.max(0, this.runtime.elapsed - this.origin));
    view.setUint32(8, width);
    view.setUint32(12, height);
    this.enqueue(
      "masks",
      new Blob([header, new Uint8Array(pixels)], {
        type: "application/octet-stream",
      })
    );
  }
  stop(): Promise<LocalTake> {
    this.stopping ??= this.finish();
    return this.stopping;
  }
  private async finish(): Promise<LocalTake> {
    this.take.manifest.duration = Math.max(
      0,
      this.runtime.elapsed - this.origin
    );
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.runtime.onEvent = this.previousEvent;
    await Promise.all(
      this.recorders.map(
        (recorder) =>
          new Promise<void>((resolve) => {
            if (recorder.state === "inactive") {
              resolve();
              return;
            }
            recorder.addEventListener(
              "stop",
              () => {
                resolve();
              },
              { once: true }
            );
            recorder.stop();
          })
      )
    );
    // Image fetches can append events while their queued assets finish. Drain
    // those first, then save the final event batch.
    await this.queue;
    this.flushEvents();
    await this.queue;
    for (const track of this.stream?.getVideoTracks() ?? []) {
      track.stop();
    }
    this.audioTap?.dispose();
    this.take.recording = false;
    await saveLocalTake(this.take);
    return this.take;
  }
}
