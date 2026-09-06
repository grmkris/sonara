import { expect, test } from "bun:test";

import {
  DEFAULT_EXPERIENCE,
  DEFAULT_TOUCH,
  TouchConfig,
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

test("touch takes preserve held surface points and lossless depth references", () => {
  const config = { ...DEFAULT_TOUCH, treatment: "relief" };
  expect(TouchConfig.safeParse(config).success).toBe(true);
  expect(ResponsiveConfig.safeParse({ ...config, version: 3 }).success).toBe(
    false
  );
  expect(
    TakeManifest.safeParse({
      config,
      createdAt: new Date().toISOString(),
      duration: 2,
      engine: "sonara-4",
      id: crypto.randomUUID(),
      name: "Relief",
      version: 4,
    }).success
  ).toBe(true);
  const contact = {
    anchorX: 0.25,
    anchorY: 0.5,
    held: true,
    id: 0,
    pressure: 0.4,
    strength: 1,
    x: 0.7,
    y: 0.5,
  };
  const motion: Extract<TakeEvent, { kind: "motion" }> = {
    control: {
      attractors: [],
      contacts: [contact],
      expansion: 0.5,
      rotation: 0,
      time: 1,
    },
    frame: EMPTY_MUSIC,
    kind: "motion",
    simulationTime: 1,
    time: 1,
  };
  expect(TakeEvent.parse(motion)).toEqual(motion);
  expect(
    TakeEvent.safeParse({
      ...motion,
      control: { ...motion.control, contacts: [{ ...contact, pressure: 2 }] },
    }).success
  ).toBe(false);
  expect(
    TakeEvent.parse({ kind: "depth", time: 1, url: "take-image:1" })
  ).toEqual({ kind: "depth", time: 1, url: "take-image:1" });
});
