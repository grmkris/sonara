import type { PromptQueueSnapshot, PromptView } from "./prompt-queue";

// Live, read-only view of a room the on-chain listener maintains and the
// control router serves to the projector overlay + audience page (tx counter,
// now-playing / up-next queue). A server-local singleton, same rationale as
// stageRooms — keeps the feature out of packages/api and the WS context.

export interface StageLiveState {
  txCount: number;
  // Total USDC paid into this room's prompts (6-dec units as string for JSON).
  revenueUnits: string;
  nowPlaying: PromptView | null;
  upNext: PromptView[];
}

const EMPTY: StageLiveState = {
  nowPlaying: null,
  revenueUnits: "0",
  txCount: 0,
  upNext: [],
};

class StageState {
  private readonly byRoom = new Map<
    string,
    { txCount: number; revenueUnits: bigint; queue: PromptQueueSnapshot }
  >();

  private entry(room: string) {
    let e = this.byRoom.get(room);
    if (!e) {
      e = {
        queue: { nowPlaying: null, upNext: [] },
        revenueUnits: 0n,
        txCount: 0,
      };
      this.byRoom.set(room, e);
    }
    return e;
  }

  // One on-chain action landed for this room (any of nudge/set/prompt).
  bump(room: string): void {
    this.entry(room).txCount += 1;
  }

  // A paid prompt landed: add what it pulled (base price + tip, USDC units).
  addRevenue(room: string, paidUnits: bigint): void {
    this.entry(room).revenueUnits += paidUnits;
  }

  setQueue(room: string, queue: PromptQueueSnapshot): void {
    this.entry(room).queue = queue;
  }

  get(room: string): StageLiveState {
    const e = this.byRoom.get(room);
    if (!e) {
      return EMPTY;
    }
    return {
      nowPlaying: e.queue.nowPlaying,
      revenueUnits: e.revenueUnits.toString(),
      txCount: e.txCount,
      upNext: e.queue.upNext,
    };
  }

  clear(room: string): void {
    this.byRoom.delete(room);
  }
}

export const stageState = new StageState();
