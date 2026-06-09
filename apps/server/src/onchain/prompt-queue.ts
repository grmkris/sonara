// Per-room prompt queue. On-chain Prompt events enqueue here; the scheduler
// rotates them onto the live session so EVERY submitter gets a turn on the
// projector (not just the latest). A non-zero tip buys priority — paid prompts
// jump ahead of free ones, but free prompts always still play.
//
// Pure logic with an injected clock so it's unit-testable; the listener drives
// it with a periodic tick() and supplies onPlay (which calls session.applyPatch
// with the prompt) — see stage-listener.

export interface QueuedPrompt {
  text: string;
  // on-chain sender (smart-account address under AA)
  who: string;
  // wei; priority key
  tip: bigint;
  enqueuedAt: number;
}

export interface PromptView {
  text: string;
  who: string;
  // wei as string for JSON
  tip: string;
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
  tip: e.tip.toString(),
  who: e.who,
});

// paid-first, then oldest-first.
const higherPriority = (a: QueuedPrompt, b: QueuedPrompt): boolean =>
  a.tip > b.tip || (a.tip === b.tip && a.enqueuedAt < b.enqueuedAt);

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
    this.maxTextLen = opts.maxTextLen ?? 200;
    this.onPlay = opts.onPlay;
    this.onDrop = opts.onDrop;
    this.now = opts.now;
  }

  // Returns false when the prompt was rejected (empty / duplicate / overflow).
  enqueue(raw: Omit<QueuedPrompt, "text"> & { text: string }): boolean {
    const text = raw.text.trim().slice(0, this.maxTextLen);
    if (!text) {
      return false;
    }
    const entry: QueuedPrompt = { ...raw, text };

    // Dedup against what's already showing or queued (verbatim).
    if (this.playing?.text === text || this.queue.some((q) => q.text === text)) {
      return false;
    }

    // One in-flight queued prompt per sender — a re-submit replaces theirs
    // rather than letting one address flood the line.
    const mineIdx = this.queue.findIndex((q) => q.who === entry.who);
    if (mineIdx !== -1) {
      this.queue.splice(mineIdx, 1);
    }

    // Priority insert (paid-first, then FIFO).
    const at = this.queue.findIndex((q) => higherPriority(entry, q));
    if (at === -1) {
      this.queue.push(entry);
    } else {
      this.queue.splice(at, 0, entry);
    }

    // Cap length — drop the lowest-priority tail, never silently.
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
  // The listener calls this on a periodic tick.
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
