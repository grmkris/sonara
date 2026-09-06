import type { EngineConfig, TakeEvent } from "@sonara/shared";
// oxlint-disable promise/avoid-new -- REVIEW: cooperative yielding keeps offline export cancellable
// oxlint-disable eslint/no-await-in-loop -- REVIEW: offline rendering and encoder backpressure require ordered samples
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
} from "mediabunny";

import { TakePlayer } from "./take-player";
import { takeBlob } from "./take-storage";
import type { LocalTake } from "./take-storage";

export interface ExportOptions {
  end: number;
  fps: 30 | 60;
  height: number;
  start: number;
  width: number;
}
const chooseCodecs = async (
  width: number,
  height: number,
  hasAudio: boolean
) => {
  let codec = await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"], {
    height,
    width,
  });
  if (!codec) {
    throw new Error(
      "This browser cannot encode video. Download the original recording instead."
    );
  }
  let audioCodec = hasAudio
    ? await getFirstEncodableAudioCodec(codec === "avc" ? ["aac"] : ["opus"])
    : null;
  if (hasAudio && !audioCodec) {
    codec = await getFirstEncodableVideoCodec(["vp9", "vp8"], {
      height,
      width,
    });
    audioCodec = await getFirstEncodableAudioCodec(["opus"]);
    if (!codec || !audioCodec) {
      throw new Error(
        "No supported audio/video codec pair. Download the original recording instead."
      );
    }
  }
  return { audioCodec, codec };
};
export const exportTake = async (
  take: LocalTake,
  events: TakeEvent[],
  override: EngineConfig | null,
  options: ExportOptions,
  progress: (value: number) => void,
  signal: AbortSignal
): Promise<File> => {
  const { width, height, fps, start, end } = options;
  const { audioCodec, codec } = await chooseCodecs(
    width,
    height,
    take.counts.audio > 0
  );
  const format =
    codec === "avc"
      ? new Mp4OutputFormat({ fastStart: "fragmented" })
      : new WebMOutputFormat();
  const root = await navigator.storage.getDirectory();
  const filename = `sonara-export-${crypto.randomUUID()}.${format.fileExtension}`;
  const handle = await root.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  const output = new Output({
    format,
    target: new StreamTarget(
      new WritableStream({
        write: async (chunk) => {
          await writable.write({
            data: new Uint8Array(chunk.data),
            position: chunk.position,
            type: "write",
          });
        },
      })
    ),
  });
  const canvas = document.createElement("canvas");
  const player = new TakePlayer(canvas, take, events);
  player.override = override;
  let input: Input | null = null;
  let audio: AudioBufferSource | null = null;
  let iterator: ReturnType<AudioBufferSink["buffers"]> | null = null;
  let nextAudio: Awaited<
    ReturnType<ReturnType<AudioBufferSink["buffers"]>["next"]>
  > | null = null;
  try {
    await player.init();
    player.runtime.renderer.resize(width, height);
    const video = new CanvasSource(canvas, {
      codec,
      quality: new Quality("high"),
    });
    output.addVideoTrack(video, { frameRate: fps });
    if (take.counts.audio > 0) {
      input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(await takeBlob(take, "audio")),
      });
      const track = await input.getPrimaryAudioTrack();
      if (!audioCodec || !track) {
        throw new Error(
          "The audio codec is unavailable. Download the original recording to keep its sound."
        );
      }
      audio = new AudioBufferSource({
        codec: audioCodec,
        quality: new Quality("high"),
      });
      output.addAudioTrack(audio);
      iterator = new AudioBufferSink(track).buffers(start, end);
      nextAudio = await iterator.next();
    }
    await output.start();
    const frames = Math.ceil((end - start) * fps);
    for (let frame = 0; frame < frames; frame += 1) {
      signal.throwIfAborted();
      const time = start + frame / fps;
      await player.seek(time, signal);
      await video.add(frame / fps, 1 / fps);
      while (
        nextAudio &&
        !nextAudio.done &&
        nextAudio.value.timestamp < time + 1 / fps
      ) {
        const { buffer, timestamp } = nextAudio.value;
        const from = Math.max(
          0,
          Math.round((start - timestamp) * buffer.sampleRate)
        );
        const until = Math.min(
          buffer.length,
          Math.round((end - timestamp) * buffer.sampleRate)
        );
        if (until > from) {
          const cropped = new AudioBuffer({
            length: until - from,
            numberOfChannels: buffer.numberOfChannels,
            sampleRate: buffer.sampleRate,
          });
          for (
            let channel = 0;
            channel < buffer.numberOfChannels;
            channel += 1
          ) {
            cropped.copyToChannel(
              buffer.getChannelData(channel).subarray(from, until),
              channel
            );
          }
          await audio?.add(cropped);
        }
        nextAudio = iterator ? await iterator.next() : null;
      }
      progress((frame + 1) / frames);
      if (frame % 10 === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    }
    video.close();
    audio?.close();
    await output.finalize();
    await writable.close();
    return await handle.getFile();
  } catch (error) {
    await output.cancel();
    await writable.abort();
    await root.removeEntry(filename);
    throw error;
  } finally {
    await iterator?.return();
    input?.dispose();
    player.dispose();
  }
};
