// Trailing-edge debounce. Holds the latest call's args and fires `fn` after
// `waitMs` of quiet. `.flush()` fires immediately with the pending args (used
// on pointer-up so the final slider value always lands, even mid-debounce).
// `.cancel()` drops the pending call.
export interface Debounced<Args extends readonly unknown[]> {
  (...args: Args): void;
  flush: () => void;
  cancel: () => void;
}

export function debounce<Args extends readonly unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Args | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      const args = pending;
      pending = null;
      fn(...args);
    }
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = null;
    pending = null;
  };

  const debounced = ((...args: Args) => {
    pending = args;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, waitMs);
  }) as Debounced<Args>;

  debounced.flush = flush;
  debounced.cancel = cancel;
  return debounced;
}
