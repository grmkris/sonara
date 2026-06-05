"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { debounce } from "@/lib/debounce";

interface SliderRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
}

export const SliderRow = ({ label, value, onChange }: SliderRowProps) => {
  const [dragging, setDragging] = useState(false);
  // Optimistic local value drives the thumb at pointer speed. Without it the
  // thumb is bound to `value` (round-tripped store state behind a 60ms debounce
  // + WS echo) and lags the pointer. Reconcile to the server echo whenever
  // we're not actively dragging.
  const [local, setLocal] = useState(value);
  const draggingRef = useRef(false);
  // Radix fires per pointer-move. Debounce WS emits to ~16/s; flush on
  // pointer-up / leave / blur so the final value always lands.
  const emit = useMemo(() => debounce(onChange, 60), [onChange]);

  useEffect(() => {
    if (!draggingRef.current) {
      setLocal(value);
    }
  }, [value]);

  const endDrag = () => {
    draggingRef.current = false;
    setDragging(false);
    emit.flush();
  };

  const node = (
    <Slider
      value={[local]}
      min={0}
      max={1}
      step={0.01}
      aria-label={label}
      onValueChange={(v) => {
        const next = Array.isArray(v) ? v[0] : v;
        if (typeof next === "number") {
          setLocal(next);
          emit(next);
        }
      }}
      onPointerDown={() => {
        draggingRef.current = true;
        setDragging(true);
      }}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onBlur={endDrag}
    />
  );

  return (
    <div className="flex items-center gap-3">
      <span className="font-serif w-20 shrink-0 text-[13px] text-[color:var(--paper)]/85">
        {label}
      </span>
      <div className="flex-1">
        <Tooltip open={dragging}>
          <TooltipTrigger asChild>
            <div className="flex items-center">{node}</div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={6}
            className="font-mono nums bg-[color:var(--ink)] text-[color:var(--paper)] border border-[color:var(--hairline)]/40 px-2 py-0.5 text-[10px] tracking-[0.14em]"
          >
            {local.toFixed(2)}
          </TooltipContent>
        </Tooltip>
      </div>
      <span className="font-mono nums w-10 text-right text-[10px] text-[color:var(--stone)]">
        {local.toFixed(2)}
      </span>
    </div>
  );
};
