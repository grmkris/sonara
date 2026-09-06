// oxlint-disable unicorn/require-post-message-target-origin -- REVIEW: worker messages have no targetOrigin parameter
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";

import { handControls, poseControls } from "./vision-controls";

let hands: HandLandmarker | null = null;
let body: PoseLandmarker | null = null;

self.addEventListener(
  "message",
  async (
    event: MessageEvent<{
      type: "init" | "frame";
      mode: "hands" | "body";
      image: ImageBitmap;
      time: number;
    }>
  ) => {
    const { data } = event;
    try {
      if (data.type === "init") {
        const files = await FilesetResolver.forVisionTasks("/vision/wasm");
        if (data.mode === "hands") {
          hands = await HandLandmarker.createFromOptions(files, {
            baseOptions: {
              delegate: "CPU",
              modelAssetPath: "/vision/hand_landmarker.task",
            },
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
            numHands: 2,
            runningMode: "VIDEO",
          });
        } else {
          body = await PoseLandmarker.createFromOptions(files, {
            baseOptions: {
              delegate: "CPU",
              modelAssetPath: "/vision/pose_landmarker_lite.task",
            },
            minPoseDetectionConfidence: 0.6,
            minPosePresenceConfidence: 0.6,
            numPoses: 1,
            outputSegmentationMasks: true,
            runningMode: "VIDEO",
          });
        }
        self.postMessage({ type: "ready" });
        return;
      }
      try {
        if (hands) {
          const result = hands.detectForVideo(data.image, data.time);
          self.postMessage({
            control: handControls(
              result.landmarks,
              data.time / 1000,
              result.handedness.map((hand) =>
                hand[0]?.categoryName === "Left" ? 0 : 1
              )
            ),
            type: "result",
          });
        } else if (body) {
          const result = body.detectForVideo(data.image, data.time);
          const control = poseControls(
            result.landmarks[0] ?? [],
            data.time / 1000
          );
          const mask = result.segmentationMasks?.[0];
          const width = 160;
          const height = 120;
          const pixels = new Uint8Array(width * height);
          if (mask) {
            const floats = mask.getAsFloat32Array();
            for (let y = 0; y < height; y += 1) {
              for (let x = 0; x < width; x += 1) {
                const index =
                  Math.floor((y * mask.height) / height) * mask.width +
                  Math.floor((x * mask.width) / width);
                pixels[y * width + x] = Math.round((floats[index] ?? 0) * 255);
              }
            }
          }
          result.close();
          self.postMessage(
            { control, height, mask: pixels, type: "result", width },
            [pixels.buffer]
          );
        }
      } finally {
        data.image.close();
      }
    } catch (error) {
      self.postMessage({
        message:
          error instanceof Error ? error.message : "Camera tracking failed",
        type: "error",
      });
    }
  }
);
