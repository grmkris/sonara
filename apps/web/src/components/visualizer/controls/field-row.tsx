"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import type { RefObject } from "react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SceneFieldDef } from "@/lib/scene-fields";
import { cn } from "@/lib/utils";

interface FieldRowProps {
  field: SceneFieldDef;
  value: string;
  isOpen: boolean;
  isRunning: boolean;
  isLastCommitted: boolean;
  sweepKey: number;
  inputRef: (el: HTMLInputElement | null) => void;
  onDraftChange: (next: string) => void;
  onCommit: () => void;
  onCommitValue: (next: string) => void;
  onOpenChange: (open: boolean) => void;
  onFocusInput: () => void;
}

// One field of the left rail: numbered label, kbd hint, input, popover-
// backed suggestion palette, commit button, sweep indicator, optional
// "regenerating" chip. State lives in the parent PromptInput so the four
// rows can coordinate (e.g. only one popover open at a time).
export function FieldRow({
  field,
  value,
  isOpen,
  isRunning,
  isLastCommitted,
  sweepKey,
  inputRef,
  onDraftChange,
  onCommit,
  onCommitValue,
  onOpenChange,
  onFocusInput,
}: FieldRowProps) {
  const placeholder = field.suggestions[0];

  return (
    <div className="group relative flex flex-col gap-1.5">
      <div className="flex items-baseline gap-3">
        <span className="font-mono nums text-[10px] leading-none tracking-[0.2em] text-[color:var(--stone)]">
          {field.index}
        </span>
        <span className="font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
          {field.label}
        </span>
        <Kbd className="ml-auto">{field.pttLabel}</Kbd>
      </div>
      <div className="relative flex items-center gap-2">
        <Input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <Popover open={isOpen} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Pick ${field.label.toLowerCase()} from suggestions`}
              aria-expanded={isOpen}
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                "focus-ring relative shrink-0 text-[color:var(--stone)] transition-all hover:text-[color:var(--paper)]",
                "before:absolute before:inset-[-10px] before:content-['']",
                isOpen && "rotate-180 text-[color:var(--paper)]",
              )}
            >
              <ChevronDown className="size-3.5" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            collisionPadding={16}
            className="w-[min(320px,calc(100vw-32px))] border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/95 p-0 text-[color:var(--paper)] shadow-none backdrop-blur-md"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              onFocusInput();
            }}
          >
            <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--hairline)]/25 px-3 py-2">
              <span className="font-serif text-[12px] italic text-[color:var(--paper)]/85">
                {field.label.toLowerCase()}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
                pick or filter
              </span>
            </div>
            <Command
              className="bg-transparent text-[color:var(--paper)] [&_[cmdk-input-wrapper]]:px-3 [&_[cmdk-input-wrapper]_svg]:hidden"
              filter={(item, search) =>
                item.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
              }
            >
              <CommandInput
                placeholder={`filter ${field.label.toLowerCase()}…`}
                className="font-mono text-[11px] tracking-[0.04em] placeholder:text-[color:var(--stone)]/60"
              />
              <CommandList className="max-h-[240px]">
                <CommandEmpty className="font-sans py-4 text-center text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                  no match
                </CommandEmpty>
                {field.suggestions.map((chip) => {
                  const isActive = chip === value;
                  return (
                    <CommandItem
                      key={chip}
                      value={chip}
                      onSelect={() => onCommitValue(chip)}
                      className={cn(
                        "font-sans cursor-pointer rounded-none border-b border-[color:var(--hairline)]/15 px-3 py-2.5 text-[11px] tracking-[0.04em] last:border-b-0 aria-selected:bg-[color:var(--paper)]/10 aria-selected:text-[color:var(--paper)] data-[selected=true]:bg-[color:var(--paper)]/10 data-[selected=true]:text-[color:var(--paper)]",
                        isActive
                          ? "text-[color:var(--paper)]"
                          : "text-[color:var(--paper)]/75",
                      )}
                    >
                      {chip}
                      {isActive && (
                        <span className="font-mono ml-auto text-[9px] italic tracking-[0.18em] text-[color:var(--stone)]">
                          current
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
            <div className="border-t border-[color:var(--hairline)]/20 px-3 py-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
                ↩ commit · esc cancel
              </span>
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          aria-label={`Commit ${field.label.toLowerCase()}`}
          className={cn(
            "focus-ring relative shrink-0 text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]",
            "before:absolute before:inset-[-10px] before:content-['']",
          )}
          onClick={onCommit}
        >
          <ArrowRight className="size-3.5" strokeWidth={1.5} />
        </button>
        {sweepKey > 0 && (
          <span
            key={`${field.key}-${sweepKey}`}
            aria-hidden
            className="field-sweep"
          />
        )}
      </div>
      {isLastCommitted && isRunning && (
        <div
          aria-live="polite"
          className="font-sans text-[10px] italic tracking-[0.04em] text-[color:var(--stone)]/80"
        >
          ⟲ regenerating…
        </div>
      )}
    </div>
  );
}

// Imperative input-focus helper passed through props so the parent can
// re-focus the input after a popover commit.
export type FieldRefMap = RefObject<Record<string, HTMLInputElement | null>>;
