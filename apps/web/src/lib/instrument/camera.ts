// oxlint-disable unicorn/require-post-message-target-origin -- REVIEW: Worker.postMessage has no targetOrigin argument
import type { PerformanceControlFrame } from "@sonara/shared";

export interface VisionFrame {
  control: PerformanceControlFrame;
  mask?: Uint8Array;
  width?: number;
  height?: number;
}
export class CameraInput {
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private stopped = false;
  private started = 0;
  private interval = 50;
  onFrame: ((frame: VisionFrame) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  async start(mode: "hands" | "body"): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        height: { ideal: 480 },
        width: { ideal: 640 },
      },
    });
    if (this.stopped) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }
    this.stream = stream;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.video = video;
    await video.play();
    if (this.stopped) {
      return;
    }
    const worker = new Worker(new URL("vision.worker.ts", import.meta.url));
    this.worker = worker;
    worker.addEventListener("error", () => {
      this.onError?.("Camera tracking could not start.");
      this.stop();
    });
    worker.addEventListener(
      "message",
      (
        event: MessageEvent<VisionFrame & { type: string; message?: string }>
      ) => {
        if (this.stopped) {
          return;
        }
        if (event.data.type === "error") {
          this.onError?.(event.data.message ?? "Camera tracking failed.");
          this.stop();
          return;
        }
        this.busy = false;
        if (event.data.type === "result") {
          this.interval = Math.max(
            50,
            Math.min(160, (performance.now() - this.started) * 1.3)
          );
          this.onFrame?.(event.data);
        }
        this.timer = setTimeout(
          () => {
            void this.tick();
          },
          Math.max(0, this.interval - (performance.now() - this.started))
        );
      }
    );
    worker.postMessage({ mode, type: "init" });
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        this.onError?.("Camera disconnected.");
        this.stop();
      });
    }
  }
  private async tick(): Promise<void> {
    if (this.stopped || this.busy || !this.video || !this.worker) {
      return;
    }
    this.busy = true;
    this.started = performance.now();
    try {
      const image = await createImageBitmap(this.video);
      if (this.stopped || !this.worker) {
        image.close();
        return;
      }
      this.worker.postMessage(
        { image, time: performance.now(), type: "frame" },
        [image]
      );
    } catch (error) {
      this.onError?.(
        error instanceof Error ? error.message : "Camera frame unavailable."
      );
      this.stop();
    }
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.worker?.terminate();
    this.worker = null;
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
  }
}
