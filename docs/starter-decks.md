# Simplify "Demo mode" → reusable Starter Decks

> Status: **idea / future**. Captured for later — brainstorm the exact UX separately.
> No code yet.

## Context

The top of the controls panel currently shows a **DEMO** section (see
`apps/web/src/components/visualizer/controls/demo-mode-toggle.tsx`):

- a `DEMO` on/off **Switch** (signed-in only),
- two badges — **NO FAL** ("demo mode skips the fal generation api") and **NO CREDITS**
  ("demo frames don't debit your credit balance"),
- a row of deck chips: `Wild Things · Cute Crush · Skyscapes · Liquid · Deep · Bloom · Sacred ·
  Neon · Cyborg` (`packages/shared/src/decks.ts`).

This exposes an internal implementation detail ("demo mode = pull pre-generated frames from
`image_library` instead of calling fal") as a user-facing mode with billing jargon. It's confusing.

## The wish

**Drop the "demo mode" framing entirely.** Reframe the decks as **reusable starter decks** —
curated looks anyone can pick as a starting point. No "demo" label, no "NO FAL / NO CREDITS"
badges, no on/off switch. Just: *pick a deck to start from.*

## What's behind it today (so we don't lose the plumbing)

- **Decks** are defined in `packages/shared/src/decks.ts`; seed prompts in
  `apps/server/scripts/library-manifest.json`; images in the `image_library` table; served by
  `apps/server/src/generation/library-provider.ts`.
- **Server behaviour**: when `demoMode && demoDeck`, `Session.trigger()` short-circuits to
  `triggerLibrary()` — **no fal call, no credit debit** (`apps/server/src/session/session.ts`).
- **Anon sessions are server-pinned to demo mode** (constructor sets `demoMode = true` + a random
  deck). So decks are *already* the de-facto starting experience for logged-out / new users.
- Image-anchor mode wins over demo; `setDemoMode` / `setImageAnchor` are mutually exclusive paths.

So "decks" already are "free, pre-generated starter content." The change is mostly **framing +
UX**, not a new engine.

## Open questions to brainstorm later

- **What does picking a deck *mean* after the rename?** Options to weigh:
  - (a) a deck just **pre-fills the scene/subject + a matching look** (a starting template) and then
    the user generates live (costs credits) — i.e. decks become *scene presets*, not a separate
    playback mode; or
  - (b) keep the "play pre-generated frames" behaviour but present it as "free starter loop you can
    keep playing or build on," with an obvious path to "make it live."
  - Likely a blend: deck = starting point; a clear, non-jargon control to go from "playing the
    starter set" to "generating my own."
- **Where do the NO-FAL / NO-CREDITS facts go?** They're real (cost matters) but shouldn't be
  badges. Maybe a single quiet line, or surfaced only when relevant (e.g. near the credits meter).
- **Signed-in vs anon**: today the Switch only shows for signed-in users and anon is pinned on.
  After the rename, both should just "start on a deck" — unify the two code paths.
- **Relationship to the other planned features**:
  - Decks overlap conceptually with **scene templates** (`scene-template-picker.tsx`) — consider
    merging "starter decks" and "scene templates" into one "start here" picker.
  - Ties into **Story Mode + Image Library** (`docs/story-mode-and-image-library.md`): a deck is
    essentially a curated, persisted image set — the same primitive as a saved story.
  - Lives next to the **Mood Field** redesign (`docs/mood-field-plan.md`) in the `style`/`scene`
    tabs; keep the top-of-panel area calm and un-jargony overall.

## Rough direction (non-binding)

Replace the `DEMO` switch + badges block with a simple **"Start from a deck"** chip row (no
mode switch, no billing badges). Decide in brainstorming whether decks remain a playback mode or
become scene-starter templates. Unify the anon/signed-in paths so everyone simply begins on a deck.

## Key files (when we build it)
- `apps/web/src/components/visualizer/controls/demo-mode-toggle.tsx` (+ `demo-badge.tsx`) — UI to rework.
- `apps/web/src/components/visualizer/controls/scene-template-picker.tsx` — candidate to merge with.
- `packages/shared/src/decks.ts` — deck definitions.
- `apps/server/src/session/session.ts` — `demoMode`/`demoDeck`/`triggerLibrary` + anon pinning.
- `apps/server/src/generation/library-provider.ts`, `scripts/library-manifest.json`,
  `packages/db/src/schema/image-library.db.ts` — the pre-generated content path.
