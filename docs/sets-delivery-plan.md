# Sets refactor — delivery ledger

> Plan-of-record for delivering `docs/sets-architecture.md` to `dev`.
> **Parallel agents: check the file-claims table before editing these files.**
> Protocol: claim WP here → edit → `bun run ci:local` → commit (explicit paths)
> → `git pull --rebase` → push. Small windows on contested files.

Owner lane: **sets-refactor** (this ledger's author). Other active lanes:
monad-showcase, visuals-roadmap, testing.

## Work packages

| WP | Phase | Status | Owned files (exclusive while in_progress) |
|----|-------|--------|-------------------------------------------|
| WP-1 | P1 keystone: `frame.report` → `Session.currentFrameUrl` | **in_progress** | `packages/api/src/session-registry.ts`, `packages/api/src/routers/session.router.ts`, `apps/server/src/session/session.ts`, `apps/web/src/lib/session-actions.ts`, `apps/web/src/hooks/use-frame-reporter.ts` (new), `apps/web/src/app/play/page.tsx` (mount line), `apps/web/src/app/control/page.tsx` (PreviewCard), `apps/server/src/rpc/control.router.ts` (snapshot fields) |
| WP-2a | P2 schema: `frame_set`/`frame_set_frame` + typeid + boot backfill | pending | `packages/db/src/schema/frame-set.db.ts` (new), `packages/db/src/schema/index.ts`, `packages/db/drizzle/*` (generated), `packages/shared/src/typeid.ts`, `packages/shared/src/events.ts` (set types), `apps/server/src/db/frame-set-boot-migrate.ts` (new), `apps/server/src/server.ts` (boot call) |
| WP-2b | P2 router: `sets` router replaces `reel` router + tests | pending | `apps/server/src/rpc/sets.router.ts` (new), `apps/server/src/rpc/sets.router.test.ts` (new), `apps/server/src/rpc/reel.router.ts` (delete), `apps/server/src/rpc/reel.router.test.ts` (delete), `apps/server/src/rpc/app.router.ts` (register), `apps/server/src/rpc/frame-mapping.ts` (origin-relative URL passthrough) |
| WP-2c | P2 studio: unified set library UI | pending | `apps/web/src/app/studio/**`, `apps/web/src/components/studio/**` |
| WP-0 | P0 app shell | pending | `apps/web/src/components/app-nav.tsx` (new), small chrome edits in `play/page.tsx`, `studio/page.tsx` |
| WP-3 | P3 transport: Now-Showing dropdown + stop; recording-on-live | pending | `apps/web/src/components/visualizer/source-switcher.tsx` (new), `apps/web/src/stores/visualizer/set-playback-slice.ts` (rename of reel-playback-slice), `apps/web/src/hooks/use-set-playback-loop.ts` (rename), `apps/web/src/lib/session-actions.ts` (+source.report), `packages/api/src/routers/session.router.ts` (+sourceReport), `apps/server/src/session/session.ts` (recording set lifecycle), `apps/server/src/library/persist-frame.ts` (junction append), `play/page.tsx` |
| WP-4 | P4 permalink: `lens` + `/s/[id]` + share | pending | `apps/server/src/rpc/control.router.ts` (lens), `apps/web/src/app/s/[id]/page.tsx` (new), `apps/web/src/components/stage/stage-host-panel.tsx` (share reuse), `play/page.tsx` (share affordance) |
| WP-5 | P5 consolidation: redirects, retire reel/session wording | pending | `apps/web/src/app/control/page.tsx`, `apps/web/src/app/stage/[room]/page.tsx`, cleanup |

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

- (2026-06-09) Ledger + architecture spec committed.
