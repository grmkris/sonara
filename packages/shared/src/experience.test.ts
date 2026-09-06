import { expect, test } from "bun:test";

import {
  DEFAULT_EXPERIENCE,
  DEFAULT_RESPONSIVE,
  EMPTY_MUSIC,
  ExperienceConfig,
  ResponsiveConfig,
} from "./experience";
import { DEFAULT_INSTRUMENT, TakeEvent, TakeManifest } from "./instrument";
import { LookConfig } from "./looks";

test("existing looks and takes remain valid while new captures identify their engine", () => {
  const base = {
    createdAt: new Date().toISOString(),
    duration: 4,
    id: crypto.randomUUID(),
    name: "Take",
  };
  expect(
    TakeManifest.safeParse({
      ...base,
      config: DEFAULT_INSTRUMENT,
      engine: "sonara-1",
      version: 1,
    }).success
  ).toBe(true);
  expect(
    TakeManifest.safeParse({
      ...base,
      config: DEFAULT_EXPERIENCE,
      engine: "sonara-2",
      version: 2,
    }).success
  ).toBe(true);
  expect(
    TakeManifest.safeParse({
      ...base,
      config: DEFAULT_EXPERIENCE,
      engine: "sonara-1",
      version: 1,
    }).success
  ).toBe(false);
  expect(
    TakeManifest.safeParse({
      ...base,
      config: DEFAULT_RESPONSIVE,
      engine: "sonara-3",
      version: 3,
    }).success
  ).toBe(true);
  expect(
    TakeManifest.safeParse({
      ...base,
      config: DEFAULT_RESPONSIVE,
      engine: "sonara-2",
      version: 2,
    }).success
  ).toBe(false);
  for (const config of [
    DEFAULT_RESPONSIVE,
    DEFAULT_EXPERIENCE,
    DEFAULT_INSTRUMENT,
    { displacement: 0.5 },
  ]) {
    expect(LookConfig.safeParse(config).success).toBe(true);
  }
});
test("a captured motion frame includes the resolved music and simulation clock", () => {
  const event = {
    control: { attractors: [], expansion: 0.5, rotation: 0, time: 1 },
    frame: EMPTY_MUSIC,
    kind: "motion",
    simulationTime: 0.25,
    time: 1,
  };
  expect(TakeEvent.safeParse(event).success).toBe(true);
  expect(TakeEvent.safeParse({ ...event, simulationTime: -1 }).success).toBe(
    false
  );
});


test("new effects belong to responsive takes while legacy materials stay unchanged", () => {
  for (const treatment of ["kaleido", "loom", "orbit"]) {
    const config = { ...DEFAULT_RESPONSIVE, treatment };
    expect(ResponsiveConfig.safeParse(config).success).toBe(true);
    expect(LookConfig.safeParse(config).success).toBe(true);
    expect(
      TakeManifest.safeParse({
        config,
        createdAt: new Date().toISOString(),
        duration: 4,
        engine: "sonara-3",
        id: crypto.randomUUID(),
        name: treatment,
        version: 3,
      }).success
    ).toBe(true);
    expect(
      ExperienceConfig.safeParse({ ...DEFAULT_EXPERIENCE, treatment }).success
    ).toBe(false);
  }
  expect(
    ResponsiveConfig.safeParse({ ...DEFAULT_RESPONSIVE, treatment: "unknown" })
      .success
  ).toBe(false);
});
