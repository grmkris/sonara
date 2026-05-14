// Centralised keybindings for the visualiser. Each value is the literal
// passed to `useHotkey` (lowercase letter or named key like "Escape").
// Push-to-talk codes live in `lib/scene-fields.ts` instead because they
// belong to the field definitions.
export const HOTKEYS = {
  record: "r",
  fullscreen: "f",
  toggleUi: "h",
  hideUi: "Escape",
  reset: "Backspace",
} as const;

export type HotkeyName = keyof typeof HOTKEYS;
