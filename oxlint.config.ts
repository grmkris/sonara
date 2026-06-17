import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import next from "ultracite/oxlint/next";

export default defineConfig({
  extends: [core, react, next],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      // Dev/seed/probe scripts get relaxed norms vs app/lib code:
      // - no-await-in-loop: they legitimately do sequential, rate-limited I/O
      //   (FAL calls, ordered DB seeding) where Promise.all would hammer APIs
      //   or reorder output — sequential is the point, not a smell.
      // - import-style: named node:path imports (`{ resolve }`) are fine for
      //   one-off scripts; the rule still applies to app/lib code.
      files: ["**/scripts/**"],
      rules: {
        "no-await-in-loop": "off",
        "unicorn/import-style": "off",
      },
    },
  ],
});
