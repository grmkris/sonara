/**
 * Raw per-frame latency benchmark for the A/B text models.
 *
 * Measures the SERVER↔fal round-trip per frame — NOT the UI update rate. The
 * studio's visible cadence is governed separately by the session
 * (cadenceFromIntensity: periodicMs 8–16s, pauseMs 400–1500ms, + semantic-diff
 * gating), so a model can generate in 200ms yet the canvas only swaps every few
 * seconds. This script isolates the model speed from that cadence.
 *
 * Realtime models (lightning-sdxl, lcm) stream over a warm websocket — the
 * first frame pays the connection/auth cold-start, the rest are warm. The queue
 * model (klein) goes through fal.subscribe every time.
 *
 * Run:  cd apps/server && bun scripts/bench-models.ts
 *       (FAL_KEY is read from apps/server/.env via bun's autoload)
 */
import { createFalClient } from "@fal-ai/client";
import { TEXT_MODELS, TEXT_MODEL_KEYS } from "@sonara/shared";

const ITER = 6;
const SIZE = { height: 512, width: 512 };
const PROMPT = "a red koi fish, sumi-e ink wash, soft ambient light";

// Inline copy of the cached token provider (apps/server/src/generation/
// fal-token.ts) so this script stays standalone (no env-validation import) but
// measures the SAME warm-connection mechanism the server now uses.
const tokenCache = new Map<string, { token: string; at: number }>();
const benchTokenProvider = async (app: string): Promise<string> => {
  const parts = app.split("/").filter((p) => p.length > 0);
  const alias = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : app;
  const hit = tokenCache.get(alias);
  if (hit && performance.now() - hit.at < 100_000) {
    return hit.token;
  }
  const res = await fetch("https://rest.fal.ai/tokens/", {
    body: JSON.stringify({ allowed_apps: [alias], token_expiration: 120 }),
    headers: {
      Accept: "application/json",
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const data: unknown = await res.json();
  const token =
    typeof data === "string"
      ? data
      : (data as { detail?: string })?.detail ?? "";
  tokenCache.set(alias, { at: performance.now(), token });
  return token;
};

interface Sample {
  ms: number;
  ok: boolean;
  kind: string;
}

// Mirror the server's extractUrl: a CDN url, or inline bytes → renderable.
const renderable = (result: unknown): { ok: boolean; kind: string } => {
  const r = result as {
    image?: { url?: string; content?: unknown };
    images?: { url?: string; content?: unknown }[];
  };
  const img = r.image ?? r.images?.[0];
  if (!img) {
    return { kind: "no-image", ok: false };
  }
  if (typeof img.url === "string" && img.url.length > 0) {
    return { kind: "url", ok: true };
  }
  const c = img.content as { data?: unknown } | undefined;
  const hasBytes =
    c instanceof Uint8Array ||
    Array.isArray(c) ||
    (typeof c === "object" && c !== null && "data" in c);
  if (hasBytes) {
    return { kind: "bytes→dataURI", ok: true };
  }
  return { kind: `unknown(${Object.keys(img).join(",")})`, ok: false };
};

const benchRealtime = (
  falId: string,
  steps: number,
  guidanceScale?: number
): Promise<{ samples: Sample[]; errors: string[] }> =>
  // oxlint-disable-next-line promise/avoid-new -- REVIEW: bridging the fal realtime onResult/onError callback API into a promise needs the explicit constructor
  new Promise((resolve) => {
    const client = createFalClient({ credentials: process.env.FAL_KEY });
    const samples: Sample[] = [];
    const errors: string[] = [];
    let i = 0;
    let t0 = 0;
    let done = false;

    // oxlint-disable-next-line prefer-const -- assigned after connect() so onResult can reference it
    let conn: ReturnType<typeof client.realtime.connect>;

    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      try {
        conn.close();
      } catch {
        /* noop */
      }
      resolve({ errors, samples });
    };

    const sendNext = () => {
      if (i >= ITER) {
        finish();
        return;
      }
      t0 = performance.now();
      const payload: Record<string, unknown> = {
        enable_safety_checker: false,
        format: "jpeg",
        image_size: SIZE,
        num_images: 1,
        num_inference_steps: steps,
        prompt: `${PROMPT} #${i}`,
        request_id: `b${i}`,
        sync_mode: false,
      };
      if (typeof guidanceScale === "number") {
        payload.guidance_scale = guidanceScale;
      }
      conn.send(payload);
    };

    conn = client.realtime.connect(falId, {
      connectionKey: falId,
      onError: (error: unknown) => {
        errors.push((error as { message?: string })?.message ?? String(error));
        i += 1;
        sendNext();
      },
      onResult: (r: unknown) => {
        const ms = Math.round(performance.now() - t0);
        const rend = renderable(r);
        samples.push({ kind: rend.kind, ms, ok: rend.ok });
        i += 1;
        sendNext();
      },
      throttleInterval: 0,
      tokenExpirationSeconds: 120,
      tokenProvider: benchTokenProvider,
    });
    sendNext();
    setTimeout(finish, 90_000);
  });

const benchQueue = async (
  falId: string,
  steps: number
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const client = createFalClient({ credentials: process.env.FAL_KEY });
  const samples: Sample[] = [];
  const errors: string[] = [];
  for (let i = 0; i < ITER; i += 1) {
    const t0 = performance.now();
    try {
      const res = await client.subscribe(falId, {
        input: {
          enable_safety_checker: false,
          image_size: SIZE,
          num_images: 1,
          num_inference_steps: steps,
          output_format: "jpeg",
          prompt: `${PROMPT} #${i}`,
        },
        logs: false,
      });
      const ms = Math.round(performance.now() - t0);
      const rend = renderable((res as { data?: unknown }).data);
      samples.push({ kind: rend.kind, ms, ok: rend.ok });
    } catch (error) {
      errors.push((error as { message?: string })?.message ?? String(error));
    }
  }
  return { errors, samples };
};

const summarize = (label: string, transport: string, samples: Sample[]) => {
  if (samples.length === 0) {
    process.stdout.write(`  ${label} (${transport}): NO SAMPLES\n`);
    return;
  }
  const [cold] = samples;
  const warm = samples.slice(1).filter((s) => s.ok);
  const warmAvg =
    warm.length > 0
      ? Math.round(warm.reduce((a, s) => a + s.ms, 0) / warm.length)
      : null;
  const warmMin = warm.length > 0 ? Math.min(...warm.map((s) => s.ms)) : null;
  const okCount = samples.filter((s) => s.ok).length;
  process.stdout.write(
    `  ${label.padEnd(16)} ${transport.padEnd(9)} cold=${String(cold.ms).padStart(5)}ms  warm avg=${
      warmAvg === null ? "  n/a" : `${String(warmAvg).padStart(4)}ms`
    }  warm min=${warmMin === null ? " n/a" : `${String(warmMin).padStart(4)}ms`}  ok=${okCount}/${samples.length}  [${cold.kind}]\n`
  );
  process.stdout.write(
    `       per-frame ms: ${samples.map((s) => `${s.ms}${s.ok ? "" : "✗"}`).join("  ")}\n`
  );
};

const main = async () => {
  if (!process.env.FAL_KEY || process.env.FAL_KEY.startsWith("placeholder")) {
    process.stdout.write("FAL_KEY missing/placeholder — aborting\n");
    process.exit(1);
  }
  process.stdout.write(
    `\n=== model latency benchmark (${ITER} frames each, ${SIZE.width}²) ===\n`
  );
  process.stdout.write("(raw fal round-trip — NOT the UI cadence)\n\n");

  for (const key of TEXT_MODEL_KEYS) {
    const cfg = TEXT_MODELS[key];
    const { samples, errors } =
      cfg.transport === "realtime"
        ? await benchRealtime(cfg.falId, cfg.steps, cfg.guidanceScale)
        : await benchQueue(cfg.falId, cfg.steps);
    summarize(cfg.label, cfg.transport, samples);
    if (errors.length > 0) {
      process.stdout.write(
        `       ERRORS (${errors.length}): ${errors.slice(0, 3).join(" | ")}\n`
      );
    }
    process.stdout.write("\n");
  }
  process.exit(0);
};

void main();
