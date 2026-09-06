"use client";

import type { PerformanceControlFrame } from "@sonara/shared";
import {
  Camera,
  Circle,
  Expand,
  Hand,
  Pause,
  Play,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { StageWire } from "@/components/stage/stage-wire";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { UserControls } from "@/components/user-controls";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";
import { coalesce } from "@/lib/debounce";
import { CameraInput } from "@/lib/instrument/camera";
import { experienceLabel, intensityOf } from "@/lib/instrument/catalog";
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
        ? "Drag anywhere to touch the light."
        : "Move to stir. Pinch to pull."}
    </span>
    {status !== "ready" && <span>{status}</span>}
  </div>
);

export const InstrumentSurface = ({
  audioSource,
  setAudioSource,
  remoteControl,
  send,
}: {
  audioSource: AudioSource;
  setAudioSource: (source: AudioSource) => void;
  remoteControl?: ReactNode;
  send: SessionSend;
}) => {
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
  const demoAudio = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(false);
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
  useEffect(() => {
    if (audioSource.type !== "none") {
      setPanel(null);
      setPaused(false);
    }
  }, [audioSource]);
  const playDemo = async () => {
    const element = demoAudio.current;
    if (!element) {
      return;
    }
    element.src = "/audio/first-light.74210e9ade.wav";
    element.loop = true;
    setAudioSource({ element, type: "element" });
    try {
      await element.play();
    } catch {
      toast.error("Press play to start the demo.");
    }
    wake();
  };
  const togglePlayback = async () => {
    if (audioSource.type !== "element") {
      return;
    }
    const { element } = audioSource;
    if (element.paused) {
      try {
        await element.play();
        setPaused(false);
      } catch {
        toast.error("Playback could not start.");
      }
    } else {
      element.pause();
      setPaused(true);
    }
    wake();
  };
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
  const toggleCamera = async (mode: "hands" | "body") => {
    camera.current?.stop();
    camera.current = null;
    runtime.current?.renderer.clearMask();
    recorder.current?.recordMask(new Uint8Array(0), 0, 0);
    if (tracking === mode) {
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
      runtime.current?.renderer.clearMask();
      recorder.current?.recordMask(new Uint8Array(0), 0, 0);
      toast.error(message);
    };
    input.onFrame = (frame) => {
      runtime.current?.setControls(frame.control);
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
    setTracking(mode);
    try {
      await input.start(mode);
    } catch (error) {
      input.stop();
      if (camera.current === input) {
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
        } else if (state.config.version === 2) {
          if (key === "next") {
            if (value > 0.5) {
              const choices = ["ink", "silk", "prism"] as const;
              state.setConfig({
                ...state.config,
                treatment:
                  choices[(choices.indexOf(state.config.treatment) + 1) % 3] ??
                  "silk",
              });
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
  const toggleRecording = async () => {
    if (recordBusy.current) {
      return;
    }
    recordBusy.current = true;
    try {
      if (recorder.current) {
        const take = await recorder.current.stop();
        recorder.current = null;
        setRecording(false);
        setCapturedId(take.manifest.id);
        toast.success("Your performance is saved on this device.", {
          action: {
            label: "Open take",
            onClick: () => {
              window.location.href = `/studio/takes/${take.manifest.id}`;
            },
          },
        });
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
  const changeIntensity = (value: number) => {
    if (config.version === 2) {
      setConfig({ ...config, intensity: value });
    } else {
      setConfig({
        ...config,
        a: { ...config.a, macros: { ...config.a.macros, energy: value } },
      });
    }
  };
  return (
    <main className="experience-shell" data-sleeping={hidden}>
      <canvas
        key={recovery}
        ref={canvas}
        className="experience-canvas"
        aria-label="Music becoming light and liquid"
      />
      <audio
        ref={demoAudio}
        aria-label="Demo audio"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
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
          <Link href="/studio">Your collection</Link>
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
      {audioSource.type === "none" && (
        <section className="experience-invitation">
          <span className="experience-eyebrow">music, made visible</span>
          <h1>
            Let the music
            <br />
            <em>take shape.</em>
          </h1>
          <p>
            Light that listens. Images that dream.
            <br />A little room to lose yourself.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary" size="lg" onClick={playDemo}>
              <Play data-icon="inline-start" />
              Play a demo
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setPanel("music")}>
              Bring your music ↗
            </Button>
          </div>
          <small>48 seconds of original music. No sign-in needed.</small>
        </section>
      )}
      <SessionLine
        recording={recording}
        tracking={tracking}
        name={experienceLabel(config)}
        status={status}
      />
      <footer className="experience-dock experience-chrome">
        {audioSource.type === "element" && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={paused ? "Play music" : "Pause music"}
            onClick={togglePlayback}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
        )}
        <Sheet
          open={panel === "music"}
          onOpenChange={(open) => setPanel(open ? "music" : null)}
        >
          <SheetTrigger asChild>
            <Button variant="ghost">Music</Button>
          </SheetTrigger>
          <SheetContent keepMounted className="experience-sheet">
            <SheetTitle>Bring sound</SheetTitle>
            <p>A track, the room around you, or a browser tab.</p>
            <MusicSource source={audioSource} setSource={setAudioSource} />
            <Button variant="ghost" onClick={playDemo}>
              Play First light · Sonara demo
            </Button>
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
            <Button
              variant="ghost"
              onClick={() => {
                if (audioSource.type === "element") {
                  audioSource.element.pause();
                }
                setAudioSource({ type: "none" });
              }}
            >
              Disconnect sound
            </Button>
          </SheetContent>
        </Sheet>
        <Sheet
          open={panel === "mood"}
          onOpenChange={(open) => setPanel(open ? "mood" : null)}
        >
          <SheetTrigger asChild>
            <Button variant="ghost">Mood</Button>
          </SheetTrigger>
          <SheetContent keepMounted className="experience-sheet">
            <SheetTitle>Give it a feeling</SheetTitle>
            <p>Choose the material. Let an image emerge inside it.</p>
            {config.version === 2 ? (
              <ExperienceControls
                config={config}
                onChange={setConfig}
                compact
              />
            ) : (
              <EngineControls
                config={config}
                onChange={setConfig}
                deck={deck}
                onDeck={setDeck}
              />
            )}
            <ExperienceMood send={send} open={panel === "mood"} />
            <Button
              variant="ghost"
              onClick={() => {
                void saveLook();
              }}
            >
              Save this mood
            </Button>
          </SheetContent>
        </Sheet>
        <Sheet
          open={panel === "interact"}
          onOpenChange={(open) => setPanel(open ? "interact" : null)}
        >
          <SheetTrigger asChild>
            <Button variant="ghost">
              Interact{tracking === "off" ? "" : " ·"}
            </Button>
          </SheetTrigger>
          <SheetContent className="experience-sheet">
            <SheetTitle>Reach into the music</SheetTitle>
            <p>
              Your movement joins the current. Release it and the music carries
              on.
            </p>
            <div className="flex gap-3">
              <Button
                variant={tracking === "hands" ? "primary" : "default"}
                aria-pressed={tracking === "hands"}
                onClick={() => {
                  void toggleCamera("hands");
                }}
              >
                <Hand data-icon="inline-start" />
                Hands
              </Button>
              <Button
                variant={tracking === "body" ? "primary" : "default"}
                aria-pressed={tracking === "body"}
                onClick={() => {
                  void toggleCamera("body");
                }}
              >
                <Camera data-icon="inline-start" />
                Body
              </Button>
            </div>
            <p className="experience-note">
              Camera processing stays on this device. Move to stir; pinch to
              pull. In body mode, your silhouette becomes part of the light.
            </p>
            <Button variant="ghost" aria-pressed={frozen} onClick={freeze}>
              {frozen ? "Release the scene" : "Hold this scene"}
            </Button>
            <div className="experience-midi">
              <span className="experience-eyebrow">use a controller</span>
              {(
                ["energy", "flow", "symmetry", "trails", "crossfade"] as const
              ).map((target) => (
                <Button
                  key={target}
                  size="sm"
                  variant="ghost"
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
          </SheetContent>
        </Sheet>
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
          {recording ? "Finish" : "Capture"}
        </Button>
        <div className="experience-intensity">
          <label htmlFor="listening-intensity">Intensity</label>
          <Slider
            id="listening-intensity"
            aria-label="Intensity"
            value={[intensityOf(config)]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(value) =>
              changeIntensity(Array.isArray(value) ? (value[0] ?? 0.5) : value)
            }
          />
        </div>
      </footer>
      {capturedId && !recording && (
        <div className="experience-captured experience-chrome">
          <span>Moment saved</span>
          <Link href={`/studio/takes/${capturedId}`}>
            Trim, remix & share ↗
          </Link>
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
