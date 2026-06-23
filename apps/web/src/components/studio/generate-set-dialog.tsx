"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Slider } from "@/components/ui/slider";

// "Generate a set with AI": the user describes a visual world + picks a frame
// count; the server expands it into a coherent set (palette/style anchor + a
// baked look + N prompts) and streams frames in. Self-contained — owns its
// trigger button + dialog state; the parent passes only the mutation. Editorial
// --ink/--paper styling, mirroring shortcuts-help.tsx.

const COUNT_MIN = 4;
const COUNT_MAX = 24;
const COUNT_DEFAULT = 12;
const DESC_MIN = 4;
const DESC_MAX = 500;

const PLACEHOLDER =
  "misty jade dragon ascending over emerald mountains at dawn…";

export const GenerateSetDialog = ({
  onGenerate,
}: {
  onGenerate: (description: string, count: number) => Promise<boolean>;
}) => {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [count, setCount] = useState(COUNT_DEFAULT);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = description.trim();
  const canSubmit = trimmed.length >= DESC_MIN && !submitting;

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    const ok = await onGenerate(trimmed, count);
    setSubmitting(false);
    if (ok) {
      setDescription("");
      setCount(COUNT_DEFAULT);
      setOpen(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="generate a set with AI"
        className="focus-ring flex items-center gap-1 font-sans text-[9px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
      >
        <Sparkles className="size-3" strokeWidth={1.5} />
        generate
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[color:var(--ink)]/70 backdrop-blur-sm data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 w-[min(520px,92vw)] rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)] p-6 text-[color:var(--paper)] shadow-xl data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
          <Dialog.Title className="flex items-center gap-2 font-serif text-[18px] text-[color:var(--paper)] italic">
            <Sparkles className="size-4" strokeWidth={1.5} />
            Generate a set
          </Dialog.Title>
          <Dialog.Description className="mt-2 font-sans text-[12px] text-[color:var(--stone)] leading-relaxed">
            Describe one visual world. The AI picks a palette, a look, and the
            prompts, then renders the frames into a new editable set.
          </Dialog.Description>

          <div className="mt-5 flex flex-col gap-5">
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
                description
              </span>
              <textarea
                value={description}
                autoFocus
                maxLength={DESC_MAX}
                placeholder={PLACEHOLDER}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                className="focus-ring min-h-[72px] resize-none rounded-sm border border-[color:var(--hairline)]/40 bg-transparent px-3 py-2 font-sans text-[13px] text-[color:var(--paper)] leading-relaxed placeholder:text-[color:var(--stone)]/50"
              />
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
                  frames
                </span>
                <span className="font-mono text-[12px] text-[color:var(--paper)]">
                  {count}
                </span>
              </div>
              <Slider
                aria-label="frame count"
                value={[count]}
                min={COUNT_MIN}
                max={COUNT_MAX}
                step={1}
                onValueChange={(v) => {
                  const next = Array.isArray(v) ? v[0] : v;
                  if (typeof next === "number") {
                    setCount(next);
                  }
                }}
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <span className="font-mono text-[10px] text-[color:var(--stone)]">
              {count} {count === 1 ? "credit" : "credits"}
            </span>
            <div className="flex items-center gap-2">
              <Dialog.Close className="focus-ring inline-flex items-center border border-[color:var(--hairline)]/40 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]">
                cancel
              </Dialog.Close>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit()}
                className="focus-ring inline-flex items-center gap-1.5 border border-[color:var(--signal)] bg-[color:var(--signal)] px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? (
                  <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                ) : (
                  <Sparkles className="size-3" strokeWidth={2} />
                )}
                generate
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
