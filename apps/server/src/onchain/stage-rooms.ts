import { randomBytes } from "node:crypto";

// Crowd-access runtime state, keyed by room code. Two binding flavors during
// the stages rollout:
//
//   stage-keyed   the code is the stage row's PERMANENT code (stage table) —
//                 printable QR, survives "new set" run swaps because the
//                 binding targets the durable stageId, not a run id.
//   legacy        pre-stages clients: a per-gig code minted at open, bound to
//                 the run's liveSessionId. Deleted in the post-W2 cleanup.
//
// In-memory either way — open/closed, allowPrompts and showQr are runtime
// flags ("runtime state is NOT persisted", rooms-and-roles rev 2): a deploy
// closes the crowd, the permanent code itself lives in Postgres.

export interface StageRoomBinding {
  allowPrompts: boolean;
  // Legacy runs only — resolved via registry.getByLiveSessionId.
  liveSessionId: string | null;
  // Whether the projector overlays the join QR. Host-toggled from the
  // console; defaults on at open so the room can fill, hidden once it has.
  showQr: boolean;
  // Durable runs — resolved via registry.getByStageId (survives new-set).
  stageId: string | null;
}

// Crockford-ish base32 without ambiguous chars (no I/L/O/U/0/1) — easy to read
// off a projector and type on a phone.
const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const ROOM_LEN = 5;

// Exported for the stage service: durable stage rows (stage-service.ts) mint
// their permanent codes from the same alphabet so projector/phone readability
// holds everywhere a code appears.
export const mintCode = (): string => {
  const bytes = randomBytes(ROOM_LEN);
  return Array.from(
    bytes,
    (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length] ?? ""
  ).join("");
};

interface StageStatus {
  room: string;
  allowPrompts: boolean;
  showQr: boolean;
}

class StageRooms {
  private readonly byRoom = new Map<string, StageRoomBinding>();
  private readonly roomByLive = new Map<string, string>();
  private readonly roomByStage = new Map<string, string>();
  // Fired after a room binding is dropped — lets the stage feed tear down its
  // sockets/state without the routers (or this file) importing the feed.
  private readonly closeListeners: ((room: string) => void)[] = [];

  // Open crowd access on a durable stage under its PERMANENT code. Re-opening
  // refreshes flags and re-shows the QR; the code never changes.
  openForStage(code: string, stageId: string, allowPrompts: boolean): void {
    const existing = this.byRoom.get(code);
    if (existing) {
      existing.allowPrompts = allowPrompts;
      existing.showQr = true;
      return;
    }
    this.byRoom.set(code, {
      allowPrompts,
      liveSessionId: null,
      showQr: true,
      stageId,
    });
    this.roomByStage.set(stageId, code);
  }

  // LEGACY: open a per-gig room for a run (pre-stages clients). Re-opening
  // the same session returns its existing code so a reconnecting projector
  // keeps its QR/URL. Deleted in the post-W2 cleanup.
  open(liveSessionId: string, allowPrompts: boolean): string {
    const existing = this.roomByLive.get(liveSessionId);
    if (existing) {
      const binding = this.byRoom.get(existing);
      if (binding) {
        binding.allowPrompts = allowPrompts;
        binding.showQr = true;
      }
      return existing;
    }
    let room = mintCode();
    while (this.byRoom.has(room)) {
      room = mintCode();
    }
    this.byRoom.set(room, {
      allowPrompts,
      liveSessionId,
      showQr: true,
      stageId: null,
    });
    this.roomByLive.set(liveSessionId, room);
    return room;
  }

  // Toggle the projector's join-QR overlay. Returns false for unknown rooms.
  setShowQr(room: string, show: boolean): boolean {
    const binding = this.byRoom.get(room);
    if (!binding) {
      return false;
    }
    binding.showQr = show;
    return true;
  }

  close(room: string): void {
    const binding = this.byRoom.get(room);
    if (binding?.liveSessionId) {
      this.roomByLive.delete(binding.liveSessionId);
    }
    if (binding?.stageId) {
      this.roomByStage.delete(binding.stageId);
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

  // Current stage binding for a LEGACY run, if it has one — lets a session
  // tell a (re)connecting projector about its open room.
  statusFor(liveSessionId: string): StageStatus | null {
    const room = this.roomByLive.get(liveSessionId);
    return room ? this.statusOf(room) : null;
  }

  // Same, keyed by the durable stage.
  statusForStage(stageId: string): StageStatus | null {
    const room = this.roomByStage.get(stageId);
    return room ? this.statusOf(room) : null;
  }

  private statusOf(room: string): StageStatus | null {
    const binding = this.byRoom.get(room);
    return binding
      ? { allowPrompts: binding.allowPrompts, room, showQr: binding.showQr }
      : null;
  }

  resolve(room: string): StageRoomBinding | undefined {
    return this.byRoom.get(room);
  }

  roomFor(liveSessionId: string): string | undefined {
    return this.roomByLive.get(liveSessionId);
  }

  roomForStage(stageId: string): string | undefined {
    return this.roomByStage.get(stageId);
  }
}

export const stageRooms = new StageRooms();
