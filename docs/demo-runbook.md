# Monad hackathon — demo runbook

The pitch in one line: **a live AI visual stage the whole room drives through
Monad transactions — every tap is a real on-chain tx, gasless, visible on the
wire within a second.**

## Props

- **Projector / big screen** — `dev.sonara.fm/play` (or prod), signed in,
  fullscreen (`f`), chrome hidden (`h`). Bring audio (share a tab / mic) so
  the canvas is alive before the chain part starts.
- **Host phone** — same account, `dev.sonara.fm/control` (the operator remote).
- **Audience phones** — the judges' own devices. Nothing to install.

## Preflight (5 min before)

1. Railway env has `SONARA_STAGE_CONTRACT` / `NEXT_PUBLIC_SONARA_STAGE_CONTRACT`
   (Monad testnet, USDC-paid prompts) + `MCP_AGENT_KEY` (funded EOA) +
   Pimlico keys. Faucet treasury holds USDC for airdrops.
2. Open `/play`, go live with a prompt so visuals are generating.
3. On `/control`: confirm the session preview is moving.
4. Optional: have Claude Code connected to `https://<host>/api/mcp` for the
   AI-VJ beat.

## The arc (~4 min)

1. **Open the stage** — on `/control`, tap **open to crowd**. The projector
   grows the wire overlay AND a **join QR card** (bottom-right, room code +
   short URL). Talking point: *the QR defaults on so the room fills; it's a
   real capability — no accounts, no wallets.*
2. **Judges scan and tap** — each phone silently mints a burner → Safe smart
   account, **gasless via Pimlico**. Knob taps (weirder/softer/…) are free
   on-chain txs. Point at the projector: **tx ticker prints every action**
   (teletype lines, sender glyphs), the **block odometer rolls every ~400ms**,
   the **seismograph spikes** as taps land. Beat: *"everyone tap at once"* —
   no congestion, no failed txs, visuals lurch live.
3. **The latency receipt** — on any audience phone: the chip reads
   **"tap → on-chain · 0.6s"** and links to the Monad explorer. Talking
   point: *that's send → bundler → block → our listener → your screen,
   measured, not claimed.* (E2E harness measured 1.17s for two txs incl.
   signing.)
4. **Paid prompts** — audience taps the **1 USDC airdrop** (house faucet),
   sends a scene for **0.05 USDC**; a tip jumps the queue — the ticker prints
   it in red, the queue reorders, and when it takes the screen the projector
   credits **"sent by ⟨glyph⟩ 0x12…34 · +0.5 USDC"**. Talking point: *value
   transfer = queue priority, enforced by the contract (`paid`/`tip` events).*
5. **The AI VJ** — from Claude Code, call the MCP tools
   (`sonara_snapshot` / `sonara_nudge` / `sonara_prompt` with the room code).
   Its txs print on the same wire tagged **· agent**. Talking point: *humans
   and an AI driving one stage through the same contract — the chain is the
   API.*
6. **Clean finish** — on `/control`, toggle **join qr on display → hidden**
   for a clean canvas, let the visuals breathe, then **close** (watchers get
   a `closed` frame; the room tears down).

## Architecture one-breath (if asked)

Event-only `SonaraStage` contract (parallel-execution friendly — nothing
serializes); server holds a WSS subscription and folds events into the live
session (200ms coalescing, tip-priority prompt queue, 12s dwell); a public
`/ws/stage` socket fans the decoded feed out over Bun pub/sub to projector,
phones, and host panel. Audience = burner key → Safe AA → Pimlico sponsorship.
Prompts pull USDC (base + tip) via the contract.

## Failure fallbacks

- **Projector reconnects mid-show** → it relearns room + QR state from
  `stage.status` on reconnect; the audience feed self-reconnects (seq-deduped).
- **A push/deploy lands mid-demo** → the container restarts and the live
  session dies: don't ship during the demo (freeze `dev` for the slot).
- **Faucet dry / cooldown** → knob taps still carry the whole speed story;
  prompts are the garnish.
- **Pimlico hiccup (phones can't link)** → drive from the MCP agent path
  (server-held EOA) — same contract, same wire.
- **Room code lost** → `/control` shows it; re-opening the stage for the same
  session returns the SAME code (binding survives by liveSessionId).
