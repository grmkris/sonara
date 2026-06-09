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
  // Fired after a room binding is dropped — lets the stage feed tear down its
  // sockets/state without control.router (or this file) importing the feed.
  private readonly closeListeners: ((room: string) => void)[] = [];

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
    if (binding) {
      for (const listener of this.closeListeners) {
        listener(room);
      }
    }
  }

  onClose(listener: (room: string) => void): void {
    this.closeListeners.push(listener);
  }

  // Current stage binding for a live session, if it has one — lets a session
  // tell a (re)connecting projector about its open room.
  statusFor(liveSessionId: string): { room: string; allowPrompts: boolean } | null {
    const room = this.roomByLive.get(liveSessionId);
    if (!room) {
      return null;
    }
    const binding = this.byRoom.get(room);
    return binding ? { allowPrompts: binding.allowPrompts, room } : null;
  }

  resolve(room: string): StageRoomBinding | undefined {
    return this.byRoom.get(room);
  }

  roomFor(liveSessionId: string): string | undefined {
    return this.roomByLive.get(liveSessionId);
  }
}

export const stageRooms = new StageRooms();
