// Small dependency-free time formatters shared across /play timeline +
// /studio. Kept in /lib so the same definitions don't drift between
// callers.

/**
 * Milliseconds → MM:SS (with HHh prefix for sessions >60 min). Used for
 * the studio timeline tickmarks + per-frame tMs labels.
 */
export const formatMmSs = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mmss = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return h > 0 ? `${h}h ${mmss}` : mmss;
};

/**
 * Milliseconds → human duration ("5s", "3m 12s"). Used for session-card
 * duration labels in the sessions sidebar.
 */
export const formatDuration = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) {
    return `${s}s`;
  }
  return `${m}m ${s.toString().padStart(2, "0")}s`;
};
