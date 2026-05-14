import type { VoiceField } from "@/stores/visualizer/voice-slice";

// Single source of truth for the four scene fields driving the left rail
// (PromptInput), the inline keyboard hints, and push-to-talk voice capture.
// Adding or renaming a field happens here and propagates through the app.
export const SCENE_FIELDS = [
  {
    key: "subject",
    index: "1",
    label: "SUBJECT",
    pttCode: "KeyS",
    pttLabel: "S",
    suggestions: [
      "a heron over grey water",
      "two lanterns drifting above a pond",
      "a figure walking into tall wheat",
      "a cat asleep in a library",
      "a crow perched on a broken mast",
      "a single violinist on a stage",
      "a dragon coiled in a sky",
      "a child holding a sparkler",
    ],
  },
  {
    key: "environment",
    index: "2",
    label: "SETTING",
    pttCode: "KeyE",
    pttLabel: "E",
    suggestions: [
      "ancient cathedral interior, afternoon",
      "winter sea, overcast sky",
      "empty rooftop at 3am",
      "zen courtyard after rain",
      "moonlit bedroom, drapes moving",
      "overgrown marble ruins at dusk",
      "neon alley, puddles reflecting signs",
      "endless salt flats at golden hour",
    ],
  },
  {
    key: "mood",
    index: "3",
    label: "MOOD",
    pttCode: "KeyM",
    pttLabel: "M",
    suggestions: [
      "melancholic, otherworldly",
      "hushed, reverent",
      "fierce, alone",
      "tender, hypnagogic",
      "euphoric, electric",
      "centered, still",
      "haunted, beautiful",
      "intimate, quiet",
    ],
  },
  {
    key: "palette",
    index: "4",
    label: "PALETTE",
    pttCode: "KeyP",
    pttLabel: "P",
    suggestions: [
      "iridescent teal and gold",
      "rust and bone",
      "moss green and dappled gold",
      "slate, foam, iron",
      "indigo and silver",
      "neon amber and deep blue",
      "sapphire, garnet, cold gold",
      "wet stone and moss",
    ],
  },
] as const satisfies ReadonlyArray<{
  key: VoiceField;
  index: string;
  label: string;
  pttCode: string;
  pttLabel: string;
  suggestions: readonly string[];
}>;

export type SceneFieldDef = (typeof SCENE_FIELDS)[number];
export type SceneFieldKey = SceneFieldDef["key"];

export const PTT_KEYMAP: Record<string, VoiceField> = Object.fromEntries(
  SCENE_FIELDS.map((f) => [f.pttCode, f.key]),
);

export const PTT_LABEL: Record<VoiceField, string> = Object.fromEntries(
  SCENE_FIELDS.map((f) => [f.key, f.pttLabel]),
) as Record<VoiceField, string>;
