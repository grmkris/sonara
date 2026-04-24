"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Captures mic audio, downsamples to 16 kHz mono PCM16 in an AudioWorklet,
// and pumps base64 chunks (~100ms each) to the caller via onChunk. Used by
// voice-listen.tsx when the server reports sttProvider === "deepgram".
//
// Lifecycle: start() asks the user for mic permission, opens the
// AudioContext, loads the worklet module, and wires the graph. stop()
// releases the mic and closes the context. Reentrant — calling start() while
// already capturing is a no-op.

export interface UseAudioCaptureOpts {
  onChunk: (base64: string) => void;
  // Fires once after start() resolves, with the AudioContext's sampleRate
  // (NOT the downsampled 16k — that's implicit). Server uses this to know
  // what format the relay expects, even though we always emit 16 kHz.
  onStart?: (opts: { targetSampleRate: 16000 }) => void;
  onStop?: () => void;
  onError?: (err: unknown) => void;
}

export interface AudioCaptureState {
  active: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

const WORKLET_URL = "/audio-pcm-worklet.js";

function int16BufferToBase64(buf: ArrayBuffer): string {
  // btoa works on binary strings — reinterpret the bytes as a Uint8Array
  // first. Chunked to keep String.fromCharCode argument count reasonable.
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + CHUNK));
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

export function useAudioCapture(opts: UseAudioCaptureOpts): AudioCaptureState {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const onChunkRef = useRef(opts.onChunk);
  const onStartRef = useRef(opts.onStart);
  const onStopRef = useRef(opts.onStop);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onChunkRef.current = opts.onChunk;
  }, [opts.onChunk]);
  useEffect(() => {
    onStartRef.current = opts.onStart;
  }, [opts.onStart]);
  useEffect(() => {
    onStopRef.current = opts.onStop;
  }, [opts.onStop]);
  useEffect(() => {
    onErrorRef.current = opts.onError;
  }, [opts.onError]);

  const stop = useCallback(() => {
    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      void ctxRef.current.close();
    }
    nodeRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    setActive(false);
    onStopRef.current?.();
  }, []);

  const start = useCallback(async () => {
    if (active) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      const name = err instanceof Error ? (err.name || err.message) : "mic";
      setError(name);
      onErrorRef.current?.(err);
      return;
    }
    streamRef.current = stream;

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch (err) {
      stop();
      setError("audio-context");
      onErrorRef.current?.(err);
      return;
    }
    ctxRef.current = ctx;

    try {
      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (err) {
      stop();
      setError("worklet-load");
      onErrorRef.current?.(err);
      return;
    }

    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(ctx, "pcm-downsampler", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
    } catch (err) {
      stop();
      setError("worklet-init");
      onErrorRef.current?.(err);
      return;
    }

    node.port.onmessage = (ev: MessageEvent) => {
      const buf = ev.data as ArrayBuffer;
      if (!(buf instanceof ArrayBuffer)) return;
      try {
        const b64 = int16BufferToBase64(buf);
        onChunkRef.current(b64);
      } catch (err) {
        onErrorRef.current?.(err);
      }
    };

    const source = ctx.createMediaStreamSource(stream);
    source.connect(node);
    nodeRef.current = node;
    sourceRef.current = source;

    setActive(true);
    onStartRef.current?.({ targetSampleRate: 16000 });
  }, [active, stop]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { active, error, start, stop };
}
