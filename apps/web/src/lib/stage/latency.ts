// Measures "tap → on-chain" latency on the audience page: stamp a mark when
// an on-chain write is fired, then match the first feed activity event whose
// sender is this device's smart account. FIFO with a timeout prune — honest
// end-to-end numbers (UserOp bundling included), not just block time.

export interface LatencyTracker {
  // The fire() catch path removes its pending mark so a failed tx can't
  // mis-match a later event.
  cancel: (id: number) => void;
  // Record t0 for an outgoing write; returns the mark id.
  markSend: () => number;
  // Latency in ms when `who` is us and a mark is pending, else null.
  match: (who: string, self: string | null) => number | null;
}

export const createLatencyTracker = (timeoutMs = 15_000): LatencyTracker => {
  let nextId = 1;
  const pending: { id: number; t0: number }[] = [];

  const prune = (now: number): void => {
    while (pending.length > 0 && now - (pending[0]?.t0 ?? now) > timeoutMs) {
      pending.shift();
    }
  };

  return {
    cancel: (id) => {
      const at = pending.findIndex((p) => p.id === id);
      if (at !== -1) {
        pending.splice(at, 1);
      }
    },
    markSend: () => {
      const id = nextId;
      nextId += 1;
      pending.push({ id, t0: Date.now() });
      return id;
    },
    match: (who, self) => {
      const now = Date.now();
      prune(now);
      // Addresses may differ in checksum casing between the writer and the log.
      if (!self || who.toLowerCase() !== self.toLowerCase()) {
        return null;
      }
      const mark = pending.shift();
      return mark ? now - mark.t0 : null;
    },
  };
};
