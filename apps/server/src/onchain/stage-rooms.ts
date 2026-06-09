import { randomBytes } from "node:crypto";

// Binds a short, shareable room code to one live session. The session owner
// "opens the stage" (control.openStage) to mint a code; the on-chain listener
// resolves room -> liveSessionId here, then looks up the live Session via the
// SessionManager registry. Kept as a server-local singleton (NOT in the oRPC
// context) so this feature touches neither packages/api nor the WS context.
//
// In-memory and ephemeral — a room lives only while its session does; closing
// the stage or the session disappearing just drops the binding. That's fine:
// the stage is a live-performance surface, not durable state.

export interface StageRoomBinding {
  liveSessionId: string;
  allowPrompts: boolean;
}

// Crockford-ish base32 without ambiguous chars (no I/L/O/U/0/1) — easy to read
// off a projector and type on a phone.
const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const ROOM_LEN = 5;

const mintCode = (): string => {
  const bytes = randomBytes(ROOM_LEN);
  return Array.from(
    bytes,
    (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length] ?? ""
  ).join("");
};

class StageRooms {
  private readonly byRoom = new Map<string, StageRoomBinding>();
  private readonly roomByLive = new Map<string, string>();

  // Open (or re-open) a stage for a live session. Re-opening the same session
  // returns its existing code so a reconnecting projector keeps its QR/URL.
  open(liveSessionId: string, allowPrompts: boolean): string {
    const existing = this.roomByLive.get(liveSessionId);
    if (existing) {
      const binding = this.byRoom.get(existing);
      if (binding) {
        binding.allowPrompts = allowPrompts;
      }
      return existing;
    }
    let room = mintCode();
    while (this.byRoom.has(room)) {
      room = mintCode();
    }
    this.byRoom.set(room, { allowPrompts, liveSessionId });
    this.roomByLive.set(liveSessionId, room);
    return room;
  }

  close(room: string): void {
    const binding = this.byRoom.get(room);
    if (binding) {
      this.roomByLive.delete(binding.liveSessionId);
    }
    this.byRoom.delete(room);
  }

  resolve(room: string): StageRoomBinding | undefined {
    return this.byRoom.get(room);
  }

  roomFor(liveSessionId: string): string | undefined {
    return this.roomByLive.get(liveSessionId);
  }
}

export const stageRooms = new StageRooms();
