"use client";

import type { EngineConfig, PerformanceControlFrame } from "@sonara/shared";
import { Camera, Circle, Expand, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { StageWire } from "@/components/stage/stage-wire";
import { StudioCreateNav } from "@/components/studio/studio-sidebar-tabs";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UserControls } from "@/components/user-controls";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";
import { coalesce } from "@/lib/debounce";
import { CameraInput } from "@/lib/instrument/camera";
import { experienceLabel } from "@/lib/instrument/catalog";
import { MidiInput } from "@/lib/instrument/midi";
import type { MidiTarget } from "@/lib/instrument/midi";
import { TakeRecorder } from "@/lib/instrument/recorder";
import { InstrumentRuntime } from "@/lib/instrument/runtime";
import { rpcClient } from "@/lib/orpc";
import type { SessionSend } from "@/lib/session-actions";
import {
  hydrateInstrument,
  useInstrumentStore,
} from "@/stores/instrument-store";
import { useVisualizerStore } from "@/stores/visualizer";

import { EngineControls, ExperienceControls } from "./experience-controls";
import { ExperienceMood } from "./experience-mood";
import { InstrumentPanel } from "./instrument-panel";

const fullscreen = async () => {
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    toast.error("Fullscreen is unavailable.");
  }
};

const isSleeping = (
  awake: boolean,
  panel: string | null,
  audioSource: AudioSource,
  recording: boolean
) => !awake && !panel && audioSource.type !== "none" && !recording;
const midiLabel = (target: string) =>
  ({ crossfade: "Image presence", energy: "Intensity" })[target] ?? target;
const SessionLine = ({
  recording,
  tracking,
  name,
  status,
}: {
  recording: boolean;
  tracking: string;
  name: string;
  status: string;
}) => (
  <div className="experience-session-line experience-chrome" aria-live="polite">
    <span>{recording ? "● capturing this moment" : name}</span>
    <span>
      {tracking === "off"
        ? "Drag to pull the light."
        : "Move to pull. Pinch to grab."}
    </span>
    {status !== "ready" && <span>{status}</span>}
  </div>
);

const LookControls = ({
  advanced,
  config,
  setConfig,
  deck,
  setDeck,
  send,
  open,
  onSave,
}: {
  advanced: boolean;
  config: EngineConfig;
  setConfig: (config: EngineConfig) => void;
  deck: "a" | "b";
  setDeck: (deck: "a" | "b") => void;
  send: SessionSend;
  open: boolean;
  onSave: () => Promise<void>;
}) => {
  const [lookTab, setLookTab] = useState("looks");
  return (
    <>
      {advanced ? (
        <>
          {config.version === 1 ? (
            <EngineControls
              config={config}
              onChange={setConfig}
              deck={deck}
              onDeck={setDeck}
            />
          ) : (
            <ExperienceControls config={config} onChange={setConfig} />
          )}
          <ExperienceMood send={send} open={open} />
          <Button
            variant="outline"
            onClick={() => {
              void onSave();
            }}
          >
            Save this look
          </Button>
        </>
      ) : (
        <Tabs
          value={lookTab}
          onValueChange={(value) => setLookTab(String(value))}
          className="experience-look-tabs"
        >
          <TabsList aria-label="Look options" className="w-full">
            <TabsTrigger value="looks">Looks</TabsTrigger>
            <TabsTrigger value="image">Image</TabsTrigger>
          </TabsList>
          <TabsContent value="looks">
            {config.version === 1 ? (
              <EngineControls config={config} onChange={setConfig} />
            ) : (
              <ExperienceControls
                config={config}
                onChange={setConfig}
                compact
              />
            )}
          </TabsContent>
          <TabsContent value="image" keepMounted>
            <ExperienceMood
              send={send}
              open={open && lookTab === "image"}
              compact
            />
            {config.version !== 1 && (
              <Field className="mt-6">
                <FieldLabel htmlFor="play-image-presence">
                  Image presence
                </FieldLabel>
                <Slider
                  id="play-image-presence"
                  aria-label="Image presence"
                  min={0}
                  max={1}
                  step={0.01}
                  value={[config.reveal]}
                  onValueChange={(value) =>
                    setConfig({
                      ...config,
                      reveal: Array.isArray(value) ? (value[0] ?? 0.5) : value,
                    })
                  }
                />
              </Field>
            )}
          </TabsContent>
        </Tabs>
      )}
    </>
  );
};

export const InstrumentSurface = ({
  audioSource,
  setAudioSource,
  remoteControl,
  send,
  workspace = "play",
}: {
  workspace?: "play" | "create" | "stage";
  audioSource: AudioSource;
  setAudioSource: (source: AudioSource) => void;
  remoteControl?: ReactNode;
  send: SessionSend;
}) => {
  const advanced = workspace !== "play";
  const config = useInstrumentStore((s) => s.config);
  const setConfig = useInstrumentStore((s) => s.setConfig);
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<InstrumentRuntime | null>(null);
  const camera = useRef<CameraInput | null>(null);
  const midi = useRef<MidiInput | null>(null);
  const recorder = useRef<TakeRecorder | null>(null);
  const pointer = useRef<PerformanceControlFrame | null>(null);
  const recordBusy = useRef(false);
  const deckRef = useRef<"a" | "b">("a");
  const [deck, setDeck] = useState<"a" | "b">("a");
  const [tracking, setTracking] = useState<"off" | "hands" | "body">("off");
  const [recording, setRecording] = useState(false);
  const [capturedId, setCapturedId] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [status, setStatus] = useState("warming the instrument");
  const [stats, setStats] = useState({ bpm: 0, fps: 0, time: 0 });
  const [recovery, setRecovery] = useState(0);
  const [panel, setPanel] = useState<"music" | "mood" | "interact" | null>(
    null
  );
  const [awake, setAwake] = useState(true);
  const awakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trackingStatus, setTrackingStatus] = useState("Camera off");
  const lastVision = useRef(0);
  const markers = useRef<(HTMLSpanElement | null)[]>([]);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const hidden = isSleeping(awake, panel, audioSource, recording);
  const wake = useCallback(() => {
    setAwake(true);
    if (awakeTimer.current) {
      clearTimeout(awakeTimer.current);
    }
    awakeTimer.current = setTimeout(() => setAwake(false), 4000);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    for (const type of ["pointermove", "pointerdown", "focusin", "keydown"]) {
      window.addEventListener(type, wake, { signal: controller.signal });
    }
    return () => controller.abort();
  }, [wake]);
  useEffect(
    () => () => {
      if (awakeTimer.current) {
        clearTimeout(awakeTimer.current);
      }
    },
    []
  );
  const [midiReady, setMidiReady] = useState(false);
  const [midiClock, setMidiClock] = useState(false);
  const midiClockRef = useRef(false);
  midiClockRef.current = midiClock;
  deckRef.current = deck;
  useEffect(() => {
    hydrateInstrument();
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    let disposed = false;
    let raf = 0;
    let frames = 0;
    let lastStats = performance.now();
    let origin = 0;
    let scale = 1;
    let slowWindows = 0;
    const instance = new InstrumentRuntime(
      element,
      useInstrumentStore.getState().config,
      recovery > 0
    );
    runtime.current = instance;
    setTracking("off");
    setMidiReady(false);
    setFrozen(false);
    setRecording(false);
    recorder.current = null;
    const preview = document.createElement("canvas");
    preview.width = 80;
    preview.height = 45;
    let lastPreview = 0;
    instance.renderer.onPresented = () => {
      if (performance.now() - lastPreview < 1500) {
        return;
      }
      lastPreview = performance.now();
      try {
        // Read immediately after presentation: WebGL clears its drawing buffer
        // between animation frames when preserveDrawingBuffer is disabled.
        preview.getContext("2d")?.drawImage(element, 0, 0, 80, 45);
        const url = preview.toDataURL("image/jpeg", 0.35);
        if (url.length <= 4096) {
          send({ type: "frame.report", url });
        }
      } catch {
        /* A thumbnail must not interrupt the performance. */
      }
    };
    instance.onConfig = (next) => {
      useInstrumentStore.setState({ config: next });
    };
    instance.renderer.onLost = () => {
      setStatus("graphics connection lost — reconnecting");
      setRecovery((n) => Math.min(1, n + 1));
    };
    const unsubscribe = useInstrumentStore.subscribe((state, prev) => {
      if (state.config !== prev.config && state.config !== instance.config) {
        if (
          recorder.current &&
          state.config.version !== instance.config.version
        ) {
          useInstrumentStore.setState({ config: instance.config });
          toast(
            "Finish this capture before applying a mood from a different renderer."
          );
          return;
        }
        instance.configure(state.config);
      }
    });
    let previousImage = "";
    const imageSubscription = useVisualizerStore.subscribe((state) => {
      const url = state.currentFrame;
      if (url && url !== previousImage) {
        previousImage = url;
        void (async () => {
          try {
            await instance.renderer.setImage(url);
            instance.onEvent?.({ kind: "image", time: instance.elapsed, url });
          } catch {
            toast.error("This image could not be loaded.");
          }
        })();
      }
    });
    const animate = (now: number) => {
      if (disposed) {
        return;
      }
      const audio = getCurrentAudioEngine()?.latest;
      if (audio) {
        instance.setAudio(audio);
      }
      if (pointer.current) {
        instance.setControls(pointer.current);
      }
      const rect = element.getBoundingClientRect();
      const density = Math.min(
        devicePixelRatio,
        1.5,
        1920 / Math.max(1, rect.width),
        1080 / Math.max(1, rect.height)
      );
      instance.renderer.resize(
        rect.width * density,
        rect.height * density,
        scale
      );
      try {
        instance.advance((now - origin) / 1000);
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "The instrument could not render."
        );
        return;
      }
      for (const [index, marker] of markers.current.entries()) {
        if (!marker) {
          continue;
        }
        const point = instance.controls.attractors[index];
        marker.style.opacity = String(point ? Math.abs(point.force) : 0);
        if (point) {
          marker.style.left = `${point.x * 100}%`;
          marker.style.top = `${(1 - point.y) * 100}%`;
          marker.dataset.grabbed = String(point.force > 0.92);
        }
      }
      if (
        camera.current &&
        lastVision.current > 0 &&
        now - lastVision.current > 700
      ) {
        setTrackingStatus("Tracking paused — keep your hands in view");
      }
      frames += 1;
      if (now - lastStats > 1000) {
        const fps = (frames * 1000) / (now - lastStats);
        setStats({
          bpm: instance.transport.bpm,
          fps: Math.round(fps),
          time: instance.elapsed,
        });
        if (fps < 45) {
          slowWindows += 1;
        } else {
          slowWindows = Math.max(0, slowWindows - 1);
        }
        if (slowWindows >= 3 && scale > 0.5) {
          scale = Math.max(0.5, scale - 0.15);
          slowWindows = 0;
        }
        frames = 0;
        lastStats = now;
      }
      raf = requestAnimationFrame(animate);
    };
    void (async () => {
      try {
        await instance.init();
        if (disposed) {
          return;
        }
        const imageUrl = useVisualizerStore.getState().currentFrame;
        if (imageUrl) {
          await instance.renderer.setImage(imageUrl);
          previousImage = imageUrl;
        }
        setStatus(recovery > 0 ? "compatibility graphics · ready" : "ready");
        origin = performance.now();
        raf = requestAnimationFrame(animate);
      } catch (error) {
        if (!disposed) {
          if (recovery === 0) {
            setRecovery(1);
          } else {
            setStatus(
              error instanceof Error
                ? error.message
                : "Graphics unavailable. Please reload to reconnect."
            );
          }
        }
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unsubscribe();
      imageSubscription();
      camera.current?.stop();
      camera.current = null;
      midi.current?.stop();
      midi.current = null;
      if (recorder.current) {
        void recorder.current.stop();
      }
      instance.dispose();
      runtime.current = null;
    };
  }, [recovery, send]);

  useEffect(() => {
    const relay = coalesce(() => {
      send({ config: useInstrumentStore.getState().config, type: "look.set" });
    }, 100);
    relay();
    const unsubscribe = useInstrumentStore.subscribe((state, prev) => {
      if (state.config !== prev.config) {
        relay();
      }
    });
    return () => {
      unsubscribe();
      relay.flush();
    };
  }, [send]);
  const toggleCamera = async (mode: "off" | "hands" | "body") => {
    camera.current?.stop();
    camera.current = null;
    runtime.current?.renderer.clearMask();
    recorder.current?.recordMask(new Uint8Array(0), 0, 0);
    runtime.current?.setControls({
      attractors: [],
      expansion: 0.5,
      rotation: 0,
      time: performance.now() / 1000,
    });
    if (mode === "off" || tracking === mode) {
      setTrackingStatus("Camera off");
      setTracking("off");
      return;
    }
    const input = new CameraInput();
    camera.current = input;
    input.onError = (message) => {
      if (camera.current !== input) {
        return;
      }
      setTracking("off");
      setTrackingStatus(message);
      camera.current = null;
      runtime.current?.renderer.clearMask();
      recorder.current?.recordMask(new Uint8Array(0), 0, 0);
      toast.error(message);
    };
    input.onFrame = (frame) => {
      lastVision.current = performance.now();
      if (!pointer.current) {
        runtime.current?.setControls(frame.control);
      }
      setTrackingStatus(
        frame.control.attractors.length > 0
          ? `${mode === "body" ? "Body" : "Hands"} tracked${frame.control.attractors.some((point) => point.force > 0.92) ? " · pinching" : ""}`
          : `Looking for your ${mode === "body" ? "shoulders and wrists" : "hands"}`
      );
      if (
        frame.mask &&
        frame.width !== undefined &&
        frame.height !== undefined
      ) {
        if (frame.width === 0) {
          runtime.current?.renderer.clearMask();
        } else {
          runtime.current?.renderer.setMask(
            frame.mask,
            frame.width,
            frame.height
          );
        }
        recorder.current?.recordMask(frame.mask, frame.width, frame.height);
      }
    };
    setTrackingStatus("Starting camera…");
    lastVision.current = 0;
    setTracking(mode);
    try {
      await input.start(mode);
    } catch (error) {
      input.stop();
      if (camera.current === input) {
        camera.current = null;
        setTrackingStatus("Camera unavailable");
        setTracking("off");
        toast.error(
          error instanceof Error ? error.message : "Camera unavailable."
        );
      }
    }
  };
  const learnMidi = async (target: MidiTarget) => {
    if (!midi.current) {
      const input = new MidiInput();
      midi.current = input;
      input.onValue = (key, value) => {
        const state = useInstrumentStore.getState();
        const selected = deckRef.current;
        if (key === "freeze") {
          if (value > 0.5) {
            runtime.current?.freeze();
            setFrozen(runtime.current?.transport.frozen ?? false);
          }
        } else if (state.config.version !== 1) {
          if (key === "next") {
            if (value > 0.5) {
              if (state.config.version === 3) {
                const choices = [
                  "ink",
                  "silk",
                  "prism",
                  "kaleido",
                  "loom",
                  "orbit",
                ] as const;
                const index = choices.indexOf(state.config.treatment);
                state.setConfig({
                  ...state.config,
                  treatment: choices[(index + 1) % choices.length] ?? "silk",
                });
              } else if (state.config.version === 2) {
                const choices = ["ink", "silk", "prism"] as const;
                const index = choices.indexOf(state.config.treatment);
                state.setConfig({
                  ...state.config,
                  treatment: choices[(index + 1) % choices.length] ?? "silk",
                });
              }
            }
          } else {
            const field = key === "energy" ? "intensity" : key;
            if (field === "crossfade") {
              state.setConfig({ ...state.config, reveal: value });
            } else {
              state.setConfig({ ...state.config, [field]: value });
            }
          }
        } else if (key === "next") {
          if (value > 0.5) {
            state.setConfig({
              ...state.config,
              crossfade: state.config.crossfade < 0.5 ? 1 : 0,
            });
          }
        } else if (key === "crossfade") {
          state.setConfig({ ...state.config, crossfade: value });
        } else {
          state.setConfig({
            ...state.config,
            [selected]: {
              ...state.config[selected],
              macros: { ...state.config[selected].macros, [key]: value },
            },
          });
        }
      };
      input.onTempo = (bpm) => {
        if (midiClockRef.current) {
          runtime.current?.transport.setExternalTempo(bpm);
        }
      };
      input.onLearned = (key) => {
        toast(`MIDI mapped to ${key}`);
      };
      try {
        await input.start();
        setMidiReady(true);
      } catch (error) {
        input.stop();
        midi.current = null;
        toast.error(
          error instanceof Error ? error.message : "MIDI unavailable."
        );
        return;
      }
    }
    midi.current?.learn(target);
    toast(`Move a MIDI control for ${target}`);
  };
  const finishRecording = async () => {
    const capture = recorder.current;
    if (!capture) {
      return;
    }
    const take = await capture.stop();
    recorder.current = null;
    setRecording(false);
    setCapturedId(take.manifest.id);
    toast.success("Recording saved on this device.");
  };
  useEffect(() => {
    if (!recording) {
      return;
    }
    const controller = new AbortController();
    document.addEventListener(
      "click",
      (event) => {
        const link =
          event.target instanceof Element
            ? event.target.closest("a[href]")
            : null;
        if (
          !(link instanceof HTMLAnchorElement) ||
          link.target === "_blank" ||
          link.origin !== location.origin ||
          link.pathname === location.pathname
        ) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        setLeaveHref(link.href);
      },
      { capture: true, signal: controller.signal }
    );
    window.addEventListener(
      "beforeunload",
      (event) => {
        event.preventDefault();
      },
      { signal: controller.signal }
    );
    return () => controller.abort();
  }, [recording]);
  const toggleRecording = async () => {
    if (recordBusy.current) {
      return;
    }
    recordBusy.current = true;
    try {
      if (recorder.current) {
        await finishRecording();
      } else if (runtime.current) {
        const capture = new TakeRecorder(
          runtime.current,
          experienceLabel(config)
        );
        recorder.current = capture;
        capture.onError = (message) => {
          toast.error(message);
          setRecording(false);
        };
        await capture.start(
          getCurrentAudioEngine(),
          useVisualizerStore.getState().currentFrame
        );
        setRecording(true);
      }
    } catch (error) {
      if (recorder.current) {
        await recorder.current.stop();
        recorder.current = null;
      }
      setRecording(false);
      toast.error(
        error instanceof Error ? error.message : "Could not record this take."
      );
    } finally {
      recordBusy.current = false;
    }
  };
  const freeze = useCallback(() => {
    runtime.current?.freeze();
    setFrozen(runtime.current?.transport.frozen ?? false);
  }, []);
  const saveLook = async () => {
    try {
      await rpcClient.looks.create({
        config,
        name: `${experienceLabel(config)} · ${config.palette}`,
      });
      toast.success("Look saved to your collection.");
    } catch {
      toast.error("Sign in to save a look to your collection.");
    }
  };
  return (
    <main
      className="experience-shell"
      data-sleeping={hidden}
      data-idle={audioSource.type === "none"}
    >
      <canvas
        key={recovery}
        ref={canvas}
        className="experience-canvas"
        aria-label="Music becoming light and liquid"
      />
      <button
        type="button"
        className="experience-touch"
        aria-label="Drag to stir the light. Arrow keys move it. Space holds the scene."
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect();
          pointer.current = {
            attractors: [
              {
                force: 1,
                id: 0,
                x: (event.clientX - rect.left) / rect.width,
                y: 1 - (event.clientY - rect.top) / rect.height,
              },
            ],
            expansion: 0.5,
            rotation: 0,
            time: performance.now() / 1000,
          };
        }}
        onPointerMove={(event) => {
          if (!event.buttons) {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          pointer.current = {
            attractors: [
              {
                force: event.shiftKey ? -1 : 1,
                id: 0,
                x: Math.max(
                  0,
                  Math.min(1, (event.clientX - rect.left) / rect.width)
                ),
                y: Math.max(
                  0,
                  Math.min(1, 1 - (event.clientY - rect.top) / rect.height)
                ),
              },
            ],
            expansion: 0.5,
            rotation: 0,
            time: performance.now() / 1000,
          };
        }}
        onPointerUp={() => {
          pointer.current = null;
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onLostPointerCapture={() => {
          pointer.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            freeze();
          }
          if (event.key.startsWith("Arrow")) {
            event.preventDefault();
            const previous = runtime.current?.controls.attractors[0] ?? {
              x: 0.5,
              y: 0.5,
            };
            runtime.current?.setControls({
              attractors: [
                {
                  force: 1,
                  id: 0,
                  x: Math.max(
                    0,
                    Math.min(
                      1,
                      previous.x +
                        (event.key === "ArrowRight" ? 0.05 : 0) -
                        (event.key === "ArrowLeft" ? 0.05 : 0)
                    )
                  ),
                  y: Math.max(
                    0,
                    Math.min(
                      1,
                      previous.y +
                        (event.key === "ArrowUp" ? 0.05 : 0) -
                        (event.key === "ArrowDown" ? 0.05 : 0)
                    )
                  ),
                },
              ],
              expansion: 0.5,
              rotation: 0,
              time: performance.now() / 1000,
            });
          }
        }}
      />
      <header className="experience-header experience-chrome">
        <Link href="/" className="instrument-wordmark">
          sonara<span>fm</span>
        </Link>
        <span className="experience-edition">
          a place to disappear into sound
        </span>
        <nav aria-label="Your session" className="flex items-center gap-3">
          <Link href="/studio">Studio</Link>
          {advanced && <Link href="/play">Play</Link>}
          {remoteControl}
          <UserControls compact />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Fullscreen"
            onClick={fullscreen}
          >
            <Expand />
          </Button>
        </nav>
      </header>
      <StudioCreateNav visible={workspace === "create"} />
      {audioSource.type === "none" && panel === null && (
        <section className="experience-invitation">
          <span className="experience-eyebrow">Your music, made visible</span>
          <h1>
            Give your music
            <br />
            <em>a shape.</em>
          </h1>
          <p>
            Play what you love. Watch it move.
            <br />
            Reach in and make it yours.
          </p>
          <MusicSource source={audioSource} setSource={setAudioSource} />
        </section>
      )}
      <div className="tracking-markers" aria-hidden>
        {[0, 1].map((id) => (
          <span
            key={id}
            ref={(element) => {
              markers.current[id] = element;
            }}
          />
        ))}
      </div>
      <SessionLine
        recording={recording}
        tracking={tracking}
        name={experienceLabel(config)}
        status={status}
      />
      <footer className="experience-dock experience-chrome">
        <InstrumentPanel
          label="Sound"
          title="Bring your music"
          open={panel === "music"}
          onOpenChange={(open) => setPanel(open ? "music" : null)}
        >
          <MusicSource source={audioSource} setSource={setAudioSource} />
          {advanced && (
            <div className="experience-tempo">
              <span>
                {stats.bpm
                  ? `${Math.round(stats.bpm)} BPM`
                  : "Listening for a pulse"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  runtime.current?.transport.tap(performance.now() / 1000)
                }
              >
                Tap tempo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => runtime.current?.transport.automatic()}
              >
                Auto
              </Button>
            </div>
          )}
        </InstrumentPanel>
        <InstrumentPanel
          label="Look"
          title="Choose a feeling"
          open={panel === "mood"}
          onOpenChange={(open) => setPanel(open ? "mood" : null)}
        >
          <LookControls
            advanced={advanced}
            config={config}
            setConfig={setConfig}
            deck={deck}
            setDeck={setDeck}
            send={send}
            open={panel === "mood"}
            onSave={saveLook}
          />
        </InstrumentPanel>
        <InstrumentPanel
          label="Camera"
          title="Shape it with movement"
          open={panel === "interact"}
          onOpenChange={(open) => setPanel(open ? "interact" : null)}
        >
          <ToggleGroup
            value={[tracking]}
            aria-label="Camera mode"
            spacing={2}
            onValueChange={(values) => {
              const [mode] = values;
              if (mode === "off" || mode === "hands" || mode === "body") {
                void toggleCamera(mode);
              }
            }}
          >
            <ToggleGroupItem value="off">Off</ToggleGroupItem>
            <ToggleGroupItem value="hands">Hands</ToggleGroupItem>
            <ToggleGroupItem value="body">Body</ToggleGroupItem>
          </ToggleGroup>
          <output className="tracking-status">
            <Camera aria-hidden />
            {trackingStatus}
          </output>
          <p className="sound-hint">
            {tracking === "body"
              ? "Keep your shoulders and wrists in view. Spread your arms to open the form; raise them to lift it."
              : "Move a hand to pull the light. Pinch to grab. Use two hands to stretch and turn it."}
          </p>
          <p className="sound-hint">Camera processing stays on this device.</p>
          {advanced && (
            <>
              <Button variant="outline" aria-pressed={frozen} onClick={freeze}>
                {frozen ? "Release the scene" : "Hold this scene"}
              </Button>
              <div className="experience-midi">
                <span className="experience-eyebrow">Controller mapping</span>
                {(
                  ["energy", "flow", "symmetry", "trails", "crossfade"] as const
                ).map((target) => (
                  <Button
                    key={target}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void learnMidi(target);
                    }}
                  >
                    {midiLabel(target)}
                  </Button>
                ))}
                {midiReady && (
                  <Button
                    size="sm"
                    variant={midiClock ? "primary" : "ghost"}
                    aria-pressed={midiClock}
                    onClick={() => {
                      setMidiClock(!midiClock);
                      if (midiClock) {
                        runtime.current?.transport.setExternalTempo(0);
                      }
                    }}
                  >
                    Follow MIDI clock
                  </Button>
                )}
              </div>
            </>
          )}
        </InstrumentPanel>
        <Button
          aria-pressed={recording}
          variant={recording ? "signal" : "ghost"}
          onClick={() => {
            void toggleRecording();
          }}
        >
          {recording ? (
            <Square data-icon="inline-start" />
          ) : (
            <Circle data-icon="inline-start" />
          )}
          {recording ? "Finish" : "Record"}
        </Button>
      </footer>
      <Sheet
        open={leaveHref !== null}
        onOpenChange={(open) => {
          if (!open && !leaving) {
            setLeaveHref(null);
          }
        }}
      >
        <SheetContent
          side="bottom"
          className="instrument-panel instrument-panel-mobile"
        >
          <SheetTitle>Finish your recording?</SheetTitle>
          <p>
            Your recording will be saved on this device before opening Studio.
          </p>
          <Button
            variant="primary"
            disabled={leaving}
            onClick={() => {
              void (async () => {
                setLeaving(true);
                try {
                  await finishRecording();
                  if (leaveHref) {
                    window.location.assign(leaveHref);
                  }
                } catch {
                  toast.error(
                    "Could not finish saving. Stay here and try again; existing chunks are recoverable in Studio."
                  );
                } finally {
                  setLeaving(false);
                }
              })();
            }}
          >
            {leaving ? "Saving…" : "Finish and open Studio"}
          </Button>
          <Button
            variant="outline"
            disabled={leaving}
            onClick={() => setLeaveHref(null)}
          >
            Stay
          </Button>
        </SheetContent>
      </Sheet>
      {capturedId && !recording && (
        <div className="experience-captured experience-chrome">
          <span>Moment saved</span>
          <Link href={`/studio/takes/${capturedId}`}>Edit in Studio ↗</Link>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss saved moment"
            onClick={() => setCapturedId(null)}
          >
            ×
          </Button>
        </div>
      )}
      <StageWire />
    </main>
  );
};
