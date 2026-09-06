"use client";

import type { InstrumentConfig, MacroId, WorldId } from "@sonara/shared";

import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PALETTES, WORLDS, lookMacros } from "@/lib/instrument/catalog";

export const InstrumentControls = ({
  config,
  onChange,
  deck = "a",
  onDeck,
  onLearn,
}: {
  config: InstrumentConfig;
  onChange: (config: InstrumentConfig) => void;
  deck?: "a" | "b";
  onDeck?: (deck: "a" | "b") => void;
  onLearn?: (target: MacroId | "crossfade") => void;
}) => {
  const slot = config[deck];
  const world = WORLDS.find((w) => w.id === slot.world) ?? WORLDS[0];
  const setWorld = (id: WorldId) =>
    onChange({ ...config, [deck]: { ...slot, world: id } });
  return (
    <div className="instrument-controls">
      <div className="instrument-section-head">
        <span className="instrument-eyebrow">the material</span>
        <ToggleGroup
          aria-label="Edit deck"
          value={[deck]}
          onValueChange={(values) => {
            if (values[0] === "a" || values[0] === "b") {
              onDeck?.(values[0]);
            }
          }}
        >
          <ToggleGroupItem value="a">A</ToggleGroupItem>
          <ToggleGroupItem value="b">B</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ToggleGroup
        className="instrument-worlds"
        aria-label={`World on deck ${deck.toUpperCase()}`}
        value={[slot.world]}
        onValueChange={(values) => {
          const next = WORLDS.find((w) => w.id === values[0]);
          if (next) {
            setWorld(next.id);
          }
        }}
      >
        {WORLDS.map((w, index) => (
          <ToggleGroupItem
            key={w.id}
            value={w.id}
            className="instrument-world-choice"
          >
            <span
              aria-hidden
              className={`instrument-world-art instrument-world-${w.id}`}
            />
            <span className="instrument-world-label">
              <small>0{index + 1}</small>
              {w.name}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="instrument-world-caption">
        <span>{world?.description}</span>
        <span aria-hidden>↗</span>
      </div>
      <ToggleGroup
        className="instrument-looks"
        aria-label="World look"
        value={[String(slot.look)]}
        onValueChange={(values) => {
          const look = Number(values[0]);
          if (values.length && Number.isInteger(look)) {
            onChange({
              ...config,
              [deck]: { ...slot, look, macros: lookMacros(look) },
            });
          }
        }}
      >
        {world?.looks.map((name, index) => (
          <ToggleGroupItem key={name} value={String(index)}>
            {name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="instrument-macros">
        {(["energy", "flow", "symmetry", "trails"] as const).map((key) => (
          <div key={key} className="instrument-macro">
            <div className="instrument-section-head">
              <label htmlFor={`macro-${key}`}>{key}</label>
              <button
                type="button"
                className="instrument-value"
                title="Click to learn MIDI"
                onClick={() => onLearn?.(key)}
              >
                {Math.round(slot.macros[key] * 100)
                  .toString()
                  .padStart(2, "0")}
              </button>
            </div>
            <Slider
              id={`macro-${key}`}
              aria-label={key}
              value={[slot.macros[key]]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(value) => {
                const [next = 0] = Array.isArray(value) ? value : [value];
                onChange({
                  ...config,
                  [deck]: { ...slot, macros: { ...slot.macros, [key]: next } },
                });
              }}
            />
          </div>
        ))}
      </div>
      <div className="instrument-section-head">
        <span className="instrument-eyebrow">colour chemistry</span>
      </div>
      <ToggleGroup
        aria-label="Palette"
        value={[config.palette]}
        onValueChange={(values) => {
          const [value] = values;
          const palette = value as InstrumentConfig["palette"];
          if (palette in PALETTES) {
            onChange({ ...config, palette });
          }
        }}
      >
        {Object.entries(PALETTES).map(([name, colors]) => (
          <ToggleGroupItem key={name} value={name}>
            <span
              className="instrument-swatch"
              aria-hidden
              style={{
                background: `linear-gradient(120deg, ${colors.join(",")})`,
              }}
            />
            {name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="instrument-mixer">
        <div className="instrument-section-head">
          <span>A · {config.a.world}</span>
          <button
            type="button"
            className="instrument-eyebrow"
            onClick={() => onLearn?.("crossfade")}
            title="Learn crossfader MIDI"
          >
            blend
          </button>
          <span>{config.b.world} · B</span>
        </div>
        <Slider
          aria-label="A/B crossfade"
          value={[config.crossfade]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(value) => {
            const [crossfade = 0] = Array.isArray(value) ? value : [value];
            onChange({ ...config, crossfade });
          }}
        />
        <ToggleGroup
          aria-label="Blend mode"
          value={[config.blend]}
          onValueChange={(values) => {
            const [blend] = values;
            if (blend === "mix" || blend === "add" || blend === "mask") {
              onChange({ ...config, blend });
            }
          }}
        >
          <ToggleGroupItem value="mix">dissolve</ToggleGroupItem>
          <ToggleGroupItem value="add">light</ToggleGroupItem>
          <ToggleGroupItem value="mask">silhouette</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
};
