# Monad showcase — "the wire" plan

Goal: make Monad's speed *visible and felt* in the demo. Today the entire
on-chain layer (400ms blocks, gasless UserOps, event-driven contract) is
rendered as one number polled every 1.5s. The server already hears every
contract event in near-real-time with full data (`who`, action, values, and
viem hands us `transactionHash` + `blockNumber` on every log) — we just throw
it away. This plan surfaces it on all three surfaces with a push transport.

Design direction: **teleprinter / wire-service**. The chain layer renders as
newsroom hardware — monospace ticker lines that "print" in (teletype clip
reveal), a stamped block-number odometer, a hairline ink-trace seismograph.
Coherent with sonara's paper/ink editorial language; `--signal` rust-red
accents reserved for tips and bursts. No neon, no Grafana.

## Phase 1 — server: activity feed (the data spine)

New `apps/server/src/onchain/stage-activity.ts`:

- Per-room **ring buffer** (last ~64) of decoded activity events:
  ```ts
  interface StageActivityEvent {
    seq: number;                 // per-room monotonic cursor
    kind: "nudge" | "set" | "prompt";
    who: Address;                // smart account (audience) or agent EOA
    agent: boolean;              // who === MCP agent address
    knob?: StageKnob; delta?: number; value?: number;   // nudge/set
    text?: string; tip?: string;                        // prompt (tip = wei string)
    txHash: Hex;
    blockNumber: number;
    serverTs: number;            // when the listener heard it
  }
  ```
- `publish(room, event)` / `recent(room, sinceSeq)` and a Bun pub/sub fanout:
  publish JSON to topic `stage:{room}` via `server.publish()`. (Bun.serve has
  native topic pub/sub — `ws.subscribe()` / `server.publish()` — zero extra infra.)

Changes to `stage-listener.ts`:

- The three `watchContractEvent` handlers currently destructure only `{ args }`
  (stage-listener.ts:160,179,197). Also take `log.transactionHash` and
  `log.blockNumber`, build a `StageActivityEvent`, publish it. Note: Nudge/Set
  logs already carry `who` (indexed in the ABI) — it's just unused today.
- Add `client.watchBlockNumber` on the same WSS client → publish
  `{ type: "block", number }` to a global `stage:blocks` topic. This is the
  block heartbeat: it ticks ~2.5×/sec even when the room is idle.
- Agent tagging: compute the MCP agent address once at boot
  (`privateKeyToAccount(MCP_AGENT_KEY).address` when configured), mark matching
  events `agent: true`.

## Phase 2 — server: public per-room WebSocket

New endpoint in `Bun.serve.fetch` (apps/server/src/server.ts:139): handle
`/ws/stage?room=XXXXX` **before** the `/ws` branch.

- **No auth ticket** — the room code is the capability, exactly like the
  existing public `control.stageSnapshot`. Reject unknown/closed rooms (404).
- `ws.data` gets a discriminator (`kind: "session" | "stage"`); the existing
  `open`/`message`/`close` hooks branch on it. Stage sockets:
  - on open: `ws.subscribe("stage:" + room)` + `ws.subscribe("stage:blocks")`,
    then send a hello frame: current `stageSnapshot` + `recent(room)` backlog
    so the ticker is never empty on join.
  - ignore client messages (read-only feed).
- Server pushes (one discriminated JSON union, typed in `packages/shared`):
  - `{ type: "activity", event: StageActivityEvent }`
  - `{ type: "block", number }`
  - `{ type: "queue", nowPlaying, upNext }` (published when the queue changes —
    `setQueue` callsites in stage-listener.ts:82,145)
  - `{ type: "count", txCount }`
- Gateway: add `/ws/stage` to the `@server` path matcher
  (apps/gateway/Caddyfile:10).

Projector room discovery: `/play` doesn't know the room code (the host opens
the stage from `/control`). Add a tiny `stage.status` member to the
`ServerEvent` union (`packages/shared/src/events.ts:99`):
`{ type: "stage.status", room: string | null }`, emitted to the session when
`openStage`/`closeStage` run (control.router.ts:166-183 — the router already
resolves the session from the registry there; add a `notifyStage` method to
`ControllableSession`). The projector then dials `/ws/stage?room=…` itself —
same feed as everyone else, no session-protocol bloat.

## Phase 3 — web: the teleprinter kit

New `apps/web/src/lib/stage/use-stage-feed.ts` — partysocket (already a dep)
ReconnectingWebSocket to `/ws/stage?room=…`; exposes `{ activity[], block,
txCount, queue, eventsPerSec }`. Replaces stageSnapshot polling wherever it
connects.

New components under `apps/web/src/components/stage/` (all monospace,
hairline borders, paper-on-ink — match globals.css tokens):

- **`TxTicker`** — last N activity lines, newest prints in with a teletype
  clip-reveal (CSS only, honors `prefers-reduced-motion`). Line format:
  `◆ 0x3f…a2c  weirder +0.12   #18,442,107`. Tips render in `--signal` red
  with the MON amount; agent lines get an `agent` tag.
- **`BlockPulse`** — live block-number odometer (digits roll), with a 1px
  hairline that flashes on each block (~400ms). Caption: `monad · ~400ms blocks`.
- **`Seismograph`** — thin canvas strip, events-per-second as an ink trace;
  bursts spike, idle is a flat hairline. Drives the "everyone tap now" beat.
- **`AddressGlyph`** — deterministic mini-identicon (hue + 2-glyph mark
  derived from address) so repeat participants become recognizable characters.

## Phase 4 — surfaces

**Projector (`/play`)** — the judges' screen, highest priority:
- Bottom-left vertical `TxTicker` (≈6 lines, fades upward into the canvas).
- `BlockPulse` small, near the wordmark.
- `Seismograph` as a thin strip above the audio ribbon.
- "now playing — sent by ⟨glyph⟩ 0x12…34 (+0.5 MON)" credit when a queued
  prompt takes the screen (data already in `PromptView.who`/`tip`).
- All of it respects the existing hide-UI toggle (`h`) and z-layers; mounts
  only when a `stage.status` room is live.

**Audience (`/stage/[room]`)**:
- Swap 1.5s polling for `useStageFeed` (page.tsx:73-97).
- **Latency chip**: stamp `t0` on every send; when the feed delivers an
  activity event with `who === writer.address`, show `your tap hit the chain
  in 0.61s`. Honest label "tap → on-chain": the UserOp path includes Pimlico
  bundler time, so this measures the real end-to-end, not just block time —
  the block heartbeat carries the raw-chain-speed story regardless.
- Own txs link to the explorer: `https://testnet.monadexplorer.com/tx/{hash}`.
- Up-next gets attribution: glyph + `0x12…34`, tip shown in MON (replaces 💰).
- `BlockPulse` in the header next to "gasless · linked".

**Host panel (`/control`, stage-host-panel.tsx)**:
- Compact `TxTicker` (last ~5) + `Seismograph` + per-kind counts
  (`128 nudges · 12 sets · 9 prompts`) replacing the bare counter.

## Stretch

- Session leaderboard (top tippers / most active) — data is already in the
  ring buffer + queue; render as a toggleable overlay on the projector.

## Notes / constraints

- Everything stays in-memory per-room (same rationale as stageRooms /
  stageState) — no DB, no migrations.
- `NEXT_PUBLIC_SONARA_STAGE_CONTRACT` continues to gate all stage UI.
- Test on dev.sonara.fm per dev-flow (push `dev`, fast static checks only
  locally). The contract + Pimlico envs must be set in the dev environment.
- Demo script beat: open stage → crowd taps (seismograph spikes, ticker
  waterfalls) → someone tips (red line, jumps queue) → Claude agent joins via
  MCP (tagged lines) → point at the block odometer the whole time.
