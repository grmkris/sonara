import type {
  ClientScenePatch,
  NowPlaying,
  ServerEvent,
} from "@music-visualizer/shared";
import { getSceneTemplate } from "@music-visualizer/shared";
import type { Logger } from "../lib/logger";
import {
  parseVoiceIntent,
  type VoiceIntent,
  type VoiceIntentInput,
} from "../generation/voice-intent";

// Voice-related session state, extracted from Session so the 760-line god
// object shrinks and the debounce / LLM-dispatch / atmosphere-TTL lifecycle
// is inspectable as a single unit. No behaviour change vs the inline code
// that lived in session.ts up to commit 8b05834.

const VOICE_PHRASE_TTL_MS = 30_000;
const VOICE_BUFFER_MAX = 8;
// How long a voice-derived atmosphere clause stays "fresh" before we let
// drift fall through to the rotating static pool. Without this, one voice
// phrase sticks forever and every subsequent trigger reuses the identical
// drift clause — images stop subtly morphing between generations.
const ATMOSPHERE_TTL_MS = 15_000;
// Reset-via-voice shows the user a confirm toast before actually firing.
const RESET_CONFIRM_TTL_MS = 10_000;

export interface VoiceControllerDeps {
  logger: Logger;
  // Fan-out of server-initiated events (preset.suggest, confirm.reset, the
  // phase-6 voice.partial/parsed/applied stream).
  send: (event: ServerEvent) => void;
  // Current scene fields the LLM prompt needs as context.
  getSceneForIntent: () => VoiceIntentInput["scene"];
  // Live audio mood from the 5 Hz analyzer upstream.
  getLiveMood: () => { valence: number; arousal: number };
  getNowPlaying: () => NowPlaying | null;
  // Back-edges into Session for structural intent. Returns the next active
  // version so voice.applied can correlate to the generation that actually
  // fired (or omit it when the patch was below the trigger threshold).
  applyPatch: (patch: ClientScenePatch, origin: "voice") => void;
  commit: () => void;
  // Surface the version that the LAST applyPatch call kicked. Used so the
  // voice.applied event can carry triggeredVersion for the inspector UI.
  getActiveVersion: () => number;
}

export class VoiceController {
  private voiceBuffer: { text: string; at: number }[] = [];
  private currentAtmosphere: string | null = null;
  private currentAtmosphereAt = 0;
  private inFlight?: AbortController;
  // Monotonic phrase IDs let the client correlate voice.partial / voice.parsed
  // / voice.applied for the same utterance. New ID per applyVoice call (the
  // user has finished a thought) AND per applyPartial burst that comes from
  // a fresh recognition session.
  private nextPhraseId = 1;
  private currentPhraseId = 0;
  private lastPartialText = "";

  constructor(private readonly deps: VoiceControllerDeps) {}

  // Live transcript ingress from the browser's Web Speech API. partial.isFinal
  // = true means the recogniser is committing this segment; the controller
  // routes it through applyVoice (immediate LLM dispatch) once final, and just
  // mirrors interim text to the client trail. Idempotent on identical text
  // so quick repeated partials don't spam the WS.
  applyPartial(opts: {
    text: string;
    isFinal: boolean;
    confidence?: number;
    provider: "web-speech";
  }): void {
    // Web Speech already pause-detects before emitting `final` — no extra
    // server-side debounce is needed (would just add 1.5s of dead time).
    const text = opts.text.trim();
    if (text.length === 0) return;
    if (text === this.lastPartialText && !opts.isFinal) return;
    this.lastPartialText = text;
    // First partial of a new utterance opens a new phraseId. Once final lands
    // we'll keep the same id so parsed/applied chain correlates.
    if (this.currentPhraseId === 0) this.currentPhraseId = this.nextPhraseId++;
    this.deps.send({
      type: "voice.partial",
      phraseId: this.currentPhraseId,
      text,
      isFinal: opts.isFinal,
      ...(typeof opts.confidence === "number" ? { confidence: opts.confidence } : {}),
      provider: opts.provider,
    });
    if (opts.isFinal) {
      this.applyVoice(text);
    }
  }

  // Most recent unexpired voice phrase, or null. Used by trigger() as the
  // middle layer of drift stacking (after atmosphere, before the static pool).
  getLatestVoice(): string | null {
    const now = Date.now();
    for (let i = this.voiceBuffer.length - 1; i >= 0; i--) {
      const entry = this.voiceBuffer[i];
      if (!entry) continue;
      if (now - entry.at < VOICE_PHRASE_TTL_MS) return entry.text;
    }
    return null;
  }

  // Fresh LLM-synthesized atmosphere clause, or null if none or expired.
  // Consumed by trigger() as the highest-priority drift layer.
  getAtmosphere(): string | null {
    if (this.currentAtmosphere === null) return null;
    if (Date.now() - this.currentAtmosphereAt >= ATMOSPHERE_TTL_MS) return null;
    return this.currentAtmosphere;
  }

  applyVoice(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const now = Date.now();
    this.voiceBuffer = this.voiceBuffer.filter(
      (e) => now - e.at < VOICE_PHRASE_TTL_MS,
    );
    this.voiceBuffer.push({ text: trimmed, at: now });
    while (this.voiceBuffer.length > VOICE_BUFFER_MAX) {
      this.voiceBuffer.shift();
    }
    if (this.currentPhraseId === 0) this.currentPhraseId = this.nextPhraseId++;
    const phraseId = this.currentPhraseId;
    this.deps.logger.info(
      { text: trimmed, phraseId, bufferLen: this.voiceBuffer.length },
      "voice phrase",
    );

    // Dispatch immediately. Web Speech only emits `final` once it has already
    // pause-detected, so an additional server timer just adds dead time. If
    // a fresh utterance lands while the previous LLM call is still in flight,
    // `dispatch()` aborts the prior controller and supersedes it.
    this.dispatch(trimmed, phraseId).catch((err) => {
      this.deps.logger.warn({ err }, "dispatchVoice unhandled");
    });
    this.currentPhraseId = 0;
    this.lastPartialText = "";
  }

  // No-op shim — preserved on the public surface so a future "flush now"
  // signal (e.g., a manual send button) can wire to it without callers
  // re-deriving the buffer/partial fallback. With the debounce removed,
  // each `final` already dispatches immediately so there is nothing to
  // flush at the moment.
  commitNow(): void {
    this.deps.logger.debug("voice commit now: no-op (debounce removed)");
  }

  private async dispatch(phrase: string, phraseId: number): Promise<void> {
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    const history = this.voiceBuffer
      .slice()
      .reverse()
      .map((e) => e.text)
      .filter((t) => t !== phrase);

    const mood = this.deps.getLiveMood();
    const dispatchStartAt = Date.now();

    let intent: VoiceIntent;
    try {
      intent = await parseVoiceIntent(
        {
          phrase,
          scene: this.deps.getSceneForIntent(),
          voiceHistory: history,
          valence: mood.valence,
          arousal: mood.arousal,
          previousAtmosphere: this.currentAtmosphere,
          nowPlaying: this.deps.getNowPlaying(),
        },
        { signal: controller.signal, logger: this.deps.logger },
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        this.deps.logger.warn({ err }, "parseVoiceIntent threw");
      }
      return;
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined;
    }
    if (controller.signal.aborted) return;

    this.deps.logger.info(
      {
        phrase,
        phraseId,
        patch: intent.patch,
        commit: intent.commit,
        reset: intent.reset,
        preset: intent.preset,
        atmosphere: intent.atmosphere,
      },
      "voice intent parsed",
    );
    this.deps.send({
      type: "voice.parsed",
      phraseId,
      intent: {
        patch: intent.patch as Record<string, unknown>,
        commit: intent.commit,
        reset: intent.reset,
        preset: intent.preset,
        lookPreset: intent.lookPreset,
        atmosphere: intent.atmosphere,
      },
      latencyMs: Date.now() - dispatchStartAt,
    });

    // Always update atmosphere (flavors subsequent triggers).
    if (intent.atmosphere) {
      this.currentAtmosphere = intent.atmosphere;
      this.currentAtmosphereAt = Date.now();
    }

    // Visual-preset suggestion is advisory. The client gates on its own
    // presetMode === "llm" before actually applying it.
    if (intent.lookPreset) {
      this.deps.send({ type: "preset.suggest", name: intent.lookPreset });
    }

    // Reset wins but only after user confirms on the client.
    if (intent.reset) {
      this.deps.send({
        type: "confirm.reset",
        ttlMs: RESET_CONFIRM_TTL_MS,
        reason: `voice: "${phrase}"`,
      });
      return;
    }

    // Scene template fills blanks; explicit patch overrides template fields.
    let patch: ClientScenePatch = { ...intent.patch };
    if (intent.preset) {
      const template = getSceneTemplate(intent.preset);
      if (template) {
        patch = { ...template.scene, ...patch };
      } else {
        this.deps.logger.warn(
          { key: intent.preset },
          "unknown scene template from voice",
        );
      }
    }

    const versionBefore = this.deps.getActiveVersion();
    if (Object.keys(patch).length > 0) {
      this.deps.applyPatch(patch, "voice");
    }

    if (intent.commit) {
      this.deps.commit();
    }
    const versionAfter = this.deps.getActiveVersion();
    const triggered = versionAfter > versionBefore;
    this.deps.send({
      type: "voice.applied",
      phraseId,
      patch: patch as Record<string, unknown>,
      triggered,
      ...(triggered ? { triggeredVersion: versionAfter } : {}),
    });
  }

  reset(): void {
    this.inFlight?.abort();
    this.inFlight = undefined;
    this.voiceBuffer = [];
    this.currentAtmosphere = null;
    this.currentAtmosphereAt = 0;
  }

  close(): void {
    this.inFlight?.abort();
  }
}
