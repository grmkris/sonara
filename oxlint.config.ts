import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import next from "ultracite/oxlint/next";

export default defineConfig({
  extends: [core, react, next],
  // brand/ is a separate assets sub-project, not a workspace and not part of
  // the per-package CI lint — exclude it so the root type-aware / format checks
  // match the CI scope (workspaces only).
  ignorePatterns: [...core.ignorePatterns, "brand/**"],
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
  // Type-aware adoption (only active under `--type-aware`, i.e. the CI `check`
  // job): we adopt the 2 genuinely bug-catching async rules and turn OFF the
  // strictness rules. Adopting those (strict-boolean-expressions, no-unsafe-*,
  // no-confusing-void-expression, …, ~1100 sites) is a separate, behaviour-
  // touching effort — deliberately deferred. await-thenable is also off: its
  // only hits are false positives on bun:test `.resolves`/`.rejects` matchers
  // (awaitable at runtime, but typed as non-thenable).
  rules: {
    "typescript/await-thenable": "off",
    "typescript/consistent-return": "off",
    "typescript/no-confusing-void-expression": "off",
    "typescript/no-deprecated": "off",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unnecessary-boolean-literal-compare": "off",
    "typescript/no-unnecessary-type-arguments": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/no-unnecessary-type-conversion": "off",
    "typescript/no-unnecessary-type-parameters": "off",
    "typescript/no-unsafe-argument": "off",
    "typescript/no-unsafe-assignment": "off",
    "typescript/no-unsafe-call": "off",
    "typescript/no-unsafe-member-access": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/non-nullable-type-assertion-style": "off",
    "typescript/prefer-nullish-coalescing": "off",
    "typescript/prefer-readonly": "off",
    "typescript/prefer-regexp-exec": "off",
    "typescript/promise-function-async": "off",
    "typescript/require-array-sort-compare": "off",
    "typescript/return-await": "off",
    "typescript/strict-boolean-expressions": "off",
    "typescript/strict-void-return": "off",
    "typescript/switch-exhaustiveness-check": "off",
    "typescript/use-unknown-in-catch-callback-variable": "off",
  },
});
