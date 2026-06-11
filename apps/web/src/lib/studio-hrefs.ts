// /studio URL state builders — shared by the page and the mutations hook so
// navigation after a mutation (delete, create-from-selection, inspector
// close) stays consistent with the page's own routing.

export const setsHref = (setId?: string, frameId?: string): string => {
  const qs = new URLSearchParams({ tab: "sets" });
  if (setId) {
    qs.set("set", setId);
  }
  if (frameId) {
    qs.set("frame", frameId);
  }
  return `/studio?${qs.toString()}`;
};

export const recordingsHref = (
  recordingId?: string,
  frameId?: string
): string => {
  const qs = new URLSearchParams();
  if (recordingId) {
    qs.set("recording", recordingId);
  }
  if (frameId) {
    qs.set("frame", frameId);
  }
  const s = qs.toString();
  return s.length > 0 ? `/studio?${s}` : "/studio";
};
