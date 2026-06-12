// In-memory token buckets for the public crowd-stage RPCs. Generation cost is
// already bounded by the dwell queue (one prompt plays per PROMPT_DWELL_MS per
// room) and the 200ms knob flush — this is purely anti-spam for the RPC
// surface itself. Keyed per room + caller (gateway-provided IP, falling back
// to the client handle when no proxy header is present, e.g. local dev).

interface Bucket {
  tokens: number;
  last: number;
}

interface BucketRule {
  capacity: number;
  // tokens per millisecond
  refillPerMs: number;
}

const PRUNE_EVERY_MS = 60_000;
const IDLE_EVICT_MS = 10 * 60_000;

const RULES = {
  // prompts — one every ~10s with a small burst allowance
  prompt: { capacity: 2, refillPerMs: 1 / 10_000 },
  // taps + absolute sets — generous; the screen coalesces anyway
  tap: { capacity: 20, refillPerMs: 10 / 1000 },
} as const satisfies Record<string, BucketRule>;

export type StageThrottleKind = keyof typeof RULES;

class StageThrottle {
  private readonly buckets = new Map<string, Bucket>();
  private lastPrune = 0;

  // Returns true when the action is allowed (and consumes a token).
  allow(kind: StageThrottleKind, room: string, caller: string): boolean {
    const now = Date.now();
    this.maybePrune(now);
    const rule = RULES[kind];
    const key = `${kind}|${room}|${caller}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { last: now, tokens: rule.capacity };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(
      rule.capacity,
      bucket.tokens + (now - bucket.last) * rule.refillPerMs
    );
    bucket.last = now;
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }

  // Call-driven, not timer-driven: entries idle past IDLE_EVICT_MS are only
  // evicted on the next allow() from ANY caller. If the whole crowd subsystem
  // goes quiet, the last crowd's buckets linger until the next call or
  // restart — a bounded residue (one entry per room+caller of the final gig),
  // accepted to keep the module timer-free for tests.
  private maybePrune(now: number): void {
    if (now - this.lastPrune < PRUNE_EVERY_MS) {
      return;
    }
    this.lastPrune = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.last > IDLE_EVICT_MS) {
        this.buckets.delete(key);
      }
    }
  }
}

export const stageThrottle = new StageThrottle();
