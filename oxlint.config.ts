import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import next from "ultracite/oxlint/next";

export default defineConfig({
  extends: [core, react, next],
  ignorePatterns: core.ignorePatterns,
  // Rules newly *enforced* against the pre-existing codebase by the oxlint
  // 1.70 / ultracite 7.8.3 bump (2026-06). Turned off here to keep the dep
  // bump behavior-preserving and minimal — NOT adopted as part of it. In
  // particular no-await-in-loop fires on intentionally-sequential migration /
  // boot-seed loops where Promise.all would be semantically wrong. Adopting
  // these (and fixing the code) is a deliberate follow-up, tracked separately.
  rules: {
    "no-await-in-loop": "off",
    "prefer-named-capture-group": "off",
    "typescript/method-signature-style": "off",
    "unicorn/import-style": "off",
  },
});
