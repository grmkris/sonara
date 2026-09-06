import { z } from "zod";

import { InstrumentConfig } from "./instrument";
import { LookProfileIdSchema } from "./typeid";

// A look profile's render config — the apps/web `PresetConfig` serialized to a
// JSON bag. Validated loosely-but-bounded (numbers or short number tuples for
// the RGB triplets, capped key count) so the server never stores unbounded
// junk while staying decoupled from the web's exact PresetConfig field list.
// The renderer BASE-backfills on apply, so missing/extra keys are harmless.
export const LegacyLookConfig = z
  .record(z.string().max(40), z.union([z.number(), z.array(z.number()).max(4)]))
  .refine((o) => Object.keys(o).length <= 64, {
    message: "look config has too many keys",
  });
export const LookConfig = z.union([InstrumentConfig, LegacyLookConfig]);
export type LookConfig = z.infer<typeof LookConfig>;

export const LookVisibility = z.enum(["private", "unlisted", "public"]);
export type LookVisibility = z.infer<typeof LookVisibility>;

// Wire shape returned by looks.list / looks.get and stored per-account.
export const LookProfile = z.object({
  config: LookConfig,
  createdAt: z.coerce.date(),
  id: LookProfileIdSchema,
  name: z.string(),
  visibility: LookVisibility,
});
export type LookProfile = z.infer<typeof LookProfile>;
