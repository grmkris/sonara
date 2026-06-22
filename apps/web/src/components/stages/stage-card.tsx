"use client";

import { Check, Copy, Pencil } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { AppRouterClient } from "server/rpc";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// One stage as a card on /stages: name (inline rename), liveness, the
// permanent code, a crowd-join QR preview, and the stage's face links —
// each navigable and copyable. Stages are identity, not configuration,
// so the card stays read-mostly: rename is the only mutation here.

export type StageEntry = Awaited<
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

const QrPreview = ({ code }: { code: string }) => {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const joinUrl = `${window.location.origin}/stage/${code}`;
    let cancelled = false;
    void (async () => {
      const data = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 });
      if (!cancelled) {
        setQr(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!qr) {
    return <div aria-hidden className="size-24 shrink-0 md:size-28" />;
  }

  return (
    <Link
      href={`/stage/${code}/qr`}
      aria-label={`open the printable QR page for stage ${code}`}
      className="focus-ring shrink-0"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`scan to join stage ${code}`}
        className="size-24 rounded-sm border border-[color:var(--hairline)]/40 bg-white p-1.5 transition-opacity hover:opacity-85 md:size-28"
        src={qr}
      />
    </Link>
  );
};

const livenessLabel = (stage: StageEntry): string => {
  if (!stage.live) {
    return "idle";
  }
  return stage.screenAttached ? "live · screen on" : "live";
};

const FACE_ROWS = [
  { label: "crowd page", path: (code: string) => `/stage/${code}` },
  { label: "qr page (print)", path: (code: string) => `/stage/${code}/qr` },
  { label: "console", path: (code: string) => `/stage/${code}/console` },
  { label: "screen", path: (code: string) => `/stage/${code}/screen` },
] as const;

const FaceLinkRow = ({ label, path }: { label: string; path: string }) => {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <li className="flex items-center justify-between gap-2">
      <Link
        href={path}
        className="focus-ring rounded-sm px-2 py-1.5 font-sans text-[11px] text-[color:var(--paper)]/90 transition-colors hover:bg-[color:var(--paper)]/10"
      >
        {label}
      </Link>
      <button
        type="button"
        aria-label={`copy ${label} link`}
        onClick={() => void copyText(`${origin}${path}`, label)}
        className="focus-ring flex items-center rounded-sm p-1.5 text-[color:var(--stone)] transition-colors hover:bg-[color:var(--paper)]/10 hover:text-[color:var(--paper)]"
      >
        <Copy className="size-3 shrink-0" strokeWidth={1.5} />
      </button>
    </li>
  );
};

const StageName = ({
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
    <div className="flex min-w-0 flex-1 items-center gap-2">
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
          className="focus-ring min-w-0 flex-1 rounded-sm border border-[color:var(--hairline)]/40 bg-transparent px-1.5 py-0.5 font-serif text-[16px] italic text-[color:var(--paper)]"
        />
      ) : (
        <span className="line-clamp-1 min-w-0 flex-1 font-serif text-[16px] italic text-[color:var(--paper)]/90">
          {stage.name}
          {stage.isDefault && (
            <span className="ml-2 font-sans text-[8px] uppercase not-italic tracking-[0.2em] text-[color:var(--stone)]">
              default
            </span>
          )}
        </span>
      )}
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
    </div>
  );
};

export const StageCard = ({
  stage,
  onChanged,
}: {
  stage: StageEntry;
  onChanged: () => void;
}) => (
  <li className="flex flex-col gap-4 rounded-sm border border-[color:var(--hairline)]/25 p-4 md:p-5">
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          stage.live ? "bg-[color:var(--signal)]" : "bg-[color:var(--stone)]/50"
        )}
      />
      <StageName stage={stage} onChanged={onChanged} />
    </div>
    <div className="flex items-start gap-4">
      <QrPreview code={stage.code} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[18px] uppercase tracking-[0.24em] text-[color:var(--paper)]">
            {stage.code}
          </span>
          <span className="font-sans text-[9px] uppercase tracking-[0.2em] text-[color:var(--stone)]">
            {livenessLabel(stage)}
          </span>
        </div>
        <ul className="flex flex-col">
          {FACE_ROWS.map((f) => (
            <FaceLinkRow
              key={f.label}
              label={f.label}
              path={f.path(stage.code)}
            />
          ))}
        </ul>
      </div>
    </div>
  </li>
);
