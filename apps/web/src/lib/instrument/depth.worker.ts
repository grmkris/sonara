// oxlint-disable unicorn/require-post-message-target-origin -- REVIEW: worker messages have no targetOrigin parameter
import { env, pipeline, RawImage } from "@huggingface/transformers";
import type { DepthEstimationPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

let estimator: Promise<DepthEstimationPipeline> | null = null;
const load = () => {
  estimator ??= pipeline(
    "depth-estimation",
    "onnx-community/depth-anything-v2-small-ONNX",
    {
      device: "wasm",
      dtype: "q4",
      revision: "c3b67641fd837b2368757101311e5d21e511441e",
    }
  );
  return estimator;
};

const estimate = async (blob: Blob): Promise<Blob> => {
  self.postMessage({ status: "loading" });
  const model = await load();
  self.postMessage({ status: "estimating" });
  const bitmap = await createImageBitmap(blob);
  // Fixed square input bounds model cost even for a panoramic photograph.
  const size = 518;
  const scale = size / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image processing is unavailable.");
  }
  context.fillStyle = "#808080";
  context.fillRect(0, 0, size, size);
  context.drawImage(bitmap, left, top, width, height);
  bitmap.close();
  const input = new RawImage(
    context.getImageData(0, 0, size, size).data,
    size,
    size,
    4
  );
  const { predicted_depth: prediction } = await model(input);
  const data = prediction.data as Float32Array;
  let low = Infinity;
  let high = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[(y + top) * size + x + left] ?? 0;
      if (Number.isFinite(value)) {
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[(y + top) * size + x + left] ?? low;
      const depth = Number.isFinite(value)
        ? Math.round(
            Math.max(
              0,
              Math.min(1, (value - low) / Math.max(0.0001, high - low))
            ) * 65_535
          )
        : 0;
      const offset = (y * width + x) * 4;
      pixels[offset] = Math.floor(depth / 256);
      pixels[offset + 1] = depth % 256;
      pixels[offset + 3] = 255;
    }
  }
  const output = new OffscreenCanvas(width, height);
  output
    .getContext("2d")
    ?.putImageData(new ImageData(pixels, width, height), 0, 0);
  return output.convertToBlob({ type: "image/png" });
};
self.addEventListener(
  "message",
  async (event: MessageEvent<{ blob: Blob }>) => {
    try {
      const blob = await estimate(event.data.blob);
      self.postMessage({ blob, status: "ready" });
    } catch {
      estimator = null;
      self.postMessage({ status: "error" });
    }
  }
);
