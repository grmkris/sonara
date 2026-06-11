"use client";

import { useEffect, useState } from "react";

// Reveal `value` at most once every `ms`. Cheap throttle for telemetry
// readouts (AMP, etc.) that change every frame but only need to render
// a few times a second.
export const useThrottledValue = <T>(value: T, ms: number): T => {
  const [out, setOut] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);

  return out;
};
