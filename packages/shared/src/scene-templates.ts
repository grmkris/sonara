// Hand-curated scene templates. One click loads a single evocative prompt
// sentence. Treatment knobs (softness/surrealness/abstraction/stability/
// intensity) and render presets persist so a template change doesn't re-tune
// reactivity.
//
// Named `SCENE_TEMPLATES` (not `PRESETS`) to avoid collision with the
// render-preset system in apps/web/src/lib/render/presets, which is a
// separate concept for shader style selection.

export interface SceneTemplate {
  key: string;
  label: string;
  prompt: string;
}

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    key: "forest",
    label: "forest",
    prompt:
      "a deer at the edge of a clearing in ancient mossed forest at dawn, hushed and reverent, moss green and dappled gold",
  },
  {
    key: "ocean",
    label: "ocean",
    prompt:
      "a single figure walking into the waves of a winter sea under an overcast sky, solitary and vast, slate grey and pearl",
  },
  {
    key: "cathedral",
    label: "cathedral",
    prompt:
      "stained glass light on stone in an empty cathedral interior in the afternoon, sacred and still, sapphire and garnet and cold gold",
  },
  {
    key: "temple",
    label: "temple",
    prompt:
      "a lotus on still water in a zen temple courtyard after rain, centered and quiet, wet stone and moss",
  },
  {
    key: "ruins",
    label: "ruins",
    prompt:
      "ivy climbing a broken marble column in overgrown ruins at dusk, haunted and beautiful, bone white and deep green",
  },
  {
    key: "bedroom",
    label: "bedroom",
    prompt:
      "a figure floating above a bed in a moonlit bedroom with drapes moving, hypnagogic and tender, indigo and silver",
  },
  {
    key: "rooftop",
    label: "rooftop",
    prompt:
      "two figures watching the skyline from a rooftop at night with the city below, intimate and electric, neon amber and deep blue",
  },
  {
    key: "winter-sea",
    label: "winter sea",
    prompt:
      "a lighthouse above a stormy cove on winter cliffs with crashing waves, fierce and alone, slate and foam and iron",
  },
  {
    key: "cyborg",
    label: "cyborg",
    prompt:
      "a chrome android dancing in a fog-filled neon club under strobing lights, electric and relentless, magenta and cyan and mirror-chrome",
  },
] as const;

export function getSceneTemplate(key: string): SceneTemplate | null {
  const k = key.trim().toLowerCase();
  return SCENE_TEMPLATES.find((p) => p.key === k) ?? null;
}

export const SCENE_TEMPLATE_KEYS: readonly string[] = SCENE_TEMPLATES.map(
  (p) => p.key
);
