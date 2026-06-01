// Small dependency-free time formatters shared across /play timeline +
// /studio. Kept in /lib so the same definitions don't drift between
// callers.

/**
 * Relative time from a past Date — "just now", "Nm ago", "Nh ago", "Nd ago".
 * Used for thumbnail tooltips and session card labels.
 */
export function formatAgo(date: Date): string {
  const now = Date.now();
  const ms = now - date.getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Milliseconds → MM:SS (with HHh prefix for sessions >60 min). Used for
 * the studio timeline tickmarks + per-frame tMs labels.
 */
export function formatMmSs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mmss = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return h > 0 ? `${h}h ${mmss}` : mmss;
}

/**
 * Milliseconds → human duration ("5s", "3m 12s"). Used for session-card
 * duration labels in the sessions sidebar.
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
