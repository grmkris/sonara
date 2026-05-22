"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SessionSend } from "@/lib/session-actions";
import {
  STRENGTH_PRESET_LABELS,
  STRENGTH_PRESET_VALUES,
  type StrengthPreset,
} from "@/stores/visualizer/image-anchor-slice";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

interface ImageAnchorZoneProps {
  send: SessionSend;
}

const PRESETS: StrengthPreset[] = ["style-only", "style-subject", "lock-subject"];
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// Sits beneath the PromptInput textarea. Drag-drop or click to upload; on
// success the live Session pins the fal URL as `imageAnchor` and the next
// frame uses flux-pro/v1.1-ultra with image conditioning. Preset picker
// underneath controls strength; changing it re-sends setImageAnchor.
export function ImageAnchorZone({ send }: ImageAnchorZoneProps) {
  const anchorImageUrl = useVisualizerStore((s) => s.anchorImageUrl);
  const anchorLocalPreview = useVisualizerStore((s) => s.anchorLocalPreview);
  const strengthPreset = useVisualizerStore((s) => s.strengthPreset);
  const uploadState = useVisualizerStore((s) => s.uploadState);
  const clickwrapAccepted = useVisualizerStore((s) => s.clickwrapAccepted);
  const setAnchorImageUrl = useVisualizerStore((s) => s.setAnchorImageUrl);
  const setAnchorLocalPreview = useVisualizerStore((s) => s.setAnchorLocalPreview);
  const setStrengthPreset = useVisualizerStore((s) => s.setStrengthPreset);
  const acceptClickwrap = useVisualizerStore((s) => s.acceptClickwrap);
  const setUploadState = useVisualizerStore((s) => s.setUploadState);
  const clearAnchor = useVisualizerStore((s) => s.clearAnchor);

  const [showClickwrap, setShowClickwrap] = useState(false);
  const pendingFileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Revoke the object URL when the local preview changes or the component
  // unmounts so we don't leak Blob URLs.
  const localPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    if (localPreviewRef.current && localPreviewRef.current !== anchorLocalPreview) {
      URL.revokeObjectURL(localPreviewRef.current);
    }
    localPreviewRef.current = anchorLocalPreview;
    return () => {
      if (localPreviewRef.current) {
        URL.revokeObjectURL(localPreviewRef.current);
        localPreviewRef.current = null;
      }
    };
  }, [anchorLocalPreview]);

  const doUpload = useCallback(
    async (file: File) => {
      if (!ALLOWED_MIME.has(file.type)) {
        toast.error("Image must be JPEG, PNG, or WebP");
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error("Image must be 5 MB or smaller");
        return;
      }

      // Optimistic thumbnail.
      const localUrl = URL.createObjectURL(file);
      setAnchorLocalPreview(localUrl);
      setUploadState("uploading");

      try {
        const form = new FormData();
        form.set("image", file);
        const res = await fetch("/api/upload/image", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`upload failed (${res.status}): ${errText}`);
        }
        const data = (await res.json()) as { url?: string };
        if (!data.url) {
          throw new Error("upload response missing url");
        }
        setAnchorImageUrl(data.url);
        setUploadState("idle");
        send({
          type: "image.anchor.set",
          url: data.url,
          strength: STRENGTH_PRESET_VALUES[strengthPreset],
        });
      } catch (err) {
        setUploadState("error");
        setAnchorLocalPreview(null);
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Couldn't upload image — ${message}`);
      }
    },
    [
      send,
      strengthPreset,
      setAnchorImageUrl,
      setAnchorLocalPreview,
      setUploadState,
    ],
  );

  const handleFile = useCallback(
    (file: File) => {
      if (!clickwrapAccepted) {
        pendingFileRef.current = file;
        setShowClickwrap(true);
        return;
      }
      void doUpload(file);
    },
    [clickwrapAccepted, doUpload],
  );

  const onAcceptClickwrap = useCallback(() => {
    acceptClickwrap();
    setShowClickwrap(false);
    const file = pendingFileRef.current;
    pendingFileRef.current = null;
    if (file) void doUpload(file);
  }, [acceptClickwrap, doUpload]);

  const onCancelClickwrap = useCallback(() => {
    pendingFileRef.current = null;
    setShowClickwrap(false);
  }, []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-selecting the same file
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onClear = useCallback(() => {
    clearAnchor();
    send({ type: "image.anchor.clear" });
  }, [clearAnchor, send]);

  const onPresetClick = useCallback(
    (preset: StrengthPreset) => {
      setStrengthPreset(preset);
      const url = anchorImageUrl;
      if (url) {
        send({
          type: "image.anchor.set",
          url,
          strength: STRENGTH_PRESET_VALUES[preset],
        });
      }
    },
    [anchorImageUrl, send, setStrengthPreset],
  );

  const thumbnail = anchorLocalPreview ?? anchorImageUrl;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-[9px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
        anchor image
      </span>

      {thumbnail ? (
        <div className="flex items-center gap-3">
          {/* biome-ignore lint/performance/noImgElement: Blob URLs and external fal CDN URLs not handled by next/image. */}
          <img
            src={thumbnail}
            alt="anchor reference"
            className={cn(
              "h-14 w-14 object-cover border border-[color:var(--hairline)]/40",
              uploadState === "uploading" && "opacity-60 animate-pulse",
            )}
          />
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPresetClick(p)}
                  className={cn(
                    "font-sans text-[10px] uppercase tracking-[0.14em] transition-colors border-b px-1.5 py-0.5",
                    strengthPreset === p
                      ? "text-[color:var(--paper)] border-[color:var(--paper)]"
                      : "text-[color:var(--stone)] border-[color:var(--hairline)]/30 hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
                  )}
                >
                  {STRENGTH_PRESET_LABELS[p]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClear}
              className="self-start font-sans text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)] hover:text-[color:var(--paper)] transition-colors"
              aria-label="clear anchor image"
            >
              × remove
            </button>
          </div>
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex items-center justify-center px-3 py-3 border border-dashed cursor-pointer transition-colors",
            "font-sans text-[10px] uppercase tracking-[0.18em]",
            dragOver
              ? "border-[color:var(--paper)] text-[color:var(--paper)]"
              : "border-[color:var(--hairline)]/40 text-[color:var(--stone)] hover:border-[color:var(--paper)]/60 hover:text-[color:var(--paper)]",
            uploadState === "uploading" && "opacity-60 animate-pulse",
          )}
        >
          {uploadState === "uploading"
            ? "uploading…"
            : "drop image or click to attach"}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileChange}
            className="hidden"
          />
        </div>
      )}

      {showClickwrap && (
        <div className="flex flex-col gap-2 p-2 border border-[color:var(--hairline)]/50 bg-[color:var(--ink)]/40">
          <span className="font-sans text-[10px] leading-[1.5] text-[color:var(--stone)]">
            By uploading you confirm you have the right to use this image. It
            is stored on fal&apos;s CDN for the duration of your session and
            dropped on disconnect.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAcceptClickwrap}
              className="font-sans text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 border border-[color:var(--paper)]/60 text-[color:var(--paper)] hover:bg-[color:var(--paper)]/10 transition-colors"
            >
              accept &amp; upload
            </button>
            <button
              type="button"
              onClick={onCancelClickwrap}
              className="font-sans text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 text-[color:var(--stone)] hover:text-[color:var(--paper)] transition-colors"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
