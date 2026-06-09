# Sonara — Testing Plan

> Drafted 2026-06-09 from a full entrypoint/page/flow map (web + server + e2e journeys).
> Two parts: **A. Manual QA script** (run now on dev) and **B. Automated test backlog**
> (prioritized). Covers all flows incl. stage/onchain.

## Scope & state

What's where as of this writing:
- **On `origin/dev` (dev.sonara.fm) now:** reels + studio + play + control + credits.
- **Committed locally, unpushed:** durable sessions (de-fragmentation).
- **Uncommitted (`feat/monad-stage`):** model picker + realtime provider + stage/onchain.

The plan assumes the **consolidated dev** (everything merged + pushed). Items needing durable
sessions (L3) or stage (L7) only become testable after the merge + the stage env is set.

## Prerequisites

- **Accounts:** one signed-in test account **with credits**; a way to reach **0 credits** (spend down, or a 2nd fresh account); an **incognito** window for anon.
- **Audio:** a track to play (tab-share or file) + a mic — generation + reactivity need real audio.
- **Two surfaces** for control + stage: a "projector" (`/play` on laptop) + a "phone" (`/control`, and a separate device/incognito for `/stage`).
- **Stage (L7) only:** `SonaraStage.sol` deployed to **Monad testnet** (chain 10143) + `SONARA_STAGE_CONTRACT` (server) and `NEXT_PUBLIC_SONARA_STAGE_CONTRACT` (web) set on the dev environment; `PIMLICO_API_KEY` set (sponsors gas). A burner is auto-created per device. **Tips** (MON `msg.value`) require the burner's smart account to **hold MON** — gasless covers *gas*, not the *tip value*; zero-tip nudges/prompts are fully free.
- **Tools to watch:** `railway logs --service server`, browser devtools Network (to confirm fal calls fire / don't), the `/studio` timeline (to confirm persistence).

---

# Part A — Manual QA script

Run signed-in on dev.sonara.fm unless noted. ✅ = expected.

## L0 — Build / boot / smoke (after each deploy)
- [ ] `railway logs --service server` shows `migrations applied` + `server listening`, no errors.
- [ ] `curl -XPOST https://dev.sonara.fm/rpc/healthCheck -d '{}' -H 'content-type: application/json'` → ✅ `{"json":"OK"}`.
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://dev.sonara.fm/studio` → ✅ `200`.
- [ ] `reels.list` unauth → ✅ `401 UNAUTHORIZED` (route mounted + gated).
- [ ] Every page loads without a blocking console error: `/`, `/play`, `/studio`, `/control`, `/login`, `/about`, `/credits/success`.

## L1 — Auth gating
- [ ] Anon `/studio` → ✅ AnonCta (links `/login?next=/studio`, `/play`).
- [ ] Anon `/control` → ✅ sign-in shell (`/login?next=/control`).
- [ ] `/stage/<anyroom>` anon → ✅ loads (public; burner created), no sign-in wall.
- [ ] `/login?next=https://evil.com` → after sign-in ✅ lands on `/play` (external next rejected); `?next=/studio` ✅ lands on `/studio`.
- [ ] Sign out while on `/play` → ✅ in-memory library cleared (no flash of prior user's frames).

## L2 — Live generation pipeline (core)
**Anon demo (incognito):**
- [ ] Landing → `/play`: ✅ demo loop animates a deck; canvas **dimmed** until audio.
- [ ] Switch decks (DeckPicker) → ✅ new deck frames cycle.
- [ ] Connect audio (mic/tab) → ✅ canvas brightens + reacts to beat; Network shows **no fal calls** (demo is client-only, zero cost).
- [ ] No `PromptInput` (only the sign-in nudge); `RemoteLink` absent.

**Signed-in go-live:**
- [ ] Type a scene → Enter → ✅ a frame generates + crossfades in; `job.status` running→idle.
- [ ] With audio playing, leave it idle → ✅ periodic/section triggers keep producing frames on cadence.
- [ ] **Model picker A/B:** switch to a **realtime** model (lightning-sdxl/lcm) → ✅ sub-second frames; switch to **queue** (klein-9b) → ✅ slower but higher quality. Resolution 512 vs 768 → ✅ visibly different sharpness/speed.
- [ ] **Anchor mode:** upload an image (ImageAnchorZone) → ✅ subsequent frames follow it; remove → back to text.
- [ ] From `/studio`, **use as anchor** / **reseed** → ✅ `/play` adopts it then clears the URL param.

**Credit gate:**
- [ ] With balance: each frame ✅ decrements balance (UsagePanel); `usage_ledger` grows.
- [ ] At 0 balance: first ~3 frames/hour ✅ still generate (free-tier); then ✅ "out of credits" toast.
- [ ] Out-of-credits **auto**-triggers ✅ don't spam the toast (60s cooldown); a **typed** prompt ✅ always toasts.

**Edges:**
- [ ] Reset (`⌫`) ✅ stops generation, clears scene.
- [ ] Force a fal failure (if possible) → ✅ paid frame refunded (balance restored); UI doesn't hang.

## L3 — Durable-session de-fragmentation (the gate proof)
- [ ] Go live, generate ~3 frames. Kill Wi-Fi / background the tab to force a WS reconnect; generate ~3 more. Open `/studio` → ✅ **one** session, not two.
- [ ] Push a deploy (server restart) mid-session; reconnect; generate → ✅ still **one** session.
- [ ] Click **new session** → next frames ✅ group under a **new** `/studio` session entry.

## L4 — Reels CRUD + replay (+ regression)
- [ ] Create a reel (inline "new"). ✅ appears in the reels tab.
- [ ] From a session frame's inspector → **add to reel** (and **create-and-add**) → ✅ frame in the reel; toast.
- [ ] Reorder (◀/▶), remove, set cover, rename, delete → ✅ each persists across reload; delete confirms + removes.
- [ ] **Replay reel** (`/play?reel=`) → ✅ crossfades in order, fixed cadence; **exit playback** → ✅ returns to normal.
- [ ] **Replay session** (`/play?session=`) → ✅ plays on original timing.
- [ ] **Regression (post-monad-merge):** switch the **model picker**, then replay a reel → ✅ no conflict (model + reel-playback slices coexist).
- [ ] New-user state: example-session frames ✅ show **no** "add to reel" button.

## L5 — Operator control
- [ ] Projector on `/play` (signed-in), open `/control` on phone (same account) → ✅ session discovered; preview card shows last frame + status.
- [ ] Drive prompt/deck/intensity/sliders on `/control` → ✅ projector reacts within ~1–2s.
- [ ] Let the cookie expire / sign out elsewhere → ✅ `/control` shows re-sign-in (not a stale list).
- [ ] Open two `/play` tabs → ✅ `/control` shows a session switcher; closing one ✅ rebinds.

## L6 — Credits / billing
- [ ] Top-up → ✅ redirected to Dodo hosted checkout; pay (test mode) → ✅ `/credits/success` polls then shows credited → `/play`; balance increased.
- [ ] Observe server logs: webhook `credited`; re-deliver (if testable) → ✅ `idempotent replay`, no double-credit.

## L7 — Stage / onchain (Monad) — requires contract + env
- [ ] `/control` → **open to crowd** → ✅ room code + QR + live `txCount` poll.
- [ ] Audience opens `/stage/<room>` (separate device, no sign-in) → ✅ loads; burner key created; controls enabled (only when contract configured).
- [ ] Tap a **knob nudge** → ✅ projector scene shifts (knobs coalesce ~200ms); `txCount` ticks on both screens; **no wallet popup, no gas** (gasless).
- [ ] Drag **intensity** → ✅ projector intensity follows (throttled ~200ms).
- [ ] Submit a **prompt** → ✅ appears in **up-next**, then becomes **now-playing** after dwell (~12s) and the projector regenerates from it.
- [ ] **Paid tip** (needs MON in the smart account) → ✅ jumps ahead of free prompts.
- [ ] Edges: stage not configured → ✅ controls disabled ("not configured"); unknown/closed room → ✅ empty state; `allowPrompts=false` → ✅ knobs work, prompts ignored; tx failure → ✅ optimistic count rolls back + toast; owner out of credits → ✅ crowd prompt denied (gated on owner's account); **close stage** → ✅ room invalid.

---

# Part B — Automated test backlog (prioritized)

**Current coverage:** `credits.service`, `credit-gate`, `ws-ticket`, **`reel.router` (13 cases, done)**, and `prompt-queue` (per the onchain map). **No e2e exists.** Runner: `bun test` + pglite (`@sonara/test-utils`); the established pattern is in-memory pglite + hand DDL + a 30s hook timeout (pglite cold-start) + `mock.module` for storage/external deps; oRPC routers are tested in-process via `createRouterClient`.

## P0 — server unit/integration (cheap, high-value, do first)
- [ ] **`library.router`** — sessions grouping (one session per `session_id`; `durationMs` from `tMs`), `bySession` ordering, cursor pagination, **example-session fallback** when empty, ownership (cross-user returns own data only). *(Mirror `reel.router.test.ts` harness.)*
- [ ] **`prompt-queue`** — confirm/extend: paid-first ordering, FIFO within tier, dedup, one-in-flight-per-sender, cap eviction (`onDrop`), dwell rotation via injected clock.
- [ ] **`stage-rooms`** — mint/reuse same code per liveSessionId, `resolve`/`roomFor`, close invalidates.
- [ ] **knob coalescing** (`stage-listener` fold logic, extracted/pure) — nudge sum + set last-write-wins → one clamped patch; dead-room GC.
- [ ] **`models.ts`** — model key → transport/falId/steps routing; default resolution; unknown key rejected (allowlist).
- [ ] **`credit-gate`** — extend: paid→free-tier fallback ordering, denial cooldown `shouldEmit`, refund no-op for free-tier.
- [ ] **Contract (`SonaraStage.sol`)** — Foundry tests: `nudge`/`set`/`prompt` emit the right events with encoded room/knob/fixed-point values; `prompt` carries `msg.value` as tip.

## P1 — e2e (web flows) — add Playwright (not yet in repo)
- [ ] **Anon demo:** landing → `/play` → deck loop renders → deck switch → (no fal calls asserted).
- [ ] **Auth gating:** `/studio` + `/control` redirect anon; `?next=` sanitization.
- [ ] **Reels:** sign-in → create reel → add frame from a session → reorder → reload persists → replay (`/play?reel=`) shows the HUD. *(Use a seeded test account; assert UI state, not pixels.)*
- [ ] **Go-live (shallow):** assert up to `generation.requested` / `job.status:running` to avoid depending on a live fal render (mock fal or stop before the image).
- [ ] **Durable session:** integration-level (cheaper than browser) — two WS connects with the same `liveSessionId` produce frames sharing one `session_id`; "new session" yields a new one.

## P2 — heavier / later
- [ ] **Dodo webhook idempotency** — integration test: same `payment_id` twice → one credit (partial-unique guard).
- [ ] **Onchain listener integration** — against a local anvil/Monad fork: emit events → assert `applyPatch`/queue effects (advanced; gate behind a flag).
- [ ] **Session trigger gating** — anon guard, demo short-circuit, version monotonicity, `lastKeyframeAt` anti-stack/no-double-debit (Session is stateful; test the extractable pieces).
- [ ] **Realtime vs queue provider** — provider-level unit tests with a mocked fal client (connection reuse, request_id correlation, refund-on-error).

## Infra to stand up
- [ ] Add **Playwright** + a dev/test target (against dev, or a docker-compose local stack with pglite + mocked fal).
- [ ] A reusable **fal mock** (`mock.module`) so generation tests are deterministic + free.
- [ ] Wire `bun test` (+ e2e) into CI as a required check before `dev → main`.

---

## Notes / known caveats to verify
- **Tips need a funded smart account** — gasless sponsors gas only; a MON `msg.value` tip must come from the burner's account. Confirm the UI communicates this (or treat tipping as a known limitation).
- **`permissionless@0.2.40`** API drift — the gasless UserOp path has a code comment to verify against the installed version; smoke-test before any live stage demo.
- **Stage state is ephemeral** (in-memory `stageRooms`/`stageState`) — a server redeploy drops open rooms; re-open mints a fresh code. Expected, but note for live events.
- **Reorder + non-deferrable unique index** — the offset-bump transaction is covered by a reel test; keep it if the index stays non-deferrable.
