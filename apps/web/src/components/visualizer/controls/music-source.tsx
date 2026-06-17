"use client";

import { FileAudio, Mic, MicOff, MonitorSpeaker } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AudioSource } from "@/hooks/use-audio-features";
import { cn } from "@/lib/utils";

interface MusicSourceProps {
  source: AudioSource;
  setSource: (s: AudioSource) => void;
}

// Safari supports getDisplayMedia for video but silently drops audio tracks.
// Detect via UA — the usual "Safari but not Chrome/Edge/Android" pattern.
const isSafariLike = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  return /^(?:(?!chrome|android|edg|crios|fxios).)*safari/iu.test(ua);
};

const displayMediaSupported = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
};

const COMPUTER_AUDIO_HINT_KEY = "sonara.computerAudioHintSeen";

interface IconButtonProps {
  active: boolean;
  disabled?: boolean;
  label: string;
  title?: string;
  onClick: () => void;
  icon: React.ReactNode;
}

const IconButton = ({
  active,
  disabled,
  label,
  title,
  onClick,
  icon,
}: IconButtonProps) => {
  let stateClass: string;
  if (disabled) {
    stateClass = "cursor-not-allowed text-[color:var(--stone)]/40";
  } else if (active) {
    stateClass = "text-[color:var(--paper)]";
  } else {
    stateClass = "text-[color:var(--stone)] hover:text-[color:var(--paper)]";
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(
            "group flex items-center gap-1.5 transition-colors",
            stateClass
          )}
        >
          {icon}
          {/* Compact label, shown when the control is active or hovered.
             Reserves vertical rhythm without screaming when at rest. */}
          <span
            className={cn(
              "font-sans text-[10px] uppercase tracking-[0.22em] transition-opacity",
              active ? "opacity-100" : "opacity-0 group-hover:opacity-80"
            )}
          >
            {label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="font-mono bg-[color:var(--ink)] text-[color:var(--paper)] border border-[color:var(--hairline)]/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]"
      >
        {title ?? label}
      </TooltipContent>
    </Tooltip>
  );
};

const truncate = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export const MusicSource = ({ source, setSource }: MusicSourceProps) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // Display-audio support detection lives in state so SSR renders the
  // optimistic "enabled" path and we correct it post-mount.
  const [displaySupported, setDisplaySupported] = useState(true);
  const [displayDisabledReason, setDisplayDisabledReason] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!displayMediaSupported()) {
      setDisplaySupported(false);
      setDisplayDisabledReason("not supported in this browser");
      return;
    }
    if (isSafariLike()) {
      setDisplaySupported(false);
      setDisplayDisabledReason(
        "safari can't share tab audio — try chrome or edge"
      );
    }
  }, []);

  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    },
    []
  );

  const pickFile = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) {
      return;
    }
    if (fileRef.current) {
      fileRef.current.value = "";
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setFileName(file.name);
    const el = audioRef.current;
    if (!el) {
      return;
    }
    el.src = url;
    el.loop = true;
    el.crossOrigin = "anonymous";
    // play() may reject when autoplay is blocked; ignore and proceed without
    // awaiting so setSource fires synchronously regardless of playback start.
    // oxlint-disable-next-line prefer-await-to-then -- REVIEW: must not await; setSource runs unconditionally
    void el.play().catch(() => {
      // noop — autoplay rejection is non-fatal
    });
    setSource({ element: el, type: "element" });
  };

  const toggleMic = () => {
    if (source.type === "mic") {
      setSource({ type: "none" });
    } else {
      setSource({ type: "mic" });
    }
  };

  const toggleDisplay = () => {
    if (source.type === "display") {
      setSource({ type: "none" });
      return;
    }
    try {
      if (window.localStorage.getItem(COMPUTER_AUDIO_HINT_KEY) !== "1") {
        toast("pick a browser tab and tick 'share tab audio'", {
          description:
            "screen/window sharing often has no audio; a specific tab works best.",
          duration: 5000,
        });
        window.localStorage.setItem(COMPUTER_AUDIO_HINT_KEY, "1");
      }
    } catch {
      // localStorage blocked — skip the hint.
    }
    setSource({ type: "display" });
  };

  const micOn = source.type === "mic";
  const displayOn = source.type === "display";

  return (
    <div className="flex items-center gap-4">
      <IconButton
        active={!!fileName}
        label={fileName ? truncate(fileName, 18) : "file"}
        onClick={pickFile}
        icon={<FileAudio className="size-3.5" strokeWidth={1.5} />}
      />
      <IconButton
        active={micOn}
        label="mic"
        onClick={toggleMic}
        icon={
          micOn ? (
            <Mic className="size-3.5" strokeWidth={1.5} />
          ) : (
            <MicOff className="size-3.5" strokeWidth={1.5} />
          )
        }
      />
      <IconButton
        active={displayOn}
        disabled={!displaySupported}
        title={displayDisabledReason ?? undefined}
        label="tab audio"
        onClick={toggleDisplay}
        icon={<MonitorSpeaker className="size-3.5" strokeWidth={1.5} />}
      />
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onFile}
        aria-label="upload audio file"
      />
      <audio
        ref={audioRef}
        controls
        aria-label="uploaded audio playback"
        className={cn(
          "h-6 w-full max-w-[220px] opacity-60",
          fileName ? "block" : "hidden"
        )}
      />
    </div>
  );
};
