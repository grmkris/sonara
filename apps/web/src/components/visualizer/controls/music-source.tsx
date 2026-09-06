"use client";

import {
  FileAudio,
  Mic,
  MonitorSpeaker,
  Pause,
  Play,
  Unplug,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";

interface MusicSourceProps {
  source: AudioSource;
  setSource: (source: AudioSource) => void;
}
export type AudioConnectionState =
  | "disconnected"
  | "connecting"
  | "silent"
  | "receiving";
const connectionLabel = {
  connecting: "Connecting…",
  disconnected: "Choose where your music is playing",
  receiving: "Receiving sound",
  silent: "Connected — waiting for sound",
};

export const MusicSource = ({ source, setSource }: MusicSourceProps) => {
  const file = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const request = useRef(false);
  const [sharing, setSharing] = useState(false);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<AudioConnectionState>("disconnected");
  const [level, setLevel] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    alive.current = true;
    setAvailable(typeof navigator.mediaDevices?.getDisplayMedia === "function");
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const update = () => {
      const engine = getCurrentAudioEngine();
      const rms = engine?.latest.features.rms ?? 0;
      setLevel(source.type === "none" ? 0 : Math.min(1, Math.sqrt(rms) * 2));
      if (source.type === "none") {
        setStatus(sharing ? "connecting" : "disconnected");
      } else if (engine?.connected) {
        setStatus(rms > 0.003 ? "receiving" : "silent");
      } else {
        setStatus("connecting");
      }
      setPaused(source.type === "element" && source.element.paused);
    };
    update();
    const timer = setInterval(update, 150);
    return () => clearInterval(timer);
  }, [sharing, source]);
  const share = async () => {
    if (request.current) {
      return;
    }
    request.current = true;
    setSharing(true);
    setMessage("");
    try {
      // Must run in this click handler, before any awaited setup loses activation.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
      if (!alive.current || stream.getAudioTracks().length === 0) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        if (alive.current) {
          setMessage(
            "No audio was shared. Choose a music tab and enable Share tab audio, or use a microphone or file."
          );
        }
        return;
      }
      setSource({ stream, type: "display" });
    } catch (error) {
      if (
        alive.current &&
        !(error instanceof Error && error.name === "NotAllowedError")
      ) {
        setMessage(
          "Audio sharing is unavailable here. Try a desktop browser with tab audio, or use a microphone or file."
        );
      }
    } finally {
      request.current = false;
      if (alive.current) {
        setSharing(false);
      }
    }
  };
  const pickFile = async (selected: File) => {
    const url = URL.createObjectURL(selected);
    const element = new Audio(url);
    element.loop = true;
    setMessage("");
    setSource({ element, name: selected.name, type: "element", url });
    try {
      await element.play();
    } catch {
      if (alive.current) {
        setMessage(
          "Playback did not start. Press Play; if it still fails, try a different audio file."
        );
      }
    }
  };
  const togglePlayback = async () => {
    if (source.type !== "element") {
      return;
    }
    if (source.element.paused) {
      try {
        await source.element.play();
        setMessage("");
      } catch {
        setMessage("This audio file could not be played. Try another file.");
      }
    } else {
      source.element.pause();
    }
  };
  return (
    <div className="sound-source">
      <Button
        variant="primary"
        size="lg"
        disabled={!available || sharing}
        onClick={() => {
          void share();
        }}
      >
        <MonitorSpeaker data-icon="inline-start" />
        {sharing ? "Choose a music tab…" : "Share a music tab"}
      </Button>
      <p className="sound-hint">
        {available
          ? "Play music in another tab, select it, and enable Share tab audio."
          : "Tab audio is unavailable in this browser. Use a microphone or open a file."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setMessage("");
            setSource({ type: "mic" });
          }}
        >
          <Mic data-icon="inline-start" />
          Use microphone
        </Button>
        <Button variant="outline" onClick={() => file.current?.click()}>
          <FileAudio data-icon="inline-start" />
          Open audio file
        </Button>
      </div>
      <input
        ref={file}
        type="file"
        accept="audio/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Open audio file"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (selected) {
            void pickFile(selected);
          }
        }}
      />
      <div className="sound-connection" data-state={status}>
        <div className="flex items-center justify-between gap-3">
          <output>{connectionLabel[status]}</output>
          <meter min={0} max={1} value={level} aria-label="Audio input level" />
        </div>
        {source.type === "element" && (
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">{source.name ?? "Your audio file"}</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={paused ? "Play music" : "Pause music"}
              onClick={() => {
                void togglePlayback();
              }}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
          </div>
        )}
        {source.type === "display" && (
          <small>Playback stays in your music tab.</small>
        )}
        {source.type === "mic" && (
          <small>Listening through your microphone. Play music nearby.</small>
        )}
        {source.type !== "none" && (
          <Button variant="ghost" onClick={() => setSource({ type: "none" })}>
            <Unplug data-icon="inline-start" />
            Disconnect sound
          </Button>
        )}
      </div>
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
};
