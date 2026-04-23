"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BYOK_KEY = "dream.byokFalKey";

// Read the stored key synchronously from localStorage. Client-only hook —
// must only be called in effects / handlers, never during SSR render.
export function getByokFalKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(BYOK_KEY);
}

export function SettingsPanel({ onClose }: { onClose?: () => void }) {
  const [draft, setDraft] = useState<string>("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const current = getByokFalKey();
    setSaved(current);
    setDraft(current ?? "");
  }, []);

  const save = () => {
    const next = draft.trim();
    if (next) window.localStorage.setItem(BYOK_KEY, next);
    else window.localStorage.removeItem(BYOK_KEY);
    setSaved(next || null);
    onClose?.();
    window.location.reload(); // cheapest way to reseat the WS with the new key
  };

  const clear = () => {
    setDraft("");
    window.localStorage.removeItem(BYOK_KEY);
    setSaved(null);
    window.location.reload();
  };

  return (
    <div className="pointer-events-auto flex w-[340px] flex-col gap-3 border border-[color:var(--hairline)]/50 bg-[color:var(--ink)]/95 p-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono nums text-[10px] tracking-[0.2em] text-[color:var(--stone)]">
          SETTINGS
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
          fal.ai key (BYOK — free)
        </span>
        <Input
          type="password"
          value={draft}
          placeholder={saved ? "••••••••••" : "fal_…"}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="font-sans text-[10px] leading-relaxed text-[color:var(--stone)]/70">
          Paste your own fal.ai API key to bypass the credit gate — images
          are billed to your fal account, nothing is charged here. The key
          stays in your browser (localStorage) and is sent only to the
          visualizer server over the authenticated WebSocket.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="signal" size="sm" onClick={save}>
          save
        </Button>
        {saved ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            clear
          </Button>
        ) : null}
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            close
          </Button>
        ) : null}
      </div>
    </div>
  );
}
