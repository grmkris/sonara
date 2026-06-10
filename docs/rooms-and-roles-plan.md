# Stages & roles — live-identity refactor plan (rev 2)

> **Status: revised direction, 2026-06-10 architecture round.** Rev 1's transport
> and Redis decisions are **unchanged** (restated under _Locked decisions_).
> What changed: the durable identity is now the **stage** (named, multiple per
> account, permanent short code), not "one room per account"; and the page model
> changes from "three independent pages" to "**faces of a stage**" so /play and
> /control stop being separately-discovered things.
> Coordination: the **sets-refactor lane** is concurrently designing studio
> curation ("activate a set" needs a stage target — see _Coordination_).

## Why (the confusion, diagnosed)

Two complaints drove rev 2, both reduced to the same root:

- **/play sometimes spawns a new session, sometimes not.** Identity is minted
  client-side into per-tab `sessionStorage`
  (`use-ws-session.ts` → `readOrMintLiveSessionId`). Reload = same set, new tab
  = silent new set, "new session" button = new set, "reset" = same set. Four
  outcomes, zero visible model.
- **/control can't say which thing you're controlling.** The registry is keyed
  by ephemeral WS id; "find my session" is iterate-and-filter; entries are
  anonymous `lse_…` ids that exist because a tab was opened, not because the
  user created anything.

The codebase already contains **three near-rooms**, each holding a third of
what's needed:

| | identity | joinability | durability |
|---|---|---|---|
| `liveSessionId` (`lse_`) | ✅ survives reconnect | — | ❌ no row of its own |
| stage room (`stage-rooms.ts`) | ❌ rebound per gig | ✅ 5-char code + QR | ❌ in-memory, dies on deploy |
| `frame_set` recording | ❌ output, not place | — | ✅ Postgres |

Rev 2 merges the three shadows into one durable entity.

## The model — two nouns

**Stage** (the durable PLACE you perform at) and **Set** (the durable OUTPUT a
performance leaves behind — exists, see `docs/sets-architecture.md`). The
`lse_` live-session id survives but **demotes to "one live run on a stage"** —
internal wire/provenance id only, exactly as sets-architecture already
mandates. The existing invariant **recording-set uuid = lse uuid** is kept:
a run and its recording are the same identity in two prefixes.

```
stage (stg_…, Postgres, named, permanent code)
  └── live run (lse_…, ephemeral, at most one per stage, lives in registry)
        └── recording set (set_…, uuid = lse uuid)   ← "new set" mints a fresh pair
```

- **Multiplicity is allowed but always deliberate**: stages are explicitly
  created and named ("Main floor", "Bar screen"). Every account lazily gets a
  **default stage** ("Your stage") so the single-stage user never sees any of
  this machinery.
- **Sets are segments within a stage.** "New set" (replaces the "new session"
  button) ends the current recording set and starts the next run — the stage's
  identity, URL, and QR never change.
- The **stage code** (5-char Crockford, today minted per `stage.open`) becomes
  a **permanent column on the stage row** — a venue can print the QR once.
  Owner can regenerate the code if it leaks (name stays; old code 404s).

### `stage` table

```
stage
  id          stg_… typeid (new prefix)
  user_id     → user.id, NOT NULL (anon stages don't exist in DB — see Anon)
  name        text NOT NULL                  -- "Main floor"
  code        char(5) NOT NULL UNIQUE        -- Crockford, permanent join handle
  is_default  boolean NOT NULL default false -- unique partial idx (user_id) WHERE is_default
  + baseEntityFields
```

Plus `frame_set.stage_id` (nullable `stg_` FK; null for pre-stage recordings
and builtins) with index `(stage_id, created_at DESC)` — "sets performed on
this stage".

**Runtime state is NOT persisted** (current run `lse_`, crowd open/closed,
`allowPrompts`, `showQr`, connected screens): it lives in the registry
(in-memory now, `StageStore`→Redis in Phase 2). Postgres keeps identity only.

## Faces, not pages (the /play–/control fix)

The residual-confusion risk: even with stages, /play carries embedded controls
while /control is a second control surface — two consoles, undefined liveness,
four page-words. Rev 2 makes every surface **a face of a stage**:

| face | who / device | canonical URL | shortcut |
|------|--------------|---------------|----------|
| **screen** | the projector / big display (owner-authed) | `/stage/<code>/screen` | **`/play`** → default stage's screen |
| **console** | the owner's controls (phone or drawer) | `/stage/<code>/console` | **`/control`** → console resolver |
| **crowd** | audience: join, tap, pay, (later) watch | `/stage/<code>` | the QR |
| replay/live permalink | anyone with the link | `/s/<setId>` | share button (unchanged) |

- **/play and /control survive as aliases** (muscle memory), but they are
  *entry points into the stage*, not independently-discovered things. Bare
  `/play` = your default stage's screen. Bare `/control` = console resolver:
  0 stages live → onboarding; 1 live → that console; N live → **named** picker
  ("Main floor · live · 'neon cathedral'") — every entry is something the user
  consciously created and named.
- **One console, two mounts.** A single `StageConsole` component renders
  *attached* (collapsible drawer on the screen face — the laptop-only user) and
  *detached* (`…/console` on the phone). Identical controls, identical actions
  (the `control.*` HTTP router, now keyed by stage). There is never a question
  of "which control surface" because there is only one, shown in two places.
  A "clean screen" toggle hides the drawer entirely for projection.
- **Liveness rule (the invariant that makes /control predictable):**
  **a stage is live ⟺ a screen connection is attached.** Opening /control
  never creates anything; a console for a non-live stage shows
  "no screen connected — open /play (or scan this stage's screen link) on the
  display" instead of guessing.
- **Per-set consoles (`/s/<id>/control`) are superseded** by the per-stage
  console: the per-set URL dies with every gig, the stage console URL is
  stable forever. Keep the route as a redirect (lens → live stage → console)
  so existing bookmarks survive; same "one page one persona" intent, better
  home. `/s/<setId>` itself is unchanged (live tense + replay forever).

### Behavior invariants (acceptance criteria for the confusion fix)

1. Opening a page **never** mints identity. Stages are created explicitly (or
   the one-time default); runs are started by the screen attaching; sets appear
   only when a run records its first frame.
2. Bare `/play` and `/control` always mean **the default stage** (or resolve to
   the single live stage). The multi-stage user pays exactly one decision —
   naming the extra stage — and gets a bookmarkable screen URL per display.
3. Reload/reconnect of the screen resumes the **same run** (and recording set)
   within a grace window (~2 min) held by the registry — replacing
   sessionStorage's resume role, and working across tab closes, which
   sessionStorage never did. After the window (or explicit "new set"/stop),
   the next attach starts a fresh run.
4. A second screen connection to an already-live stage **takes over** (old
   screen gets a `screen.takenOver` event and demotes to a passive view).
   Mirroring is Phase 3 fan-out, not Phase 1.
5. Same controls everywhere: the attached and detached consoles are one
   component driving one router. No action exists on only one of them.

### Anon

Unchanged lean from rev 1: anon `/play` is the demo instrument — a
`localStorage`-stable pseudo-stage id for reconnect only, pinned to demo, not
joinable, never recorded, no DB row. Sign-in is the gate to having a real
stage (and to being paid).

## Roles

| Role | Auth | Sees visuals | Can change scene | Notes |
|------|------|--------------|------------------|-------|
| **Screen** (was Host/Projector) | owner signed-in | yes (big screen) | yes (attached console) | runs audio; one live screen per stage (takeover) |
| **Operator** | owner | optional | yes, always | detached console — today's /control |
| **Crowd** (was Watcher) | none to join; wallet to pay | Phase 3 mirror | propose / paid grant | scans the permanent QR |

"Manager" stays a **grant**, not a fourth role.

## Transport & state layering (locked in rev 1 — unchanged)

- **Thin layer on Bun's native WS pub/sub; oRPC stays the only wire.** Rooms…
  now stages… surface as **oRPC event-iterator subscriptions**; Bun pub/sub is
  the internal fan-out engine. Never raw `ws.publish` frames onto the oRPC
  socket. (Full alternatives analysis — PartyKit/Colyseus/Socket.IO/Centrifugo
  — lives in rev 1 history; conclusions stand.)
- **Redis client:** `ioredis` or `Bun.redis` (two connections for pub/sub).
  Not Upstash for the subscriber.
- **State layering:** in-memory = working copy (audio features, in-flight
  jobs, live connections); Redis = coordination + ephemeral durability
  (stage registry/snapshot w/ TTL, presence, cross-instance pub/sub);
  Postgres = identity + money + history only. Never high-frequency realtime
  through Postgres.
- **The seam:** all room/stage state flows through three interfaces —
  `Broadcaster` / `PresenceStore` / **`StageStore`** (renamed from
  `RoomStore`; same shape plus `findByCode`) — with in-memory impls first,
  per-interface Redis swaps later. Write-through discipline: only low-freq
  mutations (`scenePatch`, `goLive`, `setSource`, `lastFrameUrl`) hit
  `StageStore.put`.
- **Railway constraint:** no sticky sessions → single replica until
  backplane + presence are on Redis (Phase 2b).
- **Resilience kicker:** push-to-deploy restarts the container; a Redis-backed
  stage snapshot (short TTL) lets a live gig rehydrate instead of dying —
  why `StageStore`→Redis lands before any multi-instance work.

## Phased plan

### Phase 0 — Durable stages, zero visible change
- `stage` table + `stg_` typeid + migration; `frame_set.stage_id` column.
- Lazy **default stage** resolve-or-create on first authed screen attach.
- Registry re-keys by **stage id** (today: ephemeral WS id). `Session` (the
  generation engine — kept, not rewritten) becomes the run object owned by a
  stage entry. `getByLiveSessionId` kept for `/s` lens.
- **Client stops minting `lse_`** (`sessionStorage` code deleted). The server
  mints the run id on attach; the **grace window** in the registry replaces
  reload-resume (invariant 3).
- `/control` resolves stages server-side (0/1/N rule) instead of listing raw
  sessions. `stage.open/close` re-keyed to stage id; **code comes from the
  stage row** (permanent) instead of per-open minting.
- Everything behaviorally identical for the single-stage user.

### Phase 1 — Faces + one console
- Routes: `/stage/<code>/screen`, `/stage/<code>/console`; `/play` and
  `/control` become resolving aliases. Stage create/rename/regenerate-code UI
  (tiny — a menu on /control and /studio).
- `StageConsole` extracted once, mounted attached (drawer + clean-screen
  toggle on the screen face) and detached. `/s/<id>/control` → redirect.
- Takeover semantics (invariant 4). "New set" segmentation on the console.
- Broadcasts move onto role topics (`stage:<id>:all` / `:control`) via
  `Broadcaster`; operator stays HTTP-polling (rev 1 open decision #3 —
  resolved: migrate operator to WS only when the crowd mirror lands).

### Phase 2 — Redis, per-interface (unchanged from rev 1)
- `StageStore` → Redis first (snapshot + registry + code lookup, TTL):
  gigs survive a deploy. Still single instance.
- `Broadcaster`/`PresenceStore` → Redis only at replica #2.

### Phase 3 — Crowd face grows the mirror (was "/watch")
- The crowd face (`/stage/<code>`) gains the **synced visual mirror**
  (same client WebGL canvas off the event stream) + prompt/image **proposals**
  into a host approval queue. No separate `/watch` route — it merges into the
  stage page the audience already joins. Monad tap/prompt UI keeps living here.

### Phase 4 — Paid control grants (unchanged)
- `ControlGrant`: timed slot first; ACL flips owner-only → owner-OR-grant.
  Reuses credits/USDC rails.

## Decisions

**Resolved this round**
- **Name: `stage`** (not "room") — already the product word (`/stage/[room]`,
  "join the stage", USDC stage payments); the crowd-control feature becomes
  "opening your stage", a flag on the entity instead of a parallel system.
- **Multiple stages per account, explicitly created + named**; lazy default
  stage hides the machinery from the 95% case.
- **Code is identity, name is label**: codes permanent (regenerable on leak),
  renames never break URLs/QRs.
- **Second screen on a live stage: takeover** (mirror deferred to Phase 3).
- **Operator transport: HTTP until Phase 3** (rev 1 open #3).
- **Per-set consoles fold into the per-stage console** (redirect kept).

**Still open (don't block Phase 0)**
1. Screen pairing for devices without the owner's session (venue PC): enter a
   short pairing code approved from the console? Post-Phase-1 nicety.
2. Does the crowd face show the mirror to non-payers always, or owner-gated?
   Phase 3 call.
3. Retire `/s/<id>/control` redirect eventually, or keep forever? Cheap; keep.

## File-level change map (Phase 0–1)

**DB / shared**
- `packages/db/src/schema/stage.db.ts` *(new)* — `stage` table;
  `frame-set.db.ts` + `stage_id`.
- `packages/shared/src/typeid.ts` — add `stage: "stg"`.
- `packages/shared` — `StageSummary`, `Role`, `StageSnapshot` types.

**Server**
- `apps/server/src/session/session-manager.ts` — re-key by stage id; grace
  window; becomes in-memory `StageStore`/`PresenceStore` impl.
- `apps/server/src/session/session.ts` — accept server-minted run id; expose
  snapshot; otherwise intact.
- `apps/server/src/onchain/stage-rooms.ts` — absorbed: code lookup moves to
  the stage row / `StageStore`; runtime flags stay registry-side.
  `stage.router.ts` re-keys open/close/airdrop by stage id (**coordinate with
  monad-showcase lane**).
- `apps/server/src/rpc/control.router.ts` — procedures take `stageId`;
  `liveSessions()` → `stages()` (with name/code/liveness).
- `apps/server/src/server.ts` — WS open resolves stage + role from ticket,
  attach-to-stage instead of `manager.create` per socket.

**Web**
- `apps/web/src/app/stage/[room]/` — gains `screen/` + `console/` faces
  (crowd face stays at the index).
- `apps/web/src/app/play/page.tsx`, `app/control/page.tsx` — become alias
  resolvers; `app/s/[id]/control/page.tsx` — redirect when live.
- `apps/web/src/components/stage-console/` *(new)* — the one console,
  attached + detached mounts.
- `apps/web/src/hooks/use-ws-session.ts` — delete `readOrMintLiveSessionId`;
  send stage id + role; handle `screen.takenOver`.

## Coordination

- **sets-refactor lane (studio curation):** "activate a set from /studio"
  should be designed as `control.setSource({ stageId, … })` — the stage picker
  (same 0/1/N rule as /control) is the targeting answer. Don't build a
  studio-local "newest live session" guess.
- **monad-showcase lane:** permanent codes change `stage.open` semantics
  (open = enable crowd access on an existing code, not mint). QR becomes
  printable; `showQr` stays a runtime flag.
- Ledger protocol per `docs/sets-delivery-plan.md` — claim files before
  editing; this plan's Phase 0 touches `server.ts` (contested historically).

## References
- Rev 1 (rooms-and-roles, 2026-06-09) — transport research: Bun pub/sub
  production-ready; Railway no sticky sessions; PartyKit Cloudflare-only;
  Centrifugo = the buy-don't-build landing spot if transport externalizes.
- Operator-remote commit `3eb2dc4`; sets model `docs/sets-architecture.md`;
  delivery ledger `docs/sets-delivery-plan.md`.
