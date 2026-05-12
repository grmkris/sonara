// Hand-curated scene templates. One click loads the full set of text fields
// (subject / environment / mood / palette). intensity + image-feel sliders
// + render presets persist so a template change doesn't re-tune reactivity.
//
// Named `SCENE_TEMPLATES` (not `PRESETS`) to avoid collision with the
// render-preset system in apps/web/src/lib/render/presets, which is a
// separate concept for shader style selection.

export interface SceneTemplateScene {
  subject: string;
  environment: string;
  mood: string;
  palette: string;
}

export interface SceneTemplate {
  key: string;
  label: string;
  scene: SceneTemplateScene;
}

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    key: "forest",
    label: "forest",
    scene: {
      subject: "a deer at the edge of a clearing",
      environment: "ancient mossed forest, dawn light",
      mood: "hushed, reverent",
      palette: "moss green and dappled gold",
    },
  },
  {
    key: "ocean",
    label: "ocean",
    scene: {
      subject: "a single figure walking into the waves",
      environment: "winter sea, overcast sky",
      mood: "solitary, vast",
      palette: "slate grey and pearl",
    },
  },
  {
    key: "cathedral",
    label: "cathedral",
    scene: {
      subject: "stained glass light on stone",
      environment: "empty cathedral interior, afternoon",
      mood: "sacred, still",
      palette: "sapphire, garnet, cold gold",
    },
  },
  {
    key: "temple",
    label: "temple",
    scene: {
      subject: "a lotus on still water",
      environment: "zen temple courtyard after rain",
      mood: "centered, quiet",
      palette: "wet stone and moss",
    },
  },
  {
    key: "ruins",
    label: "ruins",
    scene: {
      subject: "ivy climbing a broken marble column",
      environment: "overgrown ruins at dusk",
      mood: "haunted, beautiful",
      palette: "bone white and deep green",
    },
  },
  {
    key: "bedroom",
    label: "bedroom",
    scene: {
      subject: "a figure floating above a bed",
      environment: "moonlit bedroom, drapes moving",
      mood: "hypnagogic, tender",
      palette: "indigo and silver",
    },
  },
  {
    key: "rooftop",
    label: "rooftop",
    scene: {
      subject: "two figures watching the skyline",
      environment: "rooftop at night, city below",
      mood: "intimate, electric",
      palette: "neon amber and deep blue",
    },
  },
  {
    key: "winter-sea",
    label: "winter sea",
    scene: {
      subject: "a lighthouse above a stormy cove",
      environment: "winter cliffs, crashing waves",
      mood: "fierce, alone",
      palette: "slate, foam, iron",
    },
  },
] as const;

export function getSceneTemplate(key: string): SceneTemplate | null {
  const k = key.trim().toLowerCase();
  return SCENE_TEMPLATES.find((p) => p.key === k) ?? null;
}

export const SCENE_TEMPLATE_KEYS: readonly string[] = SCENE_TEMPLATES.map(
  (p) => p.key,
);
