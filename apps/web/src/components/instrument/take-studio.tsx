"use client";
// oxlint-disable eslint/no-await-in-loop -- REVIEW: copy recording chunks sequentially to bound memory

import type { EngineConfig, TakeEvent } from "@sonara/shared";
import type { FrameSetId } from "@sonara/shared/typeid";
import { Download, Pause, Play, Save, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { experienceLabel, intensityOf } from "@/lib/instrument/catalog";
import { exportTake } from "@/lib/instrument/export";
import { TakePlayer, readTakeEvents } from "@/lib/instrument/take-player";
import {
  appendChunk,
  downloadBlob,
  fetchTake,
  readChunk,
  readLocalTake,
  saveLocalTake,
  takeBlob,
  uploadTake,
} from "@/lib/instrument/take-storage";
import type { LocalTake } from "@/lib/instrument/take-storage";

import { EngineControls } from "./experience-controls";

// oxlint-disable-next-line complexity -- REVIEW: editor state binds transport, media, and export controls
export const TakeStudio = ({ id }: { id: string }) => {
  const [take, setTake] = useState<LocalTake | null>(null);
  const [events, setEvents] = useState<TakeEvent[]>([]);
  const eventsRef = useRef<TakeEvent[]>([]);
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [deck, setDeck] = useState<"a" | "b">("a");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState("film");
  const [loop, setLoop] = useState(false);
  const [trim, setTrim] = useState<[number, number]>([0, 1]);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [shape, setShape] = useState("landscape");
  const [resolution, setResolution] = useState("1080");
  const [fps, setFps] = useState<30 | 60>(30);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<TakePlayer | null>(null);
  const cancelExport = useRef<AbortController | null>(null);
  const seeking = useRef(false);
  const target = useRef(0);
  const rebuild = useRef(false);
  const [mediaUrl, setMediaUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setBusy("opening the performance");
        const loaded = id.startsWith("set_")
          ? await fetchTake(id as FrameSetId)
          : await readLocalTake(id);
        if (!loaded) {
          throw new Error("This take is not on this device.");
        }
        const timeline = await readTakeEvents(loaded);
        const movie = await takeBlob(loaded, "video");
        if (cancelled) {
          return;
        }
        setTake(loaded);
        setConfig(loaded.manifest.config);
        setTrim(loaded.manifest.range ?? [0, loaded.manifest.duration]);
        if (loaded.remix) {
          setMode("remix");
        }
        setEvents(timeline);
        eventsRef.current = timeline;
        setMediaUrl(URL.createObjectURL(movie));
        setBusy("");
      } catch (error) {
        if (!cancelled) {
          setBusy(
            error instanceof Error ? error.message : "Could not open the take."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      cancelExport.current?.abort();
    };
  }, [id]);
  useEffect(
    () => () => {
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl);
      }
    },
    [mediaUrl]
  );
  useEffect(() => {
    if (!take || !canvas.current) {
      return;
    }
    const instance = new TakePlayer(canvas.current, take, eventsRef.current);
    const controller = new AbortController();
    let disposed = false;
    void (async () => {
      try {
        await instance.init();
        if (disposed) {
          return;
        }
        instance.runtime.renderer.resize(960, 540);
        await instance.seek(take.manifest.range?.[0] ?? 0, controller.signal);
        if (disposed) {
          return;
        }
        player.current = instance;
      } catch (error) {
        if (!disposed) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Remix rendering unavailable."
          );
        }
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      instance.dispose();
      player.current = null;
    };
  }, [take]);
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) {
        return;
      }
      const element = video.current;
      if (element) {
        if (playing && element.currentTime >= trim[1]) {
          if (loop) {
            [element.currentTime] = trim;
          } else {
            element.pause();
            setPlaying(false);
          }
        }
        target.current = element.currentTime;
        setTime(element.currentTime);
      }
      const instance = player.current;
      if (
        mode === "remix" &&
        instance &&
        !seeking.current &&
        (Math.abs(instance.time - target.current) > 0.02 || rebuild.current)
      ) {
        seeking.current = true;
        void (async () => {
          try {
            if (rebuild.current) {
              await instance.seek(0);
              rebuild.current = false;
            }
            await instance.seek(target.current);
          } catch (error) {
            if (!cancelled) {
              toast.error(
                error instanceof Error ? error.message : "Replay failed."
              );
              setMode("film");
            }
          } finally {
            seeking.current = false;
          }
        })();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [mode, playing, trim, loop]);

  const changeConfig = (next: EngineConfig) => {
    setConfig(next);
    setMode("remix");
    const event: TakeEvent = { config: next, kind: "scene", time };
    if (writing && playing) {
      eventsRef.current.push(event);
      eventsRef.current.sort((a, b) => a.time - b.time);
    } else {
      const index = eventsRef.current.findLastIndex(
        (e) => e.kind === "scene" && e.time <= time
      );
      if (index === -1) {
        eventsRef.current.unshift({ ...event, time: 0 });
      } else {
        eventsRef.current[index] = {
          ...event,
          time: eventsRef.current[index]?.time ?? time,
        };
      }
    }
    setEvents([...eventsRef.current]);
    if (player.current) {
      player.current.runtime.configure(next);
      rebuild.current = true;
    }
  };
  const jump = (value: number) => {
    if (video.current) {
      video.current.currentTime = value;
    }
    target.current = value;
    setTime(value);
  };
  const moveCue = (delta: number) => {
    const index = eventsRef.current.findLastIndex(
      (event) => event.kind === "scene" && event.time <= time + 0.001
    );
    const cue = eventsRef.current[index];
    if (!cue || cue.kind !== "scene" || cue.time === 0 || !take) {
      return;
    }
    const nextTime = Math.max(
      0.01,
      Math.min(take.manifest.duration, cue.time + delta)
    );
    eventsRef.current[index] = { ...cue, time: nextTime };
    eventsRef.current.sort((a, b) => a.time - b.time);
    setEvents([...eventsRef.current]);
    rebuild.current = true;
    jump(nextTime);
  };
  const saveRemix = async () => {
    if (!take || !config) {
      return;
    }
    setBusy("saving your remix");
    try {
      const remix: LocalTake = {
        counts: { audio: 0, events: 0, images: 0, masks: 0, video: 0 },
        manifest: {
          ...take.manifest,
          config,
          createdAt: new Date().toISOString(),
          id: crypto.randomUUID(),
          name: `${take.manifest.name} · remix`.slice(0, 120),
          range: trim,
        },
        recording: false,
        remix: true,
      };
      await saveLocalTake(remix);
      for (const kind of ["audio", "masks", "video", "images"] as const) {
        for (let index = 0; index < take.counts[kind]; index += 1) {
          const chunk = await readChunk(take.manifest.id, kind, index);
          await appendChunk(remix, kind, chunk.blob);
        }
      }
      for (let index = 0; index < eventsRef.current.length; index += 2000) {
        await appendChunk(
          remix,
          "events",
          new Blob(
            [JSON.stringify(eventsRef.current.slice(index, index + 2000))],
            { type: "application/json" }
          )
        );
      }
      toast.success("Remix saved. The original performance is unchanged.", {
        action: {
          label: "Open",
          onClick: () => {
            window.location.href = `/studio/takes/${remix.manifest.id}`;
          },
        },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the remix."
      );
    } finally {
      setBusy("");
    }
  };
  const upload = async () => {
    if (!take) {
      return;
    }
    setBusy("saving to your library");
    try {
      const setId = await uploadTake(take, setProgress);
      setTake({ ...take, setId });
      toast.success("Saved to your private Sets library.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Upload interrupted. You can retry it."
      );
    } finally {
      setBusy("");
    }
  };
  const render = async () => {
    if (!take) {
      return;
    }
    video.current?.pause();
    setPlaying(false);
    setBusy("rendering your film");
    setProgress(0);
    const controller = new AbortController();
    cancelExport.current = controller;
    const base = Number(resolution);
    let width = Math.round((base * 16) / 9 / 2) * 2;
    let height = base;
    if (shape === "portrait") {
      width = base;
      height = Math.round((base * 16) / 9 / 2) * 2;
    } else if (shape === "square") {
      width = base;
      height = base;
    }
    try {
      const file = await exportTake(
        take,
        eventsRef.current,
        null,
        { end: trim[1], fps, height, start: trim[0], width },
        setProgress,
        controller.signal
      );
      downloadBlob(
        file,
        `${take.manifest.name}.${file.name.split(".").at(-1) ?? "mp4"}`
      );
      setTimeout(() => {
        void (async () => {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry(file.name);
        })();
      }, 60_000);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "Export failed.");
      }
    } finally {
      setBusy("");
      cancelExport.current = null;
    }
  };
  return (
    <main className="take-studio">
      <header className="take-header">
        <Link href="/studio/takes">← performances</Link>
        <span className="instrument-eyebrow">
          {take?.remix ? "remix" : "original take"}
        </span>
        <Link href="/play">back to the instrument ↗</Link>
      </header>
      <div className="take-editor">
        <section className="take-workspace">
          <h1>{take?.manifest.name ?? "Opening your performance…"}</h1>
          <div
            className="take-screen"
            style={{
              aspectRatio: (
                {
                  landscape: "16 / 9",
                  portrait: "9 / 16",
                  square: "1",
                } as Record<string, string>
              )[shape],
            }}
          >
            <video
              ref={video}
              src={mediaUrl || undefined}
              className={mode === "film" ? "" : "take-hidden-video"}
              playsInline
              onLoadedMetadata={() => {
                if (video.current && take?.manifest.range) {
                  [video.current.currentTime] = take.manifest.range;
                }
              }}
              onEnded={() => {
                setPlaying(false);
              }}
              aria-label="Recorded performance"
            >
              <track kind="captions" />
            </video>
            <canvas
              key={`${take?.manifest.id}-${take?.setId ?? "local"}`}
              ref={canvas}
              style={{ visibility: mode === "remix" ? "visible" : "hidden" }}
              aria-label="Remix preview"
            />
          </div>
          <div className="take-transport">
            <Button
              onClick={() => {
                if (playing) {
                  video.current?.pause();
                  setPlaying(false);
                } else {
                  if (time < trim[0] || time >= trim[1]) {
                    jump(trim[0]);
                  }
                  void (async () => {
                    try {
                      await video.current?.play();
                      setPlaying(true);
                    } catch {
                      toast.error("Playback could not start.");
                    }
                  })();
                }
              }}
            >
              {playing ? (
                <Pause data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {playing ? "pause" : "play"}
            </Button>
            <span>
              {time.toFixed(1)} / {take?.manifest.duration.toFixed(1) ?? 0}s
            </span>
            <Button
              variant={loop ? "primary" : "ghost"}
              onClick={() => {
                setLoop(!loop);
              }}
            >
              loop
            </Button>
            <ToggleGroup
              value={[mode]}
              onValueChange={(values) => {
                if (values[0]) {
                  setMode(values[0]);
                }
              }}
              aria-label="Preview mode"
            >
              <ToggleGroupItem value="film">original film</ToggleGroupItem>
              <ToggleGroupItem value="remix">remix</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Slider
            aria-label="Playhead"
            value={[time]}
            min={0}
            max={take?.manifest.duration || 1}
            step={0.05}
            onValueChange={(value) => {
              jump(Array.isArray(value) ? (value[0] ?? 0) : value);
            }}
          />
          <div className="take-timeline" aria-label="Scene cues">
            {events
              .filter((e) => e.kind === "scene")
              .filter(
                (e, i, all) => i === 0 || e.time - (all[i - 1]?.time ?? 0) > 0.3
              )
              .map((event, index) => (
                <button
                  type="button"
                  key={`${event.time}-${index}`}
                  style={{
                    left: `${(event.time / Math.max(1, take?.manifest.duration ?? 1)) * 100}%`,
                  }}
                  onClick={() => {
                    jump(event.time);
                    if (event.kind === "scene") {
                      setConfig(event.config);
                    }
                  }}
                  title={`${event.time.toFixed(1)}s · ${experienceLabel(event.config)}`}
                >
                  {experienceLabel(event.config)}
                </button>
              ))}
          </div>
          <div className="take-transport">
            <span className="instrument-eyebrow">selected cue</span>
            <Button
              size="sm"
              onClick={() => {
                moveCue(-0.5);
              }}
            >
              ← 0.5s
            </Button>
            <Button
              size="sm"
              onClick={() => {
                moveCue(0.5);
              }}
            >
              0.5s →
            </Button>
          </div>
          <div className="take-automation" aria-label="Crossfade automation">
            <svg
              viewBox="0 0 1000 60"
              preserveAspectRatio="none"
              role="img"
              aria-label={
                config?.version === 2
                  ? "Intensity over time"
                  : "Crossfade over time"
              }
            >
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                points={events
                  .filter((e) => e.kind === "scene")
                  .map(
                    (e) =>
                      `${(e.time / Math.max(1, take?.manifest.duration ?? 1)) * 1000},${55 - (e.config.version === 2 ? intensityOf(e.config) : e.config.crossfade) * 50}`
                  )
                  .join(" ")}
              />
            </svg>
            <span className="instrument-eyebrow">A / B automation</span>
          </div>
          <div className="take-transport">
            <Button
              variant={writing ? "signal" : "ghost"}
              onClick={() => {
                setWriting(!writing);
              }}
            >
              write automation
            </Button>
            <Button
              onClick={() => {
                setTrim([
                  Math.min(time, (take?.manifest.duration ?? 1) - 0.1),
                  Math.min(
                    take?.manifest.duration ?? 1,
                    Math.max(time + 0.1, trim[1])
                  ),
                ]);
              }}
            >
              mark in
            </Button>
            <Button
              onClick={() => {
                setTrim([
                  Math.max(0, Math.min(trim[0], time - 0.1)),
                  Math.min(take?.manifest.duration ?? 1, Math.max(0.1, time)),
                ]);
              }}
            >
              mark out
            </Button>
            <span>
              {trim[0].toFixed(1)} → {trim[1].toFixed(1)}s
            </span>
          </div>
          {busy && (
            <output>
              {busy} {progress > 0 ? `${Math.round(progress * 100)}%` : ""}{" "}
              {cancelExport.current && (
                <Button
                  onClick={() => {
                    cancelExport.current?.abort();
                  }}
                >
                  cancel
                </Button>
              )}
            </output>
          )}
          <div className="take-export">
            <ToggleGroup
              aria-label="Export framing"
              value={[shape]}
              onValueChange={(values) => {
                if (values[0]) {
                  setShape(values[0]);
                }
              }}
            >
              <ToggleGroupItem value="landscape">16:9</ToggleGroupItem>
              <ToggleGroupItem value="portrait">9:16</ToggleGroupItem>
              <ToggleGroupItem value="square">1:1</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              aria-label="Export resolution"
              value={[resolution]}
              onValueChange={(values) => {
                if (values[0]) {
                  setResolution(values[0]);
                }
              }}
            >
              <ToggleGroupItem value="1080">1080</ToggleGroupItem>
              <ToggleGroupItem value="2160">4K</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              aria-label="Export frame rate"
              value={[String(fps)]}
              onValueChange={(values) => {
                setFps(values[0] === "60" ? 60 : 30);
              }}
            >
              <ToggleGroupItem value="30">30 fps</ToggleGroupItem>
              <ToggleGroupItem value="60">60 fps</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="take-transport">
            <Button
              disabled={!!busy || !take}
              onClick={() => {
                void render();
              }}
            >
              <Download data-icon="inline-start" />
              export remix
            </Button>
            <Button
              disabled={!take}
              onClick={() => {
                if (take) {
                  void (async () => {
                    const blob = await takeBlob(take, "video");
                    downloadBlob(
                      blob,
                      `${take.manifest.name}.${blob.type.includes("mp4") ? "mp4" : "webm"}`
                    );
                  })();
                }
              }}
            >
              original film
            </Button>
            <Button
              disabled={!!busy || !take}
              onClick={() => {
                void saveRemix();
              }}
            >
              <Save data-icon="inline-start" />
              save remix
            </Button>
            <Button
              disabled={!!busy || !take}
              onClick={() => {
                void upload();
              }}
            >
              <Upload data-icon="inline-start" />
              save to account
            </Button>
          </div>
        </section>
        <aside className="take-inspector">
          {config && (
            <EngineControls
              allowUpgrade={false}
              config={config}
              onChange={changeConfig}
              deck={deck}
              onDeck={setDeck}
            />
          )}
        </aside>
      </div>
    </main>
  );
};
