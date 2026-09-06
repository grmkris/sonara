"use client";

import type { LookProfile } from "@sonara/shared";
import { ImagePlus, Mic } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SourceSwitcher } from "@/components/visualizer/controls/source-switcher";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { applySavedLook } from "@/lib/apply-look";
import { useSession } from "@/lib/auth-client";
import { rpcClient } from "@/lib/orpc";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

interface ImageRequest {
  prompt: string;
  requestId: string;
}
const REQUEST_KEY = "sonara_pending_mood";
const persistRequest = (value: ImageRequest | null) => {
  try {
    if (value) {
      localStorage.setItem(REQUEST_KEY, JSON.stringify(value));
    } else {
      localStorage.removeItem(REQUEST_KEY);
    }
  } catch {
    // The in-memory request still prevents accidental retries.
  }
};
const applyLocalImage = (url: string) => {
  const state = useVisualizerStore.getState();
  state.setSource({ kind: "idle" });
  state.pushFrame(url, state.latestVersion + 1);
};

const StudioImageControls = ({
  busy,
  prompt,
  send,
}: {
  busy: boolean;
  prompt: string;
  send: SessionSend;
}) => {
  const { data: session } = useSession();
  const source = useVisualizerStore((s) => s.source);
  const continuous = source.kind === "live";
  const [looks, setLooks] = useState<LookProfile[] | null>(null);
  const toggleContinuous = () => {
    if (continuous) {
      useVisualizerStore.getState().stopToIdle();
      return;
    }
    if (!session || !prompt.trim()) {
      toast.error("Sign in and describe an image first.");
      return;
    }
    useVisualizerStore.getState().setSource({ kind: "live" });
    send({ prompt: prompt.trim(), seedFrameUrl: null, type: "session.goLive" });
  };
  const loadLooks = async () => {
    try {
      const result = await rpcClient.looks.list({ limit: 50 });
      setLooks(result.looks);
    } catch {
      toast.error("Sign in to see your saved moods.");
    }
  };
  return (
    <>
      <Button
        variant={continuous ? "signal" : "ghost"}
        aria-pressed={continuous}
        disabled={busy}
        onClick={toggleContinuous}
      >
        {continuous ? "Stop evolving images" : "Keep evolving images"}
      </Button>
      <p className="experience-note">
        {continuous
          ? "On — new images use credits as the scene evolves."
          : "Off — generating more images is always your choice."}
      </p>
      <Button
        variant="ghost"
        onClick={() => {
          void loadLooks();
        }}
      >
        Your saved moods
      </Button>
      {looks && (
        <div className="flex flex-wrap gap-2">
          {looks.length === 0 ? (
            <p className="experience-note">
              Save a mood below to find it here.
            </p>
          ) : (
            looks.map((look) => (
              <Button
                key={look.id}
                variant="default"
                size="sm"
                onClick={() => applySavedLook(look.config)}
              >
                {look.name}
              </Button>
            ))
          )}
        </div>
      )}
    </>
  );
};

export const ExperienceMood = ({
  send,
  open,
  compact = false,
}: {
  send: SessionSend;
  open: boolean;
  compact?: boolean;
}) => {
  const { data: session } = useSession();
  const [prompt, setPrompt] = useState("");
  const [request, setRequest] = useState<ImageRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const photo = useRef<HTMLInputElement>(null);
  const localUrls = useRef<string[]>([]);
  const submitting = useRef(false);
  const voice = useVoiceRecognition({ onResult: (text) => setPrompt(text) });
  useEffect(() => {
    try {
      const raw = JSON.parse(
        localStorage.getItem(REQUEST_KEY) ?? "null"
      ) as ImageRequest | null;
      if (
        raw &&
        typeof raw.prompt === "string" &&
        /^[\da-f-]{36}$/iu.test(raw.requestId)
      ) {
        setRequest(raw);
        setPrompt(raw.prompt);
      }
    } catch {
      persistRequest(null);
    }
    const urls = localUrls.current;
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);
  useEffect(() => {
    if (!open && voice.listening) {
      voice.stop();
    }
  }, [open, voice]);
  useEffect(() => {
    if (!request || !session) {
      return;
    }
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await rpcClient.mood.status({
          requestId: request.requestId,
        });
        if (canceled) {
          return;
        }
        if (result.url) {
          applyLocalImage(result.url);
          persistRequest(null);
          setRequest(null);
          setBusy(false);
          setMessage("Your image is here. It keeps moving with the music.");
        } else if (["done", "failed", "canceled"].includes(result.status)) {
          persistRequest(null);
          setRequest(null);
          setBusy(false);
          setMessage(
            "No image was produced. Check your credits, then try another image."
          );
        } else {
          setBusy(true);
          setMessage(
            "Making your image. Keep listening — it will appear here."
          );
          timer = setTimeout(() => {
            void check();
          }, 2000);
        }
      } catch {
        if (!canceled) {
          setBusy(false);
          setMessage(
            "Could not check this image. Retry to reconnect to the same request."
          );
        }
      }
    };
    void check();
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [request, session]);
  const generate = async () => {
    if (!session) {
      toast.error(
        "Sign in to generate an image. Photos and built-in sets are free to use."
      );
      return;
    }
    if (submitting.current || busy || !prompt.trim()) {
      return;
    }
    submitting.current = true;
    setBusy(true);
    const next = request ?? {
      prompt: prompt.trim(),
      requestId: crypto.randomUUID(),
    };
    useVisualizerStore.getState().stopToIdle();
    persistRequest(next);
    try {
      await rpcClient.mood.generate(next);
      setRequest({ ...next });
      setMessage("Making one image…");
    } catch (error) {
      setRequest(next);
      setBusy(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not request the image. Retry when connected."
      );
    } finally {
      submitting.current = false;
    }
  };
  const readyLabel = request ? "Retry this image" : "Make one image";
  return (
    <div className="experience-imagery">
      <div className="experience-section-label">Let an image emerge</div>
      {compact && (
        <p className="experience-note">
          Dream up a scene or bring a photo. Your music and hands make it move.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="default"
          disabled={busy}
          onClick={() => photo.current?.click()}
        >
          <ImagePlus data-icon="inline-start" />
          Use a photo
        </Button>
        {!compact && <SourceSwitcher send={send} />}
      </div>
      <input
        ref={photo}
        type="file"
        accept="image/*"
        aria-label="Choose a photo"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) {
            return;
          }
          if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024) {
            toast.error("Choose an image smaller than 25 MB.");
            return;
          }
          const url = URL.createObjectURL(file);
          localUrls.current.push(url);
          applyLocalImage(url);
          setMessage("Photo added. It keeps moving with your music.");
        }}
      />
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="mood-prompt">Or imagine something</FieldLabel>
            <Input
              id="mood-prompt"
              maxLength={2000}
              placeholder="A moonlit garden beneath the ocean…"
              value={prompt}
              disabled={busy || Boolean(request)}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-2">
          {session ? (
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !prompt.trim()}
            >
              {busy ? "Making your image…" : readyLabel}
            </Button>
          ) : (
            <Button variant="primary" render={<Link href="/login" />}>
              Sign in to generate
            </Button>
          )}
          {!compact && voice.supported && (
            <Button
              type="button"
              variant="ghost"
              aria-pressed={voice.listening}
              disabled={busy || Boolean(request)}
              onClick={voice.listening ? voice.stop : voice.start}
            >
              <Mic data-icon="inline-start" />
              {voice.listening ? "Finish speaking" : "Speak it"}
            </Button>
          )}
          {request && !busy && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                persistRequest(null);
                setRequest(null);
                setMessage(
                  "Your earlier request may still finish in your collection."
                );
              }}
            >
              Write another
            </Button>
          )}
        </div>
      </form>
      <p className="experience-note">
        One image uses one frame credit or your available free allowance. Its
        movement is unlimited. <Link href="/credits">Credits ↗</Link>
      </p>
      {message && <output className="experience-note">{message}</output>}
      {voice.error && (
        <output className="experience-note">{voice.error}</output>
      )}
      {!compact && (
        <StudioImageControls busy={busy} prompt={prompt} send={send} />
      )}
    </div>
  );
};
