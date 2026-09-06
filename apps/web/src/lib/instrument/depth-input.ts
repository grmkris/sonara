// oxlint-disable unicorn/require-post-message-target-origin -- REVIEW: Worker.postMessage has no targetOrigin argument
export type DepthStatus = "idle" | "loading" | "estimating" | "ready" | "error";
const CACHE = "sonara-depth-c3b67641-v1";

// Lifetime belongs to the surface, not its popup. Only the image bytes enter
// this worker; network requests download the model, never upload the photo.
export class DepthInput {
  private worker: Worker | null = null;
  private request = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private source: string | null = null;
  private key: string | null = null;
  private busy = false;
  private failed = false;
  private stopped = false;
  private urls: string[] = [];
  url: string | null = null;
  onStatus: ((status: DepthStatus) => void) | null = null;
  onReady: ((url: string | null) => void) | null = null;
  update(source: string | null, enabled: boolean): void {
    if (this.stopped) {
      return;
    }
    if (source !== this.source) {
      this.cancel();
      this.source = source;
      this.url = null;
      this.failed = false;
      this.onReady?.(null);
    }
    if (!enabled || !source) {
      if (this.busy) {
        this.cancel();
      }
      this.onStatus?.("idle");
      return;
    }
    if (this.url) {
      this.onStatus?.("ready");
      return;
    }
    if (this.busy || this.failed) {
      return;
    }
    this.busy = true;
    this.onStatus?.("loading");
    void this.prepare(source, this.request);
  }
  retry(): void {
    this.failed = false;
    this.update(this.source, true);
  }
  private async prepare(source: string, request: number): Promise<void> {
    try {
      this.controller = new AbortController();
      const response = await fetch(source, {
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(20_000),
        ]),
      });
      if (!response.ok) {
        throw new Error("Could not read image.");
      }
      const blob = await response.blob();
      const hash = await crypto.subtle.digest(
        "SHA-256",
        await blob.arrayBuffer()
      );
      const key = `${location.origin}/_sonara_depth/${[...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      let cached: Response | undefined;
      try {
        const cache = await caches.open(CACHE);
        cached = await cache.match(key);
      } catch {
        /* Private browsing can disable persistent caching. */
      }
      if (request !== this.request || this.stopped) {
        return;
      }
      this.key = key;
      if (cached) {
        this.complete(await cached.blob(), request);
        return;
      }
      this.worker ??= this.createWorker();
      this.timer = setTimeout(() => {
        this.fail();
      }, 120_000);
      this.worker.postMessage({ blob });
    } catch {
      if (request === this.request && !this.stopped) {
        this.fail();
      }
    }
  }
  private createWorker(): Worker {
    const worker = new Worker(new URL("depth.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("error", () => {
      if (this.worker === worker) {
        this.fail();
      }
    });
    worker.addEventListener(
      "message",
      (event: MessageEvent<{ blob?: Blob; status: DepthStatus }>) => {
        if (this.stopped || this.worker !== worker) {
          return;
        }
        const { blob, status } = event.data;
        if (status === "ready" && blob) {
          this.complete(blob, this.request);
          if (this.key) {
            void DepthInput.cache(this.key, blob);
          }
        } else if (status === "error") {
          this.fail();
        } else {
          this.onStatus?.(status);
        }
      }
    );
    return worker;
  }
  private static async cache(key: string, blob: Blob): Promise<void> {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(
        key,
        new Response(blob, { headers: { "Content-Type": "image/png" } })
      );
      const keys = await cache.keys();
      await Promise.all(
        keys
          .slice(0, Math.max(0, keys.length - 12))
          .map((entry) => cache.delete(entry))
      );
    } catch {
      /* The current image still works without persistent storage. */
    }
  }
  private complete(blob: Blob, request: number): void {
    if (this.stopped || request !== this.request) {
      return;
    }
    this.busy = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.url = URL.createObjectURL(blob);
    this.urls.push(this.url);
    this.onReady?.(this.url);
    this.onStatus?.("ready");
  }
  private fail(): void {
    this.cancel();
    this.failed = true;
    this.onStatus?.("error");
  }
  private cancel(): void {
    this.request += 1;
    this.controller?.abort();
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.busy) {
      this.worker?.terminate();
      this.worker = null;
    }
    this.busy = false;
  }
  dispose(): void {
    this.stopped = true;
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls = [];
  }
}
