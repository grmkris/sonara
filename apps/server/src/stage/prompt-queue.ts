import { MAX_STAGE_PROMPT_CHARS } from "@sonara/shared";

// Per-room prompt queue. Crowd prompts (stage.submitPrompt RPC) enqueue here;
// the scheduler rotates them onto the live session so EVERY submitter gets a
// turn on the projector (not just the latest). Plain FIFO — generation is
// paid by the stage owner's credits, so there is no priority lane.
//
// Pure logic with an injected clock so it's unit-testable; stage-actions
// drives it with a periodic tick() and supplies onPlay (which calls
// session.applyPatch with the prompt).

export interface QueuedPrompt {
  text: string;
  // opaque per-device handle (e.g. K7QX)
  who: string;
  enqueuedAt: number;
}

export interface PromptView {
  text: string;
  who: string;
}

export interface PromptQueueSnapshot {
  nowPlaying: PromptView | null;
  upNext: PromptView[];
}

export interface PromptQueueOptions {
  dwellMs: number;
  onPlay: (entry: QueuedPrompt) => void;
  now: () => number;
  maxLen?: number;
  maxTextLen?: number;
  onDrop?: (entry: QueuedPrompt, reason: string) => void;
}

const view = (e: QueuedPrompt): PromptView => ({
  text: e.text,
  who: e.who,
});

export class PromptQueue {
  private queue: QueuedPrompt[] = [];
  private playing: QueuedPrompt | null = null;
  private playingSince = 0;

  private readonly dwellMs: number;
  private readonly maxLen: number;
  private readonly maxTextLen: number;
  private readonly onPlay: (entry: QueuedPrompt) => void;
  private readonly onDrop?: (entry: QueuedPrompt, reason: string) => void;
  private readonly now: () => number;

  constructor(opts: PromptQueueOptions) {
    this.dwellMs = opts.dwellMs;
    this.maxLen = opts.maxLen ?? 20;
    this.maxTextLen = opts.maxTextLen ?? MAX_STAGE_PROMPT_CHARS;
    this.onPlay = opts.onPlay;
    this.onDrop = opts.onDrop;
    this.now = opts.now;
  }

  // Returns false when the prompt was rejected (empty / duplicate).
  enqueue(raw: Omit<QueuedPrompt, "text"> & { text: string }): boolean {
    const text = raw.text.trim().slice(0, this.maxTextLen);
    if (!text) {
      return false;
    }
    const entry: QueuedPrompt = { ...raw, text };

    // Dedup against what's already showing or queued (verbatim).
    if (
      this.playing?.text === text ||
      this.queue.some((q) => q.text === text)
    ) {
      return false;
    }

    // One in-flight queued prompt per sender — a re-submit replaces theirs
    // rather than letting one handle flood the line.
    const mineIdx = this.queue.findIndex((q) => q.who === entry.who);
    if (mineIdx !== -1) {
      this.queue.splice(mineIdx, 1);
    }

    this.queue.push(entry);

    // Cap length — drop the tail, never silently.
    while (this.queue.length > this.maxLen) {
      const dropped = this.queue.pop();
      if (dropped) {
        this.onDrop?.(dropped, "queue-full");
      }
    }

    // If nothing is playing, or the current prompt has already served its dwell,
    // start this one immediately rather than waiting for the next tick.
    if (!this.playing || this.now() - this.playingSince >= this.dwellMs) {
      this.advance();
    }
    return true;
  }

  // Advance when the current prompt has held the stage for its dwell window.
  // stage-actions calls this on a periodic tick.
  tick(): void {
    if (
      this.playing &&
      this.queue.length > 0 &&
      this.now() - this.playingSince >= this.dwellMs
    ) {
      this.advance();
    }
  }

  private advance(): void {
    const next = this.queue.shift();
    if (!next) {
      // empty queue: keep the current prompt playing (it sticks).
      return;
    }
    this.playing = next;
    this.playingSince = this.now();
    this.onPlay(next);
  }

  snapshot(): PromptQueueSnapshot {
    return {
      nowPlaying: this.playing ? view(this.playing) : null,
      upNext: this.queue.map(view),
    };
  }
}
