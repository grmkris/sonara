# USDC stage payments — design & rollout

Decision record + implementation map for charging USDC on the Monad stage.
Decided 2026-06-09: per-action on-chain payments; **nudge/set stay free and
gasless; prompts cost USDC** (base price + optional USDC tip); MON tips removed.

## Why this shape

The audience is anonymous — a localStorage burner key owning a Pimlico-sponsored
Safe smart account, no user row in the DB — so stage payments can't route through
the credits/frames ledger (frames belong to the logged-in host). The natural fit
is the contract itself pulling USDC per action and emitting the amount in the
event the server already listens to. Gas stays sponsored: the audience pays
USDC, never MON.

- **USDC on Monad is native Circle-issued**, 6 decimals, supports EIP-2612/3009.
  - Testnet (chain 10143): `0x534b2f3A21130d7a60830c2Df862319e593943A3`
  - Mainnet (chain 143): `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`
- **Circle faucet covers Monad testnet** (https://faucet.circle.com, 20 USDC per
  address every 2h, no account) — that's the audience funding path for demos.
- Free taps stay event-only (parallel-friendly); paid prompts serialize on the
  treasury's USDC balance slot, which is fine — prompts are low-frequency
  relative to taps.

## Pricing (deploy-time constants; redeploy to change)

- Prompt: **0.05 USDC** (`50_000` units) + optional tip (any amount, buys queue
  priority — the queue already sorts paid-first by tip).
- Tap: free. `0.001 USDC` is reserved as the future paid-boost price if we ever
  add one (not in this version).

## What changed

| Layer | Change |
| --- | --- |
| `packages/contracts/src/SonaraStage.sol` | constructor takes `(usdc, treasury, promptPriceUnits)`; `prompt(room, text, tipUnits)` pulls `price + tip` via `transferFrom` and emits `Prompt(room, who, text, paid, tip)`; nudge/set untouched |
| `packages/contracts/script/Deploy.s.sol` | env-driven: `USDC_ADDRESS` (defaults to testnet canonical), `STAGE_TREASURY` (defaults to deployer), `PROMPT_PRICE_UNITS` (defaults 50000) |
| `packages/onchain` | USDC constants + `parseUsdc`/`formatUsdc`; new ABI; `readStagePayment` / `readUsdcStatus` readers; both writers take `tipUnits` (USDC, not wei) and self-manage the one-time `approve(max)` (batched into the same UserOp on the gasless path) |
| `apps/server` | listener decodes `paid`/`tip`, accumulates per-room revenue in `stageState` (exposed via `control.stageSnapshot`); MCP `sonara_prompt` notes the price (agent EOA must hold testnet USDC) |
| `apps/web` | stage page: USDC balance chip, prompt priced in USDC, tip input in USDC, "fund your wallet" panel (smart-account address + QR + faucet link) when balance is short; host panel shows USDC raised |

No new env vars: the USDC address is hardcoded per chain in `packages/onchain`,
and the (re)deployed contract reuses `SONARA_STAGE_CONTRACT` /
`NEXT_PUBLIC_SONARA_STAGE_CONTRACT`.

## Rollout checklist

1. `forge test` in `packages/contracts`; `bun typecheck` at the root.
2. Deploy: `forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet
   --private-key $DEPLOYER_KEY --broadcast` (treasury defaults to deployer).
3. Update `SONARA_STAGE_CONTRACT` (server) + `NEXT_PUBLIC_SONARA_STAGE_CONTRACT`
   (web build arg) in Railway dev env; push `dev`.
4. **Pimlico dashboard**: if the sponsorship policy restricts callable contract
   targets, add the new stage address AND the testnet USDC address (the first
   prompt batches an `approve` call to USDC into the sponsored UserOp).
5. Fund test wallets: audience smart-account address via faucet.circle.com;
   the MCP agent EOA needs USDC too if agents should be able to prompt.
6. Smoke on dev.sonara.fm: open stage → tap (free) → prompt (fails with "fund"
   panel) → faucet → prompt (approve+pay, one sponsored UserOp) → tip jump.

## Later / out of scope

- Paid taps ("boost"): add a `boost()` function at the reserved 0.001 price.
- USDC → frames top-up for logged-in hosts (the `usage_ledger.chain_id` /
  `tx_hash` columns are already prepared for it) — separate feature.
- Mainnet: chain 143 def + mainnet USDC const exist in `packages/onchain`;
  everything else is env/deploy work.
