"use client";

import { useMemo, useState } from "react";
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

export function SliderRow({ label, value, onChange }: SliderRowProps) {
  const [dragging, setDragging] = useState(false);
  // Radix fires per pointer-move. Debounce WS emits to ~16/s; flush on
  // pointer-up / leave / blur so the final value always lands.
  const emit = useMemo(() => debounce(onChange, 60), [onChange]);

  const node = (
    <Slider
      value={[value]}
      min={0}
      max={1}
      step={0.01}
      aria-label={label}
      onValueChange={(v) => {
        const next = v[0];
        if (typeof next === "number") emit(next);
      }}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => {
        setDragging(false);
        emit.flush();
      }}
      onPointerLeave={() => {
        setDragging(false);
        emit.flush();
      }}
      onBlur={() => {
        setDragging(false);
        emit.flush();
      }}
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
            {value.toFixed(2)}
          </TooltipContent>
        </Tooltip>
      </div>
      <span className="font-mono nums w-10 text-right text-[10px] text-[color:var(--stone)]">
        {value.toFixed(2)}
      </span>
    </div>
  );
}
