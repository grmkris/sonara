// Centralised keybindings for the visualiser. Each value is the literal
// passed to `useHotkey` (lowercase letter or named key like "Escape").
// Push-to-talk codes live in `lib/scene-fields.ts` instead because they
// belong to the field definitions.
export const HOTKEYS = {
  fullscreen: "f",
  hideUi: "Escape",
  record: "r",
  reset: "Backspace",
  toggleUi: "h",
} as const;

export type HotkeyName = keyof typeof HOTKEYS;
