"use client";

import { Check, Copy, Link2, Pencil } from "lucide-react";
import { useState } from "react";
import type { AppRouterClient } from "server/rpc";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { rpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// Minimal stage management on /control: the full list of YOUR stages (live or
// not) — rename inline, copy the three face links, create a named extra
// stage. Deliberately tiny: stages are identity, not configuration.

type StageEntry = Awaited<
  ReturnType<AppRouterClient["control"]["stages"]>
>["stages"][number];

const copyText = async (text: string, label: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("couldn't copy");
  }
};

const FaceLinks = ({ stage }: { stage: StageEntry }) => {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const faces = [
    { label: "screen (projector)", url: `${origin}/stage/${stage.code}/screen` },
    { label: "console (phone)", url: `${origin}/stage/${stage.code}/console` },
    { label: "crowd (QR)", url: `${origin}/stage/${stage.code}` },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="copy stage links"
          className="focus-ring flex items-center text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          <Link2 className="size-3.5" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-72 rounded-sm border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/95 p-2 text-[color:var(--paper)] backdrop-blur-md"
      >
        <ul className="flex flex-col">
          {faces.map((f) => (
            <li key={f.label}>
              <button
                type="button"
                onClick={() => void copyText(f.url, f.label)}
                className="focus-ring flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--paper)]/10"
              >
                <span className="font-sans text-[11px] text-[color:var(--paper)]/90">
                  {f.label}
                </span>
                <Copy
                  className="size-3 shrink-0 text-[color:var(--stone)]"
                  strokeWidth={1.5}
                />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

const StageRow = ({
  stage,
  onChanged,
}: {
  stage: StageEntry;
  onChanged: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);

  const commitRename = async (): Promise<void> => {
    const next = name.trim();
    setEditing(false);
    if (!next || next === stage.name) {
      setName(stage.name);
      return;
    }
    try {
      await rpcClient.control.renameStage({
        name: next,
        stageId: stage.stageId,
      });
      onChanged();
    } catch {
      toast.error("couldn't rename");
      setName(stage.name);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-sm border border-[color:var(--hairline)]/25 px-3 py-2">
      <span
        aria-hidden
        title={stage.live ? "live" : "idle"}
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          stage.live ? "bg-[color:var(--signal)]" : "bg-[color:var(--stone)]/50"
        )}
      />
      {editing ? (
        <input
          // oxlint-disable-next-line no-autofocus -- entered via the rename button; focus loss IS the commit gesture
          autoFocus
          aria-label="stage name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void commitRename();
            }
            if (e.key === "Escape") {
              setName(stage.name);
              setEditing(false);
            }
          }}
          className="focus-ring min-w-0 flex-1 rounded-sm border border-[color:var(--hairline)]/40 bg-transparent px-1.5 py-0.5 font-serif text-[13px] italic text-[color:var(--paper)]"
        />
      ) : (
        <span className="line-clamp-1 min-w-0 flex-1 font-serif text-[13px] normal-case italic tracking-normal text-[color:var(--paper)]/90">
          {stage.name}
          {stage.isDefault && (
            <span className="ml-2 font-sans text-[8px] uppercase not-italic tracking-[0.2em] text-[color:var(--stone)]">
              default
            </span>
          )}
        </span>
      )}
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
        {stage.code}
      </span>
      <button
        type="button"
        aria-label={editing ? "save name" : "rename stage"}
        onClick={() => {
          if (editing) {
            void commitRename();
          } else {
            setEditing(true);
          }
        }}
        className="focus-ring flex items-center text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
      >
        {editing ? (
          <Check className="size-3.5" strokeWidth={1.5} />
        ) : (
          <Pencil className="size-3.5" strokeWidth={1.5} />
        )}
      </button>
      <FaceLinks stage={stage} />
    </li>
  );
};

export const StageManager = ({
  stages,
  onChanged,
}: {
  stages: StageEntry[];
  onChanged: () => void;
}) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const create = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    try {
      await rpcClient.control.createStage({ name });
      setNewName("");
      setCreating(false);
      onChanged();
      toast.success(`“${name}” created`);
    } catch {
      toast.error("couldn't create the stage");
    }
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <p className="font-sans text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
        your stages
      </p>
      <ul className="flex flex-col gap-1.5">
        {stages.map((s) => (
          <StageRow key={s.stageId} stage={s} onChanged={onChanged} />
        ))}
      </ul>
      {creating ? (
        <div className="flex items-center gap-2">
          <input
            // oxlint-disable-next-line no-autofocus -- entered via the new-stage button
            autoFocus
            aria-label="new stage name"
            value={newName}
            maxLength={60}
            placeholder="stage name — “main floor”, “bar screen”…"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void create();
              }
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            className="focus-ring min-w-0 flex-1 rounded-sm border border-[color:var(--hairline)]/40 bg-transparent px-2 py-1.5 font-serif text-[13px] italic text-[color:var(--paper)] placeholder:text-[color:var(--stone)]/60"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void create()}
            className="font-sans text-[10px] uppercase tracking-[0.24em]"
          >
            create
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="focus-ring w-fit font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
        >
          + new stage
        </button>
      )}
    </div>
  );
};
