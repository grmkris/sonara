// oxlint-disable unicorn/require-post-message-target-origin -- REVIEW: Worker and MessagePort postMessage have no targetOrigin parameter
import type { AudioFeatureFrame } from "@sonara/shared";

import { FeatureAnalyzer } from "./feature-analyzer";

let analyzer = new FeatureAnalyzer(48_000);
let generation = 0;
self.addEventListener(
  "message",
  (
    event: MessageEvent<{
      type: "init" | "reset";
      generation: number;
      sampleRate: number;
      port: MessagePort;
    }>
  ) => {
    const { data } = event;
    if (data.type === "reset") {
      ({ generation } = data);
      analyzer.reset();
      return;
    }
    analyzer = new FeatureAnalyzer(data.sampleRate);
    data.port.addEventListener(
      "message",
      (input: MessageEvent<{ samples: Float32Array; time: number }>) => {
        const frame: AudioFeatureFrame = analyzer.process(
          input.data.samples,
          input.data.time
        );
        self.postMessage({ ...frame, generation });
        data.port.postMessage(null);
      }
    );
    data.port.start();
  }
);
