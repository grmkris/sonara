// Tiny page-wide "polaroid develop" softness applied to <html> when a
// scene field commits. Single in-flight class so rapid commits don't
// stack. Respects prefers-reduced-motion via the CSS rule itself.

const CLASS = "commit-flash";
const DURATION_MS = 320;

let active = false;

export function flashCommit(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (active) {
    return;
  }
  active = true;
  const root = document.documentElement;
  root.classList.add(CLASS);
  window.setTimeout(() => {
    root.classList.remove(CLASS);
    active = false;
  }, DURATION_MS);
}
