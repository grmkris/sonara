# Sets refactor — delivery ledger

> **Status: DELIVERED (2026-06-11, U1–U7 + U8 cleanup).** Historical delivery
> record — the demoMode shims this plan kept "one release" were deleted in the
> post-show cleanup pass.

> Plan-of-record for delivering `docs/sets-architecture.md` to `dev`.
> **Parallel agents: check the file-claims table before editing these files.**
> Protocol: claim WP here → edit → `bun run ci:local` → commit (explicit paths)
> → `git pull --rebase` → push. Small windows on contested files.

Owner lane: **sets-refactor** (this ledger's author). Other active lanes:
monad-showcase, visuals-roadmap, testing.

## Work packages

| WP | Phase | Status | Owned files (exclusive while in_progress) |
|----|-------|--------|-------------------------------------------|
| WP-1 | P1 keystone: `frame.report` → `Session.currentFrameUrl` | **done** (09f7d6b) | released |
| WP-2a | P2 schema: `frame_set`/`frame_set_frame` + typeid + boot backfill | **done** (d702f75; boot call rode 35ee620) | released |
| WP-2b | P2 router: `sets` router + tests | **done** (19d6304) | released |
| WP-2c | P2 studio: unified set library UI; reel router deleted | **done** (ccf0202) | released |
| WP-0 | P0 app shell (AppNavLinks) | **done** (4ddf0c1) | released |
| WP-3 | P3 transport: Now-Showing switcher + source.report + recording-on-live | **done** (64d1355) | released |
| WP-4 | P4 permalink: `lens` (cd81efe) + `/s/[id]` + OperatorConsole + share (56e062c) | **done** | released |
| WP-5 | P5 consolidation: lens row-less-live fallback, `/control` → `/s` redirect | **done** | released |

**Deliberate deviations from the original plan** (coordination-driven):
- `/stage/[room]` is NOT redirected into `/s/[id]` — the stage lane evolved it
  into a first-class surface today (USDC prompts, wire feed, projector QR
  pointing at it). `/s` links to it via the "join the stage" pill instead;
  collapse later if ever, in coordination with that lane.
- Internal file renames (reel-playback-slice/-loop/-hud/-consumer, ReelEditor,
  sessions-list, …) are deferred — UI wording is fully "recordings / sets",
  but the module names still say reel/session. Pure-rename cleanup PR later.
- Legacy `?reel=`/`?session=` replay params and `library.sessions`/`bySession`
  RPCs — retired in C5 (see Done log); the params live on as a prefix-swap
  shim so old links keep working.

Execution is **serial per WP** (one working tree, no worktrees). Each WP lands
green (`bun run ci:local`) and is pushed before the next starts; dev deploy
verified via `railway` CLI + curl after each push.

## Key implementation decisions (from architecture rounds)

- `frame.report` input is `z.object({ url: z.string() })` — **never `.url()`**
  (builtin frames are origin-relative `/library/...`).
- Builtin decks keep **manifest playback** (offline anon path untouched);
  they're materialized as `frame_set` rows (`origin: builtin`,
  `deck_key` column) only for listing + permalinks.
- Backfill is a **boot-time idempotent converger** (pattern:
  `library-boot-seed.ts`), not hand-written SQL in migrations. Deterministic
  ids: curated set uuid = reel uuid; recording set uuid = lse uuid (so
  `/s/<set_id>` is derivable from a liveSessionId client-side).
- `reel`/`reel_frame` tables are **left in place** (stop reading them);
  dropping is a later cleanup PR — never destructive mid-delivery.
- DDL via `drizzle-kit generate` (writes SQL only); migrations apply on server
  boot per deploy. **No db commands are ever run against a live DB by hand.**
- Public `sets.get` must pass through origin-relative urls (don't presign
  `/library/...` paths) and honor `visibility` (owner sees private).
- Anon sessions stay constructor-pinned to demo; `source` switching respects it.

## Done log

- (2026-06-10) C5 shipped — reels fully retired. Migration 0006 is
  COPY-THEN-DROP in one file (reel → frame_set curated copy, then
  `DROP TABLE reel/reel_frame`), so a prod promotion that runs 0005+0006
  back-to-back (before any boot converger) cannot lose data. Retired with
  it: the `?reel=`/`?session=` fetch branches (now a 2-line prefix-swap
  shim onto `sets.get`), the `library.sessions`/`bySession` RPCs +
  example-sessions, the Reel*/SessionSummary shared types, the
  reel/reelFrame typeid prefixes, the converger's curated step, and the
  `insertLegacyReel` fixture. Old /studio links keep resolving forever
  because uuid identity was preserved (curated set uuid = reel uuid,
  recording set uuid = lse uuid) — rel_/lse_ ids remap to set_ ids by a
  literal prefix swap.

- (2026-06-10) Per-set consoles: /s/<id>/control is the owner's lean
  remote (one per show, bookmarkable); /s/<id> is the pure public face
  (embedded mixer removed); /control is a chooser that forwards only when
  unambiguous. One page one persona — do NOT re-embed the console in the
  viewer or re-add newest-session guessing.

- (2026-06-09) Ledger + architecture spec committed.
- (2026-06-09) WP-1 keystone landed (09f7d6b): frame.report → currentFrameUrl,
  /control preview fixed for deck/reel playback.
- (2026-06-09) WP-2a landed: frame_set schema (migration 0005), typeid
  prefixes, FrameSet shared types, boot converger + PGlite tests.
  ¹ **server.ts is mixed with the stage-feed lane's in-flight wiring** — the
  5-line `migrateFrameSetsOnBoot` boot call sits uncommitted in the working
  tree until server.ts gets a clean window. Stage-feed lane: when you commit
  server.ts, the boot-call hunks (import + await after seedLibraryOnBoot) are
  safe to include — the module is already committed and tested.
