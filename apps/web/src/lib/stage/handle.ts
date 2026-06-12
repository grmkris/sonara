// Per-device crowd identity for the stage remote: a short random handle
// (e.g. K7QX) minted once and kept in localStorage. Sent as `from` on every
// stage RPC; the server treats it as an opaque ≤12-char string — it's a
// display + queue-identity key, never an account. Same alphabet as room
// codes (no 0/O/1/I/L ambiguity).

const HANDLE_KEY = "sonara.stage.handle";
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const LENGTH = 4;

const mint = (): string => {
  let out = "";
  for (let i = 0; i < LENGTH; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
};

export const getOrCreateStageHandle = (): string => {
  if (typeof window === "undefined") {
    return "anon";
  }
  const existing = window.localStorage.getItem(HANDLE_KEY);
  if (existing && /^[\w-]{1,12}$/u.test(existing)) {
    return existing;
  }
  const handle = mint();
  window.localStorage.setItem(HANDLE_KEY, handle);
  return handle;
};
