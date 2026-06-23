"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Tip } from "./tip";

// A keyboard-shortcuts cheat-sheet for the studio editor. Self-contained: the
// "?" button + a window listener (press `?`) both open it, and it lists only
// shortcuts that actually work today (the hand-rolled selection/cursor keys +
// the new range-select + zoom keys — no aspirational J/K/L/cut-paste). Mounted
// once in the studio page; owns its own state, so no prop threading.

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex min-w-[1.4rem] items-center justify-center rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)] px-1.5 py-0.5 font-mono text-[10px] tracking-[0.12em] text-[color:var(--paper)]/90">
    {children}
  </kbd>
);

const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    rows: [
      { keys: ["Click"], label: "Inspect a frame" },
      { keys: ["⌘", "Click"], label: "Toggle a frame in the selection" },
      { keys: ["⇧", "Click"], label: "Select the range up to here" },
      { keys: ["⌘", "A"], label: "Select all clips" },
      { keys: ["Esc"], label: "Clear the selection" },
      { keys: ["←", "→"], label: "Move between clips" },
      { keys: ["⇧", "←", "→"], label: "Extend the selection" },
      { keys: ["Space"], label: "Toggle the focused clip" },
    ],
    title: "select",
  },
  {
    rows: [
      { keys: ["⌘", "←", "→"], label: "Reorder the focused clip" },
      { keys: ["Del"], label: "Remove the selected clip(s)" },
    ],
    title: "edit",
  },
  {
    rows: [
      { keys: ["=", "−"], label: "Zoom in / out" },
      { keys: ["F"], label: "Fit the set in view" },
      { keys: ["N"], label: "Toggle snapping" },
      { keys: ["?"], label: "Show this help" },
    ],
    title: "view",
  },
];

export const ShortcutsHelp = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Tip text="Keyboard shortcuts · ?">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="keyboard shortcuts"
          className="focus-ring inline-flex size-7 items-center justify-center border border-[color:var(--hairline)]/40 font-mono text-[13px] text-[color:var(--stone)] transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
        >
          ?
        </button>
      </Tip>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-[color:var(--ink)]/70 backdrop-blur-sm data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
          <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(560px,92vw)] overflow-y-auto rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)] p-6 text-[color:var(--paper)] shadow-xl data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <Dialog.Title className="font-serif text-[18px] text-[color:var(--paper)] italic">
              Keyboard shortcuts
            </Dialog.Title>
            <div className="mt-5 flex flex-col gap-6">
              {GROUPS.map((g) => (
                <section className="flex flex-col gap-2" key={g.title}>
                  <h3 className="font-mono text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
                    {g.title}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {g.rows.map((r) => (
                      <li
                        className="flex items-center justify-between gap-4"
                        key={r.label}
                      >
                        <span className="font-sans text-[12px] text-[color:var(--paper)]/85">
                          {r.label}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {r.keys.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <p className="mt-5 font-mono text-[9px] text-[color:var(--stone)] leading-relaxed">
              Arrow / Space / Del / zoom keys act when a clip on the timeline is
              focused (click or tab to it first).
            </p>
            <Dialog.Close className="focus-ring mt-5 inline-flex items-center border border-[color:var(--hairline)]/40 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]">
              close · esc
            </Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};
