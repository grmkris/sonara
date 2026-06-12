# Sets — the unified architecture (foundation spec)

> **Status: SHIPPED through P5 + U8 (2026-06).** The demoMode/demoDeck shims
> described as "one-release tolerance" below are now fully deleted; `source`
> is the only vocabulary on the wire.

> Outcome of the 2026-06-09 architecture round. Supersedes the "session id / reel /
> deck" three-concept model. Status: **shipped through P5 (2026-06-11, U1–U7)** —
> one source state (`Session.source` / the client source slice), one playback loop
> (`use-playback-loop`), decks materialized as builtin sets with `look_*` columns
> (DECK_LOOK generalized: any owned set can carry a baked look, editable in
> studio), studio "decks" tab. demoMode/demoDeck survive only as one-release
> shims (WS+HTTP setDemoMode, StateOutput/ControlSnapshot derived fields) —
> delete after soak.

## The model in one paragraph

Sonara has exactly **two concepts**: **Live** (the instrument — frames generated
from audio in real time) and the **Set** (a named, ordered, playable collection of
frames). Everything that used to be a separate idea — built-in *decks*, archived
*sessions*, curated *reels* — is a Set, distinguished only by an `origin` tag.
The engine (`/play`) shows **one source at a time** (Live or a Set), switched and
stopped via a single **Now-Showing transport**. Performing live **auto-records a
Set**. Any Set (and any live performance, via its recording Set) is shareable at
one permalink: **`/s/<set_id>`** — live view while the show is running, replay
forever after. The link never dies.

## Why (what this fixes)

- Today live/deck/reel playback already converge on one client call —
  `pushFrame()` in `scene-slice.ts` — and are mutually exclusive. The canvas is
  blind to the source. Three product concepts for one mechanism was accidental
  complexity.
- `/control`'s preview is blank during deck/reel playback because the server only
  knows about frames *it* generated (`lastFrameUrl`). The keystone fix (the
  producer reports `currentFrame` upward) makes every mode visible to every
  viewer.
- Studio's "session" is a derived `GROUP BY session_id` with no identity — no
  title, cover, or visibility — so there is nothing to hang public sharing on.
- Three disconnected surfaces (`/control`, `/stage/[room]`, nothing for watching)
  for what is really one need: *point a second device at a performance*.

## Naming

- **UI word: "set"** (DJ set — on-brand).
- **Code/schema: `frameSet` / `frame_set`**, typeid prefix **`set_`**. Never a
  bare `set` (collides with JS `Set`, SQL `SET`, setters; ungreppable).
- "Reel", "deck" (as an entity), and "session" (as a studio object) disappear
  from the UI. `lse_` live-session ids remain **internal only** (WS/registry key).

## Data model

```
image_library (unchanged — every generated frame, stamped with the lse_ it was born in)
      ▲ referenced by (never copied)
frame_set
  id            set_… typeid
  user_id       null for origin=builtin (system-owned)
  name          text
  origin        'builtin' | 'recording' | 'curated'
  status        'recording' | 'final'        -- recordings only; curated/builtin always final
  cover_frame_id  → image_library, nullable
  visibility    'private' | 'unlisted' | 'public'
  live_session_id  lse_…, nullable           -- set while a live session is feeding this set
  frame_count   int cache
  + baseEntityFields

frame_set_frame
  set_id, frame_id, position int, t_ms int nullable
  unique(set_id, position), unique(set_id, frame_id)
```

- **Recording** (`origin: recording`): created at go-live, frames appended
  chronologically with real `t_ms` as the performance happens, `status: final` +
  `live_session_id: null` when it ends. **Frame list frozen after final** — this
  is a UI/router policy, not a DB constraint (relax later if it feels precious).
  Metadata (name, cover, visibility, delete) stays editable.
- **Curated** (`origin: curated`): hand-built — the old reel flow
  (create/addFrame/reorder/removeFrame/setCover), `t_ms` null. "**Make a cut**"
  on a recording seeds a curated set from its frames (junction refs, no copies).
- **Builtin**: the shipped decks (NOIR, CYBER, …) as rows —
  `visibility: public`, `user_id: null`. Boot-seed (`library-seed.json`)
  converges them, same pattern as today's deck seeding.
- **Playback cadence is derived, not configured**: frames have `t_ms` → original
  timing (clamped 600–6000ms, as today); no `t_ms` → fixed loop (2500ms).

### Migration (write, don't run unattended)

1. `reel` + `reel_frame` → `frame_set(origin: curated)` + `frame_set_frame`.
2. Backfill recordings: today's derived sessions (`GROUP BY session_id` over
   `image_library`) → one `frame_set(origin: recording, status: final)` per
   `lse_`, frames into the junction with their `t_ms`.
3. Seed builtins from `library-seed.json`.
4. Keep `image_library.session_id` (provenance) — it is not replaced by the
   junction.

## The transport ("Now Showing")

One control replaces the deck picker, reel HUD, and go-live scatter:

```
┌─ now showing: NOIR ────────────────────────── ■ stop ─┐
│ ▾  ● Live (generate from audio)                       │
│    ─ decks (builtin) ─  NOIR · CYBER · RAVE · VOID …  │
│    ─ recordings ──────  14:05 · 4m14s · 79 frames …   │
│    ─ my sets ─────────  "best of friday" …            │
└───────────────────────────────────────────────────────┘
```

- One action — `source.set({ kind: 'live' } | { kind: 'set', setId } |
  { kind: 'idle' })` — replaces `demo.set`, the `?reel=`/`?session=` params, and
  goLive's mode-switching half (`goLive` keeps the prompt-seeding part).
- **■ stop → idle** (hold last frame / calm idle state).
- One client producer hook — `useSetPlaybackLoop` — replaces
  `use-demo-frame-loop` + `use-reel-playback-loop` (cadence derived from `t_ms`
  presence; same `pushFrame` + version-guard discipline).
- The same transport renders on `/play` (dispatching over WS) and on the
  `/s/[id]` owner view (dispatching over the protected `control.*` HTTP router).

## The keystone (unchanged from earlier rounds — build first)

The producer (`/play` only) reports its on-screen frame so the server has the
truth in **every** mode:

- `scene-slice.ts` `currentFrame` → debounce-free dedup → WS
  `frame.report { url: z.string() }` (**never `.url()`** — builtin frames are
  origin-relative `/library/...` paths) → `Session.setCurrentFrame(url)` →
  `ControlSnapshot.currentFrameUrl` (`?? lastFrameUrl`).
- `reset()` clears it. Viewers never report (they don't mount the hook).
- Fixes the blank `/control` preview for decks/reels immediately; prerequisite
  for any `/s` viewer.

## The permalink — `/s/[id]`

- **The shareable id is the set id.** Going live creates the recording set, so
  the link exists from minute one and survives the show: `lens` checks
  `live_session_id` → live session in registry → **live tense** (poll
  `currentFrameUrl` ~1s, two-`<img>` crossfade; Monad crowd panel when the stage
  is open; owner → transport + mixer). Otherwise → **replay tense** (client-side
  set playback from the junction, honoring visibility).
- `lens` is a **public procedure in `apps/server`** (it needs `stageRooms` /
  `stageState`, which `packages/api` cannot import) — lives next to
  `stageSnapshot` in `control.router.ts`. Returns
  `{ exists, tense: 'live'|'replay', isOwner, currentFrameUrl, scene?, status,
  set: { name, origin, visibility, frames? }, stage?: { open, room,
  allowPrompts, txCount, nowPlaying, upNext } }`. Ownership =
  `resolveOwnedSession`-style `typeIdToUuid(userId).uuid === session.userId`.
- `lse_` ids are also accepted (anon/demo producers have no recording set) —
  live-tense only.
- Replay tense requires a **public read path** for non-private sets (today all
  library/reel reads are `protectedProcedure`): a public `sets.get` honoring
  `visibility`, with presigned frame URLs.

## Surfaces

| Surface | Becomes |
|---|---|
| `/play` | the engine + Now-Showing transport. Share affordance → `/s/<recording set id>` (reuse StageHostPanel copy/QR). |
| `/studio` | the **set library**: one list, filter chips by origin; timeline scrubber (recordings), editor (curated), "make a cut", share/visibility per set. |
| `/s/[id]` | the permalink (live ⇄ replay, owner ⇄ viewer+crowd). |
| `/control` | redirect → `/s/<newest live recording set>` (via `liveSessions()`); inner body extracted as `<OperatorConsole liveSessionId/setId>` shared with the `/s` owner branch. |
| `/stage/[room]` | redirect → `/s/[id]` (room → liveSessionId → set via `stageRooms.resolve`). On-chain stage itself unchanged. |
| App shell | shared minimal chrome on `/play` `/studio` `/s`: wordmark(→`/`) · play · studio · now-showing chip · share. Marketing pages (`/`, `/about`, `/login`, `/credits`) untouched. |

## Phasing (each lands independently on `dev`)

- **P0 — app shell.** Pure UI, no behavior change.
- **P1 — keystone.** `frame.report` end-to-end + `/control` preview reads
  `currentFrameUrl ?? lastFrameUrl`. Fixes the bug on its own.
- **P2 — schema + sets router.** `frame_set` tables, migration (reels →
  curated, sessions backfill → recordings, builtin seed), `reels` router →
  `sets` router (+ public `get` for non-private). Studio reads sets.
- **P3 — transport.** `source.set` action, `useSetPlaybackLoop`, Now-Showing
  dropdown + stop, recording-on-live (set created at go-live, frames appended).
- **P4 — permalink.** `lens` procedure, `/s/[id]` page (viewer crossfade, crowd
  panel, owner console), Share on `/play`.
- **P5 — consolidation.** Redirects from `/control` + `/stage/[room]`, retire
  reel/session wording, drop dead loops/params.

## Risks / notes

- **Hot files** (`session.ts`, `session.router.ts`, `session-actions.ts`) were
  just rewritten in the realtime/moderation merge — re-read before editing; keep
  P1 additive.
- **Never run** `db:push`/`db:migrate`/`db:clean` unattended (machine rule);
  prod applies migrations on boot via `runMigrations()`.
- Recording-on-live writes for **signed-in** producers only (anon sessions are
  library-only and generate nothing new — nothing to record).
- Frame URLs in sets are presigned S3 (refetch on read) or origin-relative
  builtin paths — relative paths only resolve on the web origin, which all
  consumers share; never validate as full URLs.
- The 5-char Monad room codes and the on-chain contract are **unchanged**;
  `/s/[id]` resolves to the room via the existing `stageRooms` mapping.
