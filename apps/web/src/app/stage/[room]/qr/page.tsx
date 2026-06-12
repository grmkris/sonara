"use client";

import { Printer } from "lucide-react";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { rpcClient } from "@/lib/orpc";

// /stage/<code>/qr — the printable placard: stage name, a big crowd-join QR,
// the permanent code, the short URL. Deliberately PUBLIC (no ownership gate):
// it encodes nothing but the public crowd URL — anyone holding the code
// already has crowd access, and gating would break the obvious use case
// (venue staff printing it from a random machine). resolveStage is only
// called for the name + a clear notice on unknown codes. Print variants flip
// the page to paper-white; the QR sits on white in both modes.

type Gate =
  | { kind: "checking" }
  | { kind: "not-found" }
  | { kind: "ok"; name: string };

export default function StageQrPage() {
  const params = useParams<{ room: string }>();
  const code = params.room.toUpperCase();
  const [gate, setGate] = useState<Gate>({ kind: "checking" });
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { stage } = await rpcClient.control.resolveStage({ code });
        if (cancelled) {
          return;
        }
        setGate(
          stage ? { kind: "ok", name: stage.name } : { kind: "not-found" }
        );
      } catch {
        if (!cancelled) {
          setGate({ kind: "not-found" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (gate.kind !== "ok") {
      return;
    }
    const joinUrl = `${window.location.origin}/stage/${code}`;
    setUrl(joinUrl);
    let cancelled = false;
    void (async () => {
      const data = await QRCode.toDataURL(joinUrl, { margin: 1, width: 960 });
      if (!cancelled) {
        setQr(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gate.kind, code]);

  if (gate.kind === "checking") {
    return <main className="min-h-svh bg-[color:var(--ink)] print:bg-white" />;
  }

  if (gate.kind === "not-found") {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center bg-[color:var(--ink)] px-6 text-center text-[color:var(--paper)] print:bg-white print:text-black">
        <p className="font-serif text-[16px] italic text-[color:var(--paper)]/85 print:text-black">
          no stage answers to “{code}”.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-[color:var(--ink)] px-6 py-10 text-[color:var(--paper)] print:bg-white print:text-black">
      <p className="font-serif text-[clamp(20px,3.5vw,32px)] italic text-[color:var(--paper)]/90 print:text-black">
        {gate.name}
      </p>
      <p className="font-sans text-[11px] uppercase tracking-[0.3em] text-[color:var(--stone)] print:text-black">
        scan to drive the visuals
      </p>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`scan to join stage ${code}`}
          className="w-full max-w-[420px] rounded-sm border border-[color:var(--hairline)]/40 bg-white p-3 print:border-black/20"
          src={qr}
        />
      )}
      <p className="font-mono text-[clamp(36px,8vw,64px)] uppercase tracking-[0.3em] text-[color:var(--paper)] print:text-black">
        {code}
      </p>
      <p className="font-mono text-[13px] lowercase tracking-[0.12em] text-[color:var(--stone)] print:text-black">
        {url.replace(/^https?:\/\//u, "")}
      </p>
      <button
        type="button"
        onClick={() => window.print()}
        className="focus-ring mt-2 flex items-center gap-2 border border-[color:var(--paper)]/40 px-4 py-2 font-sans text-[10px] uppercase tracking-[0.24em] text-[color:var(--paper)]/85 transition-colors hover:bg-[color:var(--paper)] hover:text-[color:var(--ink)] print:hidden"
      >
        <Printer className="size-3.5" strokeWidth={1.5} />
        print
      </button>
    </main>
  );
}
