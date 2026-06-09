/** biome-ignore-all assist/source/organizeImports: throwaway E2E script */
// E2E verification of the Monad stage wire on a deployed environment.
// NOT committed — run manually:
//   MCP_AGENT_KEY=0x… SONARA_STAGE_CONTRACT=0x… bun scripts/e2e-stage-wire.ts
//
// Flow: throwaway signup → live session WS (simulated projector) → openStage
// → /ws/stage feed asserts (hello, block heartbeat) → real on-chain txs via
// the agent EOA → activity/count asserts + latency → closeStage → closed.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createEoaStageWriter, readStagePayment, readUsdcStatus } from "@sonara/onchain";
import { typeIdGenerator } from "@sonara/shared/typeid";

const BASE = process.env.E2E_BASE ?? "https://dev.sonara.fm";
const WS_BASE = BASE.replace(/^http/u, "ws");
const AGENT_KEY = process.env.MCP_AGENT_KEY as `0x${string}` | undefined;
const CONTRACT = process.env.SONARA_STAGE_CONTRACT as `0x${string}` | undefined;

if (!(AGENT_KEY && CONTRACT)) {
  console.error("need MCP_AGENT_KEY + SONARA_STAGE_CONTRACT env");
  process.exit(1);
}

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ detail, name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- 1. throwaway account ------------------------------------------------
const email = `e2e-wire-${Date.now()}@example.com`;
const signupRes = await fetch(`${BASE}/api/auth/sign-up/email`, {
  body: JSON.stringify({ email, name: "e2e wire", password: "wire-e2e-passw0rd!" }),
  headers: { "content-type": "application/json" },
  method: "POST",
});
const cookies = signupRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
check("signup + session cookie", signupRes.ok && cookies.length > 0, email);

// biome-ignore lint/suspicious/noExplicitAny: untyped throwaway client
const rpc: any = createORPCClient(
  new RPCLink({ headers: { cookie: cookies }, url: `${BASE}/rpc` })
);

// --- 2. simulated projector session over /ws ------------------------------
const { token } = await rpc.auth.mintWsTicket();
const liveSessionId = typeIdGenerator("liveSession");
const sessionWs = new WebSocket(
  `${WS_BASE}/ws?token=${encodeURIComponent(token)}&sessionId=e2e-wire&liveSessionId=${liveSessionId}`
);
await new Promise<void>((resolve, reject) => {
  sessionWs.onopen = () => resolve();
  sessionWs.onerror = (e) => reject(new Error(`session ws failed: ${e}`));
});
check("projector session ws open", true, liveSessionId);
await sleep(500);

// --- 3. open the stage -----------------------------------------------------
const { room } = await rpc.control.openStage({ allowPrompts: true, liveSessionId });
check("openStage minted room", typeof room === "string" && room.length === 5, room);

// --- 4. stage feed: hello + block heartbeat --------------------------------
// biome-ignore lint/suspicious/noExplicitAny: wire messages
const feed: any[] = [];
const feedWs = new WebSocket(`${WS_BASE}/ws/stage?room=${room}`);
feedWs.onmessage = (ev) => {
  try {
    feed.push(JSON.parse(String(ev.data)));
  } catch {
    /* ignore */
  }
};
await new Promise<void>((resolve, reject) => {
  feedWs.onopen = () => resolve();
  feedWs.onerror = () => reject(new Error("feed ws failed"));
});
await sleep(3000);
const hello = feed.find((m) => m.type === "hello");
check("feed hello frame", !!hello, hello ? `txCount=${hello.txCount} room=${hello.room}` : "missing");
const blocks = feed.filter((m) => m.type === "block");
check(
  "block heartbeat ~400ms",
  blocks.length >= 4,
  `${blocks.length} blocks in 3s (latest #${blocks.at(-1)?.number ?? "?"})`
);

// --- 5. real on-chain txs via the agent EOA --------------------------------
const writer = createEoaStageWriter({ contract: CONTRACT, privateKey: AGENT_KEY });
const t0 = Date.now();
const nudgeHash = await writer.nudge(room, "surrealness", 0.12);
const setHash = await writer.set(room, "intensity", 0.61);
console.log(`  sent nudge ${nudgeHash.slice(0, 14)}… set ${setHash.slice(0, 14)}…`);

// wait up to 15s for both activity events
let activity: any[] = [];
for (let i = 0; i < 30; i += 1) {
  await sleep(500);
  activity = feed.filter((m) => m.type === "activity");
  if (activity.length >= 2) {
    break;
  }
}
const latencyMs = Date.now() - t0;
const kinds = activity.map((a) => a.event.kind).sort();
check("activity events arrived", activity.length >= 2, `${activity.length} events, kinds=[${kinds}] in ${latencyMs}ms`);
const first = activity[0]?.event;
check(
  "activity carries txHash/block/agent",
  !!first && /^0x[0-9a-f]{64}$/iu.test(first.txHash) && first.blockNumber > 0 && first.agent === true,
  first ? `tx=${first.txHash.slice(0, 14)}… blk=${first.blockNumber} agent=${first.agent}` : "missing"
);
const counts = feed.filter((m) => m.type === "count");
check("count frames", counts.length >= 2, `latest txCount=${counts.at(-1)?.txCount}`);

// --- 6. paid prompt (only if the agent EOA holds USDC) ----------------------
try {
  const payment = await readStagePayment({ contract: CONTRACT });
  const { balanceUnits } = await readUsdcStatus({
    owner: writer.address,
    spender: CONTRACT,
    usdc: payment.usdc,
  });
  if (balanceUnits >= payment.promptPriceUnits) {
    const promptHash = await writer.prompt(room, `e2e wire check ${Date.now() % 10_000}`);
    console.log(`  sent prompt ${promptHash.slice(0, 14)}…`);
    let queueMsg = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(500);
      queueMsg = feed.find((m) => m.type === "queue");
      if (queueMsg) {
        break;
      }
    }
    check("paid prompt → queue frame", !!queueMsg, queueMsg ? `nowPlaying=${queueMsg.queue.nowPlaying?.text?.slice(0, 24)}` : "missing");
  } else {
    check("paid prompt", true, `skipped — agent USDC ${balanceUnits} < price ${payment.promptPriceUnits}`);
  }
} catch (error) {
  check("paid prompt", false, `errored: ${error instanceof Error ? error.message : error}`);
}

// --- 7. closeStage → closed frame -------------------------------------------
await rpc.control.closeStage({ liveSessionId });
await sleep(1500);
check("closed frame on closeStage", feed.some((m) => m.type === "closed"));

// --- 8. negative probe -------------------------------------------------------
const badRes = await fetch(`${BASE.replace(/^ws/u, "http")}/ws/stage?room=ZZZZZ`, {
  headers: { connection: "upgrade", upgrade: "websocket" },
});
check("unknown room rejected", badRes.status === 404, `status=${badRes.status}`);

sessionWs.close();
feedWs.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
