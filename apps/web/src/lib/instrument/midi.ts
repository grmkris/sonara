import type { MacroId } from "@sonara/shared";

export type MidiTarget = MacroId | "crossfade" | "freeze" | "next";
interface Mapping {
  channel: number;
  control: number;
  device: string;
  kind: number;
  target: MidiTarget;
}
const KEY = "sonara_midi_v1";
export class MidiInput {
  private access: MIDIAccess | null = null;
  private mappings: Mapping[] = [];
  private learning: MidiTarget | null = null;
  private lastClock = 0;
  private intervals: number[] = [];
  onValue: ((target: MidiTarget, value: number) => void) | null = null;
  onTempo: ((bpm: number) => void) | null = null;
  onLearned: ((target: MidiTarget) => void) | null = null;
  private controller = new AbortController();
  async start(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      throw new Error("MIDI is unavailable in this browser.");
    }
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    if (this.controller.signal.aborted) {
      return;
    }
    try {
      this.mappings = JSON.parse(
        localStorage.getItem(KEY) ?? "[]"
      ) as Mapping[];
    } catch {
      this.mappings = [];
    }
    const connected = new WeakSet<MIDIInput>();
    const connect = () => {
      for (const input of this.access?.inputs.values() ?? []) {
        if (connected.has(input)) {
          continue;
        }
        connected.add(input);
        input.addEventListener(
          "midimessage",
          (event) => {
            this.message(input.id, event as MIDIMessageEvent);
          },
          { signal: this.controller.signal }
        );
      }
    };
    connect();
    this.access.addEventListener("statechange", connect, {
      signal: this.controller.signal,
    });
  }
  learn(target: MidiTarget): void {
    this.learning = target;
  }
  private message(device: string, event: MIDIMessageEvent): void {
    const [status = 0, control = 0, raw = 0] = event.data ?? [];
    if (status === 248) {
      const now = event.timeStamp;
      const delta = now - this.lastClock;
      this.lastClock = now;
      if (delta > 2 && delta < 100) {
        this.intervals.push(delta);
        if (this.intervals.length > 96) {
          this.intervals.shift();
        }
        if (this.intervals.length >= 24) {
          this.onTempo?.(
            60_000 /
              ((24 * this.intervals.reduce((a, b) => a + b, 0)) /
                this.intervals.length)
          );
        }
      }
      return;
    }
    const kind = Math.floor(status / 16);
    if (kind !== 11 && kind !== 9) {
      return;
    }
    if (kind === 9 && raw === 0) {
      return;
    }
    const channel = status % 16;
    if (this.learning) {
      const target = this.learning;
      this.mappings = this.mappings.filter((m) => m.target !== target);
      this.mappings.push({ channel, control, device, kind, target });
      this.learning = null;
      localStorage.setItem(KEY, JSON.stringify(this.mappings));
      this.onLearned?.(target);
    }
    const mapping = this.mappings.find(
      (m) =>
        m.device === device &&
        m.channel === channel &&
        m.kind === kind &&
        m.control === control
    );
    if (mapping) {
      this.onValue?.(mapping.target, raw / 127);
    }
  }
  stop(): void {
    this.controller.abort();
    this.access = null;
  }
}
