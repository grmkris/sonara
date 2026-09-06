// oxlint-disable promise/avoid-new -- REVIEW: yield between deterministic replay batches to keep cancellation responsive
// oxlint-disable eslint/no-await-in-loop -- REVIEW: chronological replay and bounded chunk reads must remain sequential
import { TakeEvent } from "@sonara/shared";
import type { InstrumentConfig } from "@sonara/shared";

import { InstrumentRuntime } from "./runtime";
import { readChunk } from "./take-storage";
import type { LocalTake } from "./take-storage";

export const readTakeEvents = async (take: LocalTake): Promise<TakeEvent[]> => {
  const events: TakeEvent[] = [];
  for (let i = 0; i < take.counts.events; i += 1) {
    const chunk = await readChunk(take.manifest.id, "events", i);
    const parsed = TakeEvent.array().parse(JSON.parse(await chunk.blob.text()));
    events.push(...parsed);
  }
  return events.toSorted((a, b) => a.time - b.time);
};
export class TakePlayer {
  readonly runtime: InstrumentRuntime;
  private events: TakeEvent[];
  private take: LocalTake;
  private eventIndex = 0;
  private maskIndex = 0;
  private nextMask: {
    time: number;
    width: number;
    height: number;
    data: Uint8Array;
  } | null = null;
  private imageUrls = new Map<string, string>();
  private disposed = false;
  time = 0;
  override: InstrumentConfig | null = null;
  constructor(canvas: HTMLCanvasElement, take: LocalTake, events: TakeEvent[]) {
    this.take = take;
    this.events = events;
    this.runtime = new InstrumentRuntime(canvas, {
      ...take.manifest.config,
      conductor: false,
    });
    this.runtime.replaying = true;
  }
  async init(): Promise<void> {
    await this.runtime.init();
    await this.readMask();
  }
  private async readMask(): Promise<void> {
    if (this.maskIndex >= this.take.counts.masks) {
      this.nextMask = null;
      return;
    }
    const chunk = await readChunk(
      this.take.manifest.id,
      "masks",
      this.maskIndex
    );
    const mask =
      chunk.blob.type === "application/gzip"
        ? await new Response(
            chunk.blob.stream().pipeThrough(new DecompressionStream("gzip"))
          ).blob()
        : chunk.blob;
    const bytes = await mask.arrayBuffer();
    if (bytes.byteLength < 16) {
      throw new Error("Invalid silhouette frame.");
    }
    const view = new DataView(bytes);
    const width = view.getUint32(8);
    const height = view.getUint32(12);
    if (
      width * height !== bytes.byteLength - 16 ||
      width > 1024 ||
      height > 1024
    ) {
      throw new Error("Invalid silhouette dimensions.");
    }
    this.nextMask = {
      data: new Uint8Array(bytes, 16),
      height,
      time: view.getFloat64(0),
      width,
    };
    this.maskIndex += 1;
  }
  async seek(to: number, signal?: AbortSignal): Promise<void> {
    const target = Math.max(0, Math.min(this.take.manifest.duration, to));
    if (target < this.time) {
      this.runtime.renderer.reset();
      this.runtime.transport.reset();
      this.runtime.elapsed = 0;
      this.runtime.transport.frozen = false;
      this.runtime.configure({
        ...this.take.manifest.config,
        conductor: false,
      });
      this.runtime.renderer.clearMask();
      this.time = 0;
      this.eventIndex = 0;
      this.maskIndex = 0;
      await this.readMask();
    }
    while (this.time <= target + 1e-8) {
      signal?.throwIfAborted();
      if (this.disposed) {
        return;
      }
      let event = this.events[this.eventIndex];
      while (event && event.time <= this.time + 1e-8) {
        if (event.kind === "image" && event.url.startsWith("take-image:")) {
          let url = this.imageUrls.get(event.url);
          if (!url) {
            const chunk = await readChunk(
              this.take.manifest.id,
              "images",
              Number(event.url.slice(11))
            );
            url = URL.createObjectURL(chunk.blob);
            this.imageUrls.set(event.url, url);
          }
          await this.runtime.applyEvent({ ...event, url });
        } else {
          await this.runtime.applyEvent(event);
        }
        if (event.kind === "scene" && this.override) {
          this.runtime.configure(this.override);
        }
        this.eventIndex += 1;
        event = this.events[this.eventIndex];
      }
      while (this.nextMask && this.nextMask.time <= this.time) {
        this.runtime.renderer.setMask(
          this.nextMask.data,
          this.nextMask.width,
          this.nextMask.height
        );
        await this.readMask();
      }
      this.runtime.config.conductor = false;
      this.runtime.advance(this.time);
      if (this.time === 0) {
        this.runtime.renderer.step(
          0,
          this.runtime.audio,
          this.runtime.controls
        );
      }
      this.time += 1 / 60;
      if (Math.round(this.time * 60) % 120 === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const url of this.imageUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.imageUrls.clear();
    this.runtime.dispose();
  }
}
