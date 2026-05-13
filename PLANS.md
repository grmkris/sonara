# Upcoming feature plans

Two features parked from brainstorms. **Review and green-light before implementation begins** — neither is a green light yet.

---

## 1. Clickable suggestion chips for prompt fields

### Context

`PromptInput` (`apps/web/src/components/visualizer/controls/prompt-input.tsx`) already has a per-field `PLACEHOLDERS` pool (subject / environment / mood / palette, 8 examples each) that **rotates as the input placeholder every 8 seconds**. Users see the examples but can't act on them — they have to retype.

The goal: surface those same pools as **clickable chips beneath each input**. One click commits the chip as the field value (same code path as Enter). The chip-row component already exists at scene-level — `SceneTemplatePicker` does this for entire scenes. We extend the same pattern to per-field suggestions.

### Approach

Add a chip row directly beneath each of the four field inputs. Click → `commit(field)` with the chip text. Match `SceneTemplatePicker`'s exact chip styling so the two patterns feel like one system.

The existing 8-item pools become the starter chips. Later we can grow them (and that's where `SCENE_TEMPLATES` becomes a richer source — each template contributes one chip per field).

### Files

#### Modify: `packages/shared/src/scene-templates.ts`

Export the four per-field suggestion pools so they're shared and not duplicated in `PromptInput`. New exported constant:

```ts
export const FIELD_SUGGESTIONS = {
  subject: [...],      // current PromptInput PLACEHOLDERS.subject + any from SCENE_TEMPLATES
  environment: [...],
  mood: [...],
  palette: [...],
} as const satisfies Record<"subject" | "environment" | "mood" | "palette", readonly string[]>;
```

Keep the union of: existing `PLACEHOLDERS` entries from `prompt-input.tsx` + the corresponding field from each `SCENE_TEMPLATES` row. Dedupe by string equality. Aim for ~12–16 per field at launch.

Re-export from `packages/shared/src/index.ts`.

#### Modify: `apps/web/src/components/visualizer/controls/prompt-input.tsx`

- Delete the local `PLACEHOLDERS` constant; import `FIELD_SUGGESTIONS` from `@music-visualizer/shared`.
- Beneath each `<Input>` (after the `<button>` with the `ArrowRight` icon, inside the field's `<div className="group relative flex flex-col gap-1.5">`), render a chip row. Cap to ~6 visible chips per field; show all on hover/expand later if needed.
- Click handler: `setDraft(d => ({ ...d, [key]: chip }))` then `commit(key)` — identical commit semantics to typing + Enter.
- Active-chip styling: matches `SceneTemplatePicker` — `border-b`, paper-coloured when the current `scene[key]` equals the chip text; stone otherwise.
- Replace `PLACEHOLDER_INTERVAL_MS` rotation with a **static** placeholder (first chip in pool, seeded random post-mount as today). The rotating placeholder was a workaround for invisible suggestions; with chips visible it becomes redundant visual noise.

Use the existing `SceneTemplatePicker` chip class as the template:

```tsx
className={cn(
  "font-sans text-[10px] uppercase tracking-[0.14em] transition-colors border-b px-1.5 py-0.5",
  active
    ? "text-[color:var(--paper)] border-[color:var(--paper)]"
    : "text-[color:var(--stone)] border-[color:var(--hairline)]/30 hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
)}
```

### Verification

1. `bun run dev:web`, open the visualizer.
2. Each of the four fields shows a row of ~6 chips beneath it.
3. Click a chip → input updates and a `scene.patch` fires (network tab shows the WS message), the same `field-sweep` animation triggers as on Enter.
4. The clicked chip flips to paper colour and stays active until a different value is committed.
5. Typing into a field still works exactly as before.
6. `bun run typecheck` + `bun run lint` clean.

### Scope discipline

- **Do not** add a "show more" expander in this pass — fixed 6 chips per field. Keep it minimal.
- **Do not** add chip categories (e.g. "by mood: melancholic / fierce"). One flat row.
- **Do not** persist chip click history. Stateless.

### Critical files

- `apps/web/src/components/visualizer/controls/prompt-input.tsx` — primary edit, current pools + commit logic.
- `apps/web/src/components/visualizer/controls/scene-template-picker.tsx` — chip styling reference, copy verbatim.
- `packages/shared/src/scene-templates.ts` — new `FIELD_SUGGESTIONS` constant.
- `packages/shared/src/index.ts` — re-export.

---

## 2. Pre-generated image library for demo / no-input fallback

### Context

Today every frame is generated on demand by fal (`apps/server/src/generation/fal-provider.ts`), debited from credits, and gated on the user having typed something useful. That's fine in production but terrible for **client demos**:

- 3–6 second cold-start before the first visual lands
- Quality varies (the user has to write a good prompt)
- Every demo session burns credits

The goal: a **curated library of ~240–1000 pre-generated images** organised into themed decks. When the user hasn't typed a subject (or when "Demo mode" is forced on), the server pulls from the library instead of calling fal. Zero latency, zero per-frame cost, guaranteed visual quality.

### Decks at launch

8 decks × 30 images = 240 images. Generation cost on flux-2-pro at ~$0.025/image ≈ **$6 one-off**.

| Deck key | Theme | Example prompts |
|---|---|---|
| `wild` | Wild Things — big cats, wolves, owls, foxes, stags, eagles | "a snow leopard staring through falling snow, cinematic", "a grey wolf at the edge of a pine forest at dusk" |
| `cute` | Cute Crush — pandas, red pandas, otters, capybaras, quokkas, golden retrievers | "a giant panda eating bamboo in soft morning light", "a capybara floating in a hot spring" |
| `sky` | Skyscapes — auroras, lightning storms, nebulae, galaxies | "aurora borealis over a frozen lake, long exposure", "the orion nebula in deep ultraviolet" |
| `liquid` | Liquid — ink-in-water, smoke, splashes, fire, embers, oil slicks | "black ink dispersing in clear water, macro", "fire embers floating against black, slow shutter" |
| `deep` | Deep — jellyfish, octopus, whales, coral, bioluminescence | "moon jellyfish drifting through dark blue water, bioluminescent", "an octopus across coral, chromatophores firing" |
| `bloom` | Bloom — cherry blossoms, lavender, autumn forests, mushrooms | "cherry blossom branch against an overcast sky", "a lavender field at golden hour" |
| `sacred` | Sacred — mandalas, cathedrals, stained glass, zen gardens | "sunlight through cathedral stained glass on stone floor", "a zen rock garden after rain" |
| `neon` | Neon — cyberpunk streets, vaporwave, holographic foil, retro arcades | "a neon-lit alley in rain, signs reflecting in puddles", "a holographic foil surface catching light" |

### Architecture

#### New DB table — `packages/db/src/schema/image-library.db.ts`

```ts
export const imageLibrary = pgTable(
  "image_library",
  {
    id: typeId("imageLibrary", "id").primaryKey()
      .$defaultFn(() => typeIdGenerator("imageLibrary"))
      .$type<ImageLibraryId>(),
    deck: text("deck").notNull(),               // "wild" | "cute" | ...
    prompt: text("prompt").notNull(),
    model: text("model").notNull(),             // "fal-ai/flux-2-pro" etc.
    seed: integer("seed"),
    url: text("url").notNull(),                 // CDN URL
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    palette: text("palette").array(),           // dominant colours (hex), for HUD hints
    status: text("status").notNull().default("active"),  // "active" | "rejected"
    ...baseEntityFields,
  },
  (t) => [
    index("image_library_deck_status_idx").on(t.deck, t.status),
  ],
);
```

Add `imageLibrary` typeid prefix to `packages/shared/src/typeid.ts`. Register the table in `packages/db/src/schema/index.ts`. Run `bun run db:generate` (when explicitly green-lit) to produce the migration.

#### New manifest — `apps/web/src/scripts/library-manifest.json`

A flat JSON of `{ deck: string, prompts: string[] }[]`. Source of truth for the seeding script. Hand-curated, version-controlled, reviewable in PRs.

#### New script — `apps/web/src/scripts/seed-library.ts`

Mirror `seed-credits.ts` shape. Args: `--deck <key>` (optional, defaults to all decks) `--limit <n>` (optional, cap per deck for testing).

Algorithm:
1. Load `library-manifest.json`.
2. For each `deck → prompts[]`, for each prompt:
   - Query `image_library` by `(deck, prompt)` — if a row exists, skip (idempotent).
   - Call fal with a deterministic seed (e.g. `hash(prompt)`).
   - Upload the returned image to object storage. Write the URL.
   - Extract dominant palette client-side via a small `node-vibrant`-equivalent or punt to the second pass.
   - Insert the row.
3. Print summary: `wild: 30 generated, 0 skipped, 0 failed`.

Run from `apps/web/` like the credits seeder so it reads the same `DATABASE_URL`.

#### Object storage — **open decision, must resolve before starting**

Three viable options:
- **Cloudflare R2** — cheapest egress, S3-compatible, Railway has no plugin so we'd add a token-based binding. Recommended.
- **AWS S3 + CloudFront** — fine, more setup, more invoices.
- **Vercel Blob** — easy if hosting on Vercel; we're on Railway, so leave it.

The manifest references images by `url` so the backend doesn't care which we pick. Decide before writing `seed-library.ts`.

#### Server-side selection — `apps/server/src/session/session.ts` + new `apps/server/src/generation/library-provider.ts`

New `LibraryProvider`:
- Constructor takes a `pg` client.
- `pick({ deck?, excludeIds? })` — returns one `image_library` row, random within `status = 'active'`. Optional deck filter; optional LRU exclusion (last 10 IDs served in this session).
- Reuses the same `pg` connection pattern as `CreditsService` (direct SQL, no Drizzle in apps/server).

Trigger-site change in `session.ts`:
- Before deciding whether to call `falProvider.generate(...)`, check **library-mode conditions**:
  1. `scene.subject` is empty *or* the session has `demoMode === true`.
  2. AND a deck can be inferred (either from `demoModeDeck` setting, or from the current scene template, or randomly).
- If true: call `libraryProvider.pick(deckKey)`, emit a `frame.ready` event with the library URL — **skip the credit debit entirely**. Skip the fal call. Skip the prompt expander.
- If false: existing fal path runs unchanged.

#### Credit bypass — `apps/server/src/credits/credits-service.ts`

No code change needed: the library path simply never calls `debitFrame`. Add a code-comment at the existing `debitFrame` callsite explaining the early-return condition for clarity, nothing else.

#### Client-side UI — `apps/web/src/components/visualizer/controls/`

Two surface points:
1. **Demo Mode toggle** — new component `demo-mode-toggle.tsx`, sits in the controls panel. Toggles `demoMode: boolean` in the visualizer store, sent to the server via `session.demoMode.set`. When on: a small "DEMO" badge in the HUD next to the connection status.
2. **Deck picker** — extend `SceneTemplatePicker` (or add a sibling `DeckPicker`) with the 8 deck chips. Clicking a deck while in demo mode pins selection to that deck. Same chip styling.

#### Curation tooling

A throwaway internal page at `apps/web/src/app/dev/library/page.tsx` (gated behind the same allowlist as the existing dev pages — check `packages/db/src/schema/allowlist.db.ts`):
- Grid view of all `image_library` rows.
- Click an image to toggle its `status` between `active` and `rejected`.
- Filter by deck.

No fancy admin framework, just a paginated list and a button.

### Cost model

- One-off generation: **~$6 for 240 images** on flux-2-pro at $0.025 each.
- Storage: 240 images × ~500 KB WebP = ~120 MB. R2 free tier covers this many times over.
- Egress: depends on traffic; R2 has free egress.
- Per-frame demo cost going forward: **$0**. (We're trading one-time spend for unlimited demo runs.)

### Open questions to resolve before implementation

1. **Object storage backend** — R2 vs S3 vs Vercel Blob. Default recommendation: R2.
2. **Image format** — WebP at 1024×1024 (the canvas downsamples anyway) vs PNG at full fal resolution. WebP recommended for size.
3. **Generation model** — stick with flux-2-pro (current), or test flux-2-pro-ultra for the library since cost is one-time? Suggest: spot-test 5 prompts at each model, pick the winner.
4. **Auto-curation vs manual** — generation will produce ~10% duds. Manual curation via the dev page is fine for 240 images. For 1000+, we'd want a "thumbs down" gesture during demos that flips `status` to `rejected`.
5. **Per-image licensing** — fal's TOS allows commercial use of generated images, but worth a 5-minute re-read before shipping to clients.

### Verification

1. Pick storage backend, set creds in `.env`.
2. Generate one deck only: `bun run apps/web/src/scripts/seed-library.ts --deck cute --limit 3`. Check three rows landed in `image_library` and three files in storage.
3. Open the dev curation page; confirm grid renders, status toggle persists.
4. Run the visualizer with no subject typed → should pick from the library, no credit debit observed in `credits` table.
5. Type a subject → should switch back to fal path, credit debited.
6. Toggle "Demo mode" on with a subject typed → forces library even with subject present.
7. Cancel a session and reopen — LRU should pick a different image from the same deck (no immediate repeats).
8. `bun run typecheck` + `bun run lint` clean across all packages.

### Scope discipline

- **No** real-time generation in the library — this is purely a static asset playback layer.
- **No** mixing library + fal frames in the same session by default. One mode at a time. (Power-user toggle can come later.)
- **No** Drizzle in `apps/server`. Use direct `pg` SQL in `library-provider.ts`, consistent with `credits-service.ts`.
- **No** new admin app. Curation page lives under `app/dev/` and reuses the existing allowlist gate.

### Critical files

- `packages/db/src/schema/image-library.db.ts` *(new)* — table definition.
- `packages/db/src/schema/index.ts` — register the new table.
- `packages/shared/src/typeid.ts` — add `imageLibrary` prefix.
- `apps/web/src/scripts/library-manifest.json` *(new)* — curated prompts.
- `apps/web/src/scripts/seed-library.ts` *(new)* — generation + upload + insert.
- `apps/server/src/generation/library-provider.ts` *(new)* — runtime selection.
- `apps/server/src/session/session.ts` — branch between fal and library at trigger site.
- `apps/web/src/components/visualizer/controls/demo-mode-toggle.tsx` *(new)* — UI toggle.
- `apps/web/src/components/visualizer/controls/scene-template-picker.tsx` or sibling — deck picker.
- `apps/web/src/app/dev/library/page.tsx` *(new)* — curation page.
- `packages/db/src/schema/allowlist.db.ts` — gating reference for the dev page.

---

## Order of operations (recommended)

Task 1 is half a day; task 2 is two to three days. If you green-light both, do **task 1 first** — small, low-risk, validates the chip pattern. Then task 2 — bigger, more decisions to make (storage, model), more files touched.
