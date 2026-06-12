import type { PromptQueueSnapshot, PromptView } from "./prompt-queue";

// Live, read-only view of a room that stage-actions maintains and the
// control router serves to the projector overlay + audience page (activity
// counter, now-playing / up-next queue). A server-local singleton, same
// rationale as stageRooms — keeps the feature out of packages/api and the WS
// context.

export interface StageLiveState {
  tapCount: number;
  nowPlaying: PromptView | null;
  upNext: PromptView[];
}

const EMPTY: StageLiveState = {
  nowPlaying: null,
  tapCount: 0,
  upNext: [],
};

class StageState {
  private readonly byRoom = new Map<
    string,
    { tapCount: number; queue: PromptQueueSnapshot }
  >();

  private entry(room: string) {
    let e = this.byRoom.get(room);
    if (!e) {
      e = {
        queue: { nowPlaying: null, upNext: [] },
        tapCount: 0,
      };
      this.byRoom.set(room, e);
    }
    return e;
  }

  // One crowd action landed for this room (any of nudge/set/prompt).
  bump(room: string): void {
    this.entry(room).tapCount += 1;
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
      tapCount: e.tapCount,
      upNext: e.queue.upNext,
    };
  }

  clear(room: string): void {
    this.byRoom.delete(room);
  }
}

export const stageState = new StageState();
