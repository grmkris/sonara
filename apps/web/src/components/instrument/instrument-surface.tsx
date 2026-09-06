"use client";

import type { PerformanceControlFrame } from "@sonara/shared";
import {
  Camera,
  Circle,
  Expand,
  Hand,
  KeyboardMusic,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { AppNavLinks } from "@/components/app-nav";
import { StageWire } from "@/components/stage/stage-wire";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UserControls } from "@/components/user-controls";
import { MusicSource } from "@/components/visualizer/controls/music-source";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";
import { coalesce } from "@/lib/debounce";
import { CameraInput } from "@/lib/instrument/camera";
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

import { InstrumentControls } from "./instrument-controls";

export const InstrumentSurface = ({
  audioSource,
  setAudioSource,
  sceneControls,
  remoteControl,
  send,
}: {
  audioSource: AudioSource;
  setAudioSource: (source: AudioSource) => void;
  sceneControls: ReactNode;
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
  const [frozen, setFrozen] = useState(false);
  const [status, setStatus] = useState("warming the instrument");
  const [stats, setStats] = useState({ bpm: 0, fps: 0, time: 0 });
  const [recovery, setRecovery] = useState(0);
  const hidden = useVisualizerStore((state) => !state.uiVisible);
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
          } catch {
            toast.error("This image could not be loaded.");
          }
        })();
        instance.onEvent?.({ kind: "image", time: instance.elapsed, url });
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
        setStatus(
          recovery > 0
            ? "compatibility graphics · ready"
            : "ready to feel something"
        );
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
                : "Graphics unavailable. Open the classic visualizer below."
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
          `${config.a.world} × ${config.b.world}`
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
        name: `${config.a.world} / ${config.b.world} · ${config.palette}`,
      });
      toast.success("Look saved to your collection.");
    } catch {
      toast.error("Sign in to save a look to your collection.");
    }
  };
  return (
    <main className="instrument-shell" data-hidden={hidden}>
      <header className="instrument-header">
        <div className="flex items-center gap-6">
          <Link href="/" className="instrument-wordmark">
            sonara<span>fm</span>
          </Link>
          <AppNavLinks current="play" />
        </div>
        <span className="instrument-edition">
          an instrument for seeing sound <span>№ 01</span>
        </span>
        <div className="flex items-center gap-2">
          {remoteControl}
          <UserControls />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void document.documentElement.requestFullscreen();
            }}
            aria-label="Fullscreen"
          >
            <Expand data-icon="inline-start" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              useVisualizerStore.getState().setUiVisible(hidden);
            }}
          >
            {hidden ? "show controls" : "hide"}
          </Button>
        </div>
      </header>
      <section className="instrument-stage" aria-label="Performance canvas">
        <canvas
          key={recovery}
          ref={canvas}
          className="instrument-canvas"
          aria-label="Interactive music visualization"
        />
        <button
          type="button"
          className="instrument-touch"
          aria-label="Performance surface: drag to move an attractor. Arrow keys move it, space freezes."
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
                time: 0,
              });
            }
          }}
        />
        <div className="instrument-stage-label">
          <span className="instrument-eyebrow">
            {recording ? "● recording" : "live canvas"}
          </span>
          <h1>
            {config.crossfade < 0.5 ? config.a.world : config.b.world}
            <i> in motion.</i>
          </h1>
        </div>
        <div className="instrument-stage-caption">
          <span>{status}</span>
          <span>
            {stats.fps} fps ·{" "}
            {Math.floor(stats.time / 60)
              .toString()
              .padStart(2, "0")}
            :
            {Math.floor(stats.time % 60)
              .toString()
              .padStart(2, "0")}
          </span>
        </div>
        <div className="instrument-stage-actions">
          <Button size="sm" variant="default" onClick={freeze}>
            {frozen ? (
              <Play data-icon="inline-start" />
            ) : (
              <Pause data-icon="inline-start" />
            )}
            {frozen ? "release" : "freeze"}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              runtime.current?.reset();
            }}
          >
            <RotateCcw data-icon="inline-start" />
            reset
          </Button>
        </div>
        <StageWire />
      </section>
      <aside className="instrument-console">
        <InstrumentControls
          config={config}
          onChange={setConfig}
          deck={deck}
          onDeck={setDeck}
          onLearn={(target) => {
            void learnMidi(target);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void saveLook();
            }}
          >
            save look
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              useInstrumentStore.getState().setEnabled(false);
            }}
          >
            classic visualizer ↗
          </Button>
        </div>
      </aside>
      <footer className="instrument-footer">
        <div className="instrument-audio">
          <span className="instrument-eyebrow">01 / bring sound</span>
          <MusicSource source={audioSource} setSource={setAudioSource} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="instrument-tempo"
              onClick={() => {
                runtime.current?.transport.tap(performance.now() / 1000);
              }}
              title="Tap tempo"
            >
              {stats.bpm ? Math.round(stats.bpm) : "—"}
              <small>BPM / TAP</small>
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                runtime.current?.transport.multiply(0.5);
              }}
            >
              ½
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                runtime.current?.transport.multiply(2);
              }}
            >
              2×
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                runtime.current?.transport.automatic();
              }}
            >
              auto
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                runtime.current?.transport.downbeat();
              }}
            >
              ↓ beat 1
            </Button>
          </div>
        </div>
        <div className="instrument-inputs">
          <span className="instrument-eyebrow">02 / make contact</span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              aria-pressed={tracking === "hands"}
              variant={tracking === "hands" ? "primary" : "default"}
              onClick={() => {
                void toggleCamera("hands");
              }}
            >
              <Hand data-icon="inline-start" />
              hands
            </Button>
            <Button
              size="sm"
              aria-pressed={tracking === "body"}
              variant={tracking === "body" ? "primary" : "default"}
              onClick={() => {
                void toggleCamera("body");
              }}
            >
              <Camera data-icon="inline-start" />
              body
            </Button>
            <Button
              size="sm"
              variant={midiReady ? "primary" : "default"}
              onClick={() => {
                void learnMidi("crossfade");
              }}
            >
              <KeyboardMusic data-icon="inline-start" />
              MIDI
            </Button>
            {midiReady && (
              <Button
                size="sm"
                variant={midiClock ? "primary" : "ghost"}
                onClick={() => {
                  setMidiClock(!midiClock);
                  if (midiClock) {
                    runtime.current?.transport.setExternalTempo(0);
                  }
                }}
              >
                MIDI clock
              </Button>
            )}
            <Button
              size="sm"
              aria-pressed={config.conductor}
              variant={config.conductor ? "primary" : "default"}
              onClick={() => {
                setConfig({ ...config, conductor: !config.conductor });
              }}
            >
              <WandSparkles data-icon="inline-start" />
              conductor
            </Button>
          </div>
          <span className="instrument-hint">
            Drag the canvas. Pinch the light. Let the music lead.
          </span>
        </div>
        <div className="instrument-capture">
          <span className="instrument-eyebrow">03 / keep the feeling</span>
          <div className="flex gap-2">
            <Button
              aria-pressed={recording}
              variant={recording ? "signal" : "default"}
              onClick={() => {
                void toggleRecording();
              }}
            >
              {recording ? (
                <Square data-icon="inline-start" />
              ) : (
                <Circle data-icon="inline-start" />
              )}
              {recording ? "finish take" : "record a take"}
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" aria-label="Image sources and live AI">
                  <SlidersHorizontal data-icon="inline-start" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>Images & live direction</SheetTitle>
                {sceneControls}
              </SheetContent>
            </Sheet>
          </div>
          <Link href="/studio/takes" className="instrument-hint">
            your performances ↗
          </Link>
        </div>
      </footer>
    </main>
  );
};
