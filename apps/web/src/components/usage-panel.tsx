"use client";

import { useCallback, useEffect, useState } from "react";

import { TopUpButton } from "@/components/top-up-button";
import { Button } from "@/components/ui/button";
import { rpcClient } from "@/lib/orpc";

interface BalanceResponse {
  frames: number;
  monthFrames: number;
  totalSpentUsd: number;
  lowBalance: boolean;
}

export function UsagePanel({ onClose }: { onClose?: () => void }) {
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const json = await rpcClient.credits.getBalance();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="pointer-events-auto flex w-[300px] flex-col gap-3 border border-[color:var(--hairline)]/50 bg-[color:var(--ink)]/95 p-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono nums text-[10px] tracking-[0.2em] text-[color:var(--stone)]">
          USAGE
        </span>
      </div>

      {loading ? (
        <span className="font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]/60">
          loading…
        </span>
      ) : data === null ? (
        <span className="font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]/60">
          unavailable
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          <Row label="frames" value={data.frames.toLocaleString()} />
          <Row
            label="frames / month"
            value={data.monthFrames.toLocaleString()}
          />
          <Row label="spent" value={`$${data.totalSpentUsd.toFixed(2)}`} />
          {data.lowBalance ? (
            <p className="mt-1 font-sans text-[10px] leading-relaxed text-[color:var(--signal)]">
              Low balance — top up to keep generating.
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-1 border-t border-[color:var(--hairline)]/30 pt-3">
        <TopUpButton onCredited={() => void load()} />
      </div>

      {onClose ? (
        <div className="mt-1 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            close
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--stone)]">
        {label}
      </span>
      <span className="font-mono nums text-[12px] text-[color:var(--paper)]">
        {value}
      </span>
    </div>
  );
}
