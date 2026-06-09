# Rooms & roles — live-session refactor plan

> **Status: green-lit approach, staged build.** The transport and Redis decisions
> below are settled (see _Locked decisions_). Phases are independently shippable;
> each ends green and testable on `dev.sonara.fm`. Two product forks remain open
> (see _Open decisions_) but don't block Phase 0.

## Why

Two product goals drove this:

- **Goal A — split the display from the controls.** A clean projector canvas on
  the big screen; the controls on a phone. (Largely shipped already as the
  _operator remote_, commit `3eb2dc4` — `/play` projector + `/control` phone.)
- **Goal B — a third participant: the watcher.** Anyone scans a QR on the big
  screen, watches the visuals on their own device, **proposes** what gets
  rendered, and later **pays the host for timed control**.

Goal A works today. Goal B is blocked on one structural fact, and fixing it is
what this plan is about.

## The blocker: a session _is_ a socket

Today **one WebSocket connection = one `Session`** (`apps/server/src/session/session.ts`),
minted on connect and destroyed on close. Consequences:

- `liveSessionId` is a field initializer (`session.ts:179`) → **reminted on every
  reconnect/tab**. There is no durable room identity. A QR encoding the id dies the
  instant the host's browser reconnects.
- The `SessionManager` map is keyed by the **ephemeral per-tab WS id**, not by
  user or room. "Find my session" means iterating and matching `userId` — which is
  why the operator re-resolves every poll instead of pinning an id.
- **No fan-out.** Each socket gets its own `Session`; two browsers are two
  unrelated sessions. The operator dodged this by never opening a socket (it polls
  HTTP via the `control` router). A _watcher who must see the visuals_ can't dodge
  it — they need the `scene.state` + `frame.*` stream.

So the model must invert:

> **1 Room (durable identity) ← many Connections (host / operator / watcher),
> with role-based event fan-out and a control-authority layer.**

Everything in Goal B — QR-to-join, watcher-mirrors-the-screen, propose-an-image,
pay-for-a-slot — falls out of that one primitive.

## Roles

| Role | Auth | Sees visuals | Can change scene | Notes |
|------|------|--------------|------------------|-------|
| **Host / Projector** | signed-in (anon best-effort) | yes (big screen) | yes, always | owns the room; runs audio; pays or gets paid |
| **Operator** | host's account | optional | yes, always | host's own phone (today's `/control`) — trusted |
| **Watcher** | none to watch; signed-in to pay | yes (mirrors on own device) | **propose only**, or **direct control while holding a paid grant** | the audience; scans the QR |

"Manager" = a watcher the host _promotes_ to operator-level control — modelled as a
**grant**, not a hard-coded role. Keeps the taxonomy at three.

## Transport decision (settled)

**Build thin on Bun's native WebSocket pub/sub, keep oRPC as the only wire, pull in
just a Redis client. No rooms framework.**

Why not the alternatives (researched June 2026):

- **PartyKit / partyserver** — acquired by Cloudflare (Oct 2025), folded into the
  Agents SDK; every room _is_ a Durable Object. **Hard-requires Cloudflare Workers +
  DO; cannot deploy to Railway.** Would split the realtime layer onto a second cloud,
  away from the auth (first-party cookies on `sonara.fm`) and credits ledger.
- **Colyseus** — the one real TS rooms framework (authoritative state sync, presence,
  `@colyseus/redis-driver`, `@colyseus/bun-websockets`). Best _conceptual_ fit, but it
  **owns the WS transport and ships its own `colyseus.js` client** → forks us off oRPC.
- **Socket.IO** — same trade-off: a second protocol + client alongside oRPC.
- **Centrifugo** — excellent self-hosted Go realtime server (Redis/NATS backplane,
  built-in presence, JWT, one Railway service). The "buy, don't build" escape hatch
  _if we ever externalize transport_ — premature now.
- **Hocuspocus/Yjs** — CRDT; overkill (we have one authoritative writer, not
  multi-writer documents).

The deciding tension: we're all-in on oRPC-over-WS. Every real rooms framework brings
its own transport/client, colliding with oRPC's wire framing. Bun pub/sub
(`ws.subscribe` / `server.publish`, built on uWebSockets, ~700k msg/s) _is_ the room
primitive, and we already run `Bun.serve`. oRPC's own scaling primitive ("Durable
Iterator") is Cloudflare-only too, so the backplane gets built underneath oRPC regardless.

**oRPC integration rule (important):** never fire raw `ws.publish` JSON onto the socket
the browser feeds into the oRPC client — oRPC owns the envelope and will choke on foreign
frames. **Rooms surface as oRPC event-iterator subscriptions** (the web app already
consumes `client.events()` as an async iterator); **Bun pub/sub is the _internal_ fan-out
engine feeding those iterators.** One protocol on the wire.

**Redis client:** `ioredis` (battle-tested on Bun) or native `Bun.redis` (subscriber-mode
connection can't also issue commands → two connections). `@upstash/redis` is HTTP — fine
for the snapshot KV, not for the pub/sub subscriber. Railway Redis is standard TCP.

## State layering

Not "in-memory vs Redis/Postgres" — _which layer_:

| State | In-memory | Redis | Postgres |
|-------|-----------|-------|----------|
| Live WS connections | **only option** | — | — |
| Audio features (high-freq, per-frame) | **yes** | no | **never** |
| In-flight generation job / hot scene during a gig | **yes** (latency) | snapshot only | no |
| Cross-instance fan-out (backplane) | single-instance only | **yes** (pub/sub) | weak (LISTEN/NOTIFY) |
| Presence (who's in the room) | single-instance only | **yes** (hash + TTL) | no |
| Room registry (id→owner, short-code→id) | single-instance only | **yes** | optional |
| Scene snapshot for reconnect/rehydrate | works until restart | **yes** (TTL) | overkill |
| Payment transactions / control grants | **never** | no | **yes** (exists) |
| Library frames / history / audit | — | no | **yes** (exists) |

In-memory = the working copy. Redis = coordination + ephemeral-durability.
Postgres = the money/history book. **Don't push high-frequency realtime through
Postgres** (write amplification, pool contention, latency).

**The sonara-specific kicker:** push-to-deploy restarts the Railway container on
every ship, and so does any Railway restart. With pure in-memory rooms, **a live
gig dies the moment anyone pushes.** A Redis-backed scene snapshot (short TTL) lets
clients reconnect and _rehydrate_ — visuals continue instead of resetting to demo.
That's a resilience argument independent of scale, and it's why `RoomStore`→Redis
lands before the multi-instance backplane.

**Railway constraint:** no sticky sessions (official) — the LB randomizes across
replicas. So in-memory rooms work **only on a single replica**. Run 1 replica,
vertical-scale it, go multi-replica only after backplane + presence are on Redis.

## The seam (the one rule that prevents double-work)

From Phase 0, everything that broadcasts or reads room state routes through three
interfaces. "In-memory → Redis" and "single → multi-instance" then become config
swaps, **and the swap can happen per-interface** (resilience before scale).

```ts
interface Broadcaster {              // fan-out to room/role topics
  publish(topic: string, ev: ServerEvent): void
  // in-mem: Bun ws pub/sub  ·  redis: + cross-node bridge
}
interface PresenceStore {            // who's in the room, by role
  join(roomId: string, conn: ConnRef): void
  leave(roomId: string, conn: ConnRef): void
  roster(roomId: string): Promise<RosterEntry[]>
  // in-mem: Map  ·  redis: hash + TTL heartbeat
}
interface RoomStore {                // authoritative snapshot + registry
  get(roomId: string): Promise<RoomSnapshot | null>
  put(roomId: string, snap: RoomSnapshot): Promise<void>  // write-through, LOW-freq only
  findByOwner(userId: string): Promise<string | null>
  findByCode(code: string): Promise<string | null>
  // in-mem: Map  ·  redis: keys w/ TTL
}
```

`Room` is the domain object: wraps the existing `Session` (the generation engine —
**kept, not rewritten**, demoted from top-level to a component), owns the connection
set + roles, talks to the three interfaces. Today's `SessionManager` becomes the
in-memory impl of `RoomStore`/`PresenceStore`.

**Write-through discipline:** only low-frequency mutations hit `RoomStore.put` —
`scenePatch`, `goLive`, `setDemoMode`, `lastFrameUrl` (human-paced / frame-paced).
Audio features and in-flight job state stay in-memory only.

## Phased plan

### Phase 0 — Durable identity + seam, zero behavior change
- Stop reminting `liveSessionId` per socket; bind room id to owner (one active room
  per account; anon → `localStorage`-stable id replayed on reconnect).
- Introduce the three interfaces with **in-memory impls**; route existing code through
  them. The current single-socket projector keeps working — it's just "a room of one."
  Pure refactor, nothing user-visible.

### Phase 1 — Room model + fan-out + Goal A on the spine
- `Room` wraps `Session`; broadcasts go to role topics (`room:<id>:all` /
  `:control` / `:presence`) via `Broadcaster`; presence tracked.
- Rooms surface as oRPC event-iterator subscriptions; Bun pub/sub feeds them.
- `/play` = clean display + the **QR seam** (points at a `/watch` route filled in
  Phase 3); `/control` = operator. Reconnect rehydrates from in-memory `RoomStore`
  (survives reconnect within the process, not redeploy yet).

### Phase 2 — Redis, per-interface
- **`RoomStore` → Redis first** (snapshot + registry, TTL). Buys **redeploy/restart
  resilience** — gigs survive a ship. Still single instance.
- **`Broadcaster` + `PresenceStore` → Redis** only when adding replica #2
  (cross-node fan-out + shared presence; makes Railway's no-sticky-sessions a
  non-issue). Deferred until needed.
- Add Railway Redis service, `${{Redis.REDIS_URL}}`.

### Phase 3 — Watcher (free)
- `/watch/:id` subscribes to `room:<id>:all`, renders the **same client-side WebGL
  canvas** off the synced stream (mirror is free), and submits prompt/image
  **proposals** to a host approval queue. No money, no abuse surface — host curates.
  This is "watcher proposes which image is rendered."

### Phase 4 — Paid control grants
- `ControlGrant` abstraction: timed-slot first; pay-per-prompt + bid-for-stick
  pluggable behind one acquisition interface. Reuse credits + Dodo for viewer→host
  transfer + revenue share. ACL flips from owner-only to owner-OR-active-grant.

## Locked decisions
- **Transport:** thin layer on Bun pub/sub + oRPC. No PartyKit / Colyseus / Socket.IO.
- **Redis client:** `ioredis` or `Bun.redis` (two connections for pub/sub). Not Upstash for sub.
- **Redis timing:** `RoomStore`→Redis at Phase 2 (resilience); backplane/presence→Redis
  deferred to first multi-replica need.
- **Postgres:** durable money/grants/history only — never hot realtime state.
- **Wire:** rooms as oRPC event iterators; Bun pub/sub is internal fan-out, never raw frames on the oRPC socket.

## Open decisions (don't block Phase 0)
1. **One room per account, or many?** Lean **one active room per account** — matches
   the single-projector reality; the QR resolves to "your room."
2. **Anon hosts joinable?** Lean **sign-in required to be joinable** (and definitely
   to be _paid_); anon rooms get a `localStorage`-stable id for reconnect only.
3. **Operator: move to WS in Phase 1, or stay HTTP-polling until Phase 2?** Lean
   **stay HTTP for Phase 1** to keep Goal A small; migrate to a room WS connection in
   Phase 2/3 when watchers arrive.

## File-level change map (Phase 0–1)

**Server**
- `apps/server/src/session/session.ts` — drop per-socket `liveSessionId` minting;
  accept a durable room id; expose snapshot for `RoomStore`. Keep the generation
  engine intact.
- `apps/server/src/session/session-manager.ts` — becomes in-memory `RoomStore` +
  `PresenceStore` impls; key by room id, not ephemeral WS id.
- `apps/server/src/session/room.ts` *(new)* — `Room` domain object (Session +
  connection set + roles + interface wiring).
- `apps/server/src/realtime/` *(new)* — `Broadcaster` / `PresenceStore` / `RoomStore`
  interfaces + in-memory impls (Bun pub/sub broadcaster).
- `apps/server/src/server.ts` — WS `open`/`message`/`close` attach a connection to a
  room (resolve-or-create by durable id + role from ticket) instead of `manager.create`
  per socket; wire `ws.subscribe(room:<id>:*)` by role.
- `apps/server/src/rpc/control.router.ts` — unchanged in Phase 0–1 (still HTTP); ACL
  generalized in Phase 4.

**Shared / API**
- `packages/api/src/session-registry.ts` — extend toward `RoomStore`/`PresenceStore`
  shapes; add roster/registry methods.
- `packages/api/src/routers/session.router.ts` — add room subscribe/roster procedures
  (event iterators) in Phase 1.
- `packages/shared/src/` — add `Role`, `RosterEntry`, `RoomSnapshot` types; room-id typeid.

**Web**
- `apps/web/src/app/play/page.tsx` — clean-display affordance + QR seam.
- `apps/web/src/hooks/use-ws-session.ts` — send role on connect; rehydrate from snapshot.
- `apps/web/src/app/watch/[id]/page.tsx` *(new, Phase 3)* — watcher mirror + propose UI.

## References
- Operator-remote commit: `3eb2dc4`.
- Existing WS handler: `apps/server/src/server.ts:95-148`.
- Research (June 2026): Bun pub/sub is production-ready & uWS-based; Railway has no
  sticky sessions; PartyKit is Cloudflare-only; Soketi abandoned; Centrifugo is the
  off-the-shelf landing spot if transport is ever externalized.
