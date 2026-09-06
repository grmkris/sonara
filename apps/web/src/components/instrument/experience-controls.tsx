"use client";

import { DEFAULT_EXPERIENCE } from "@sonara/shared";
import type { EngineConfig, ExperienceConfig, MacroId } from "@sonara/shared";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PALETTES } from "@/lib/instrument/catalog";

import { InstrumentControls } from "./instrument-controls";

const treatments = [
  {
    description: "Deep pigment. Slow currents.",
    flow: 0.28,
    name: "Ink",
    symmetry: 0.05,
    trails: 0.35,
    value: "ink",
  },
  {
    description: "Luminous folds. Suspended light.",
    flow: 0.45,
    name: "Silk",
    symmetry: 0.15,
    trails: 0.55,
    value: "silk",
  },
  {
    description: "Refracted color. Electric detail.",
    flow: 0.6,
    name: "Prism",
    symmetry: 0.65,
    trails: 0.65,
    value: "prism",
  },
] as const;

export const ExperienceControls = ({
  config,
  onChange,
  compact = false,
}: {
  config: ExperienceConfig;
  onChange: (config: ExperienceConfig) => void;
  compact?: boolean;
}) => (
  <div className="experience-controls">
    <ToggleGroup
      aria-label="Material treatment"
      className="experience-treatments"
      value={[config.treatment]}
      onValueChange={(values) => {
        const treatment = treatments.find((t) => t.value === values[0]);
        if (treatment) {
          onChange({
            ...config,
            flow: treatment.flow,
            symmetry: treatment.symmetry,
            trails: treatment.trails,
            treatment: treatment.value,
          });
        }
      }}
    >
      {treatments.map((t) => (
        <ToggleGroupItem
          key={t.value}
          value={t.value}
          className="experience-treatment"
        >
          <span
            className={`experience-treatment-art experience-treatment-${t.value}`}
            aria-hidden
          />
          <span>
            {t.name}
            <small>{t.description}</small>
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
    <ToggleGroup
      aria-label="Color palette"
      value={[config.palette]}
      onValueChange={(values) => {
        const palette = values[0] as ExperienceConfig["palette"];
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
    {!compact && (
      <div className="experience-parameter">
        <label htmlFor="experience-intensity">Intensity</label>
        <Slider
          id="experience-intensity"
          aria-label="Intensity"
          min={0}
          max={1}
          step={0.01}
          value={[config.intensity]}
          onValueChange={(value) =>
            onChange({
              ...config,
              intensity: Array.isArray(value) ? (value[0] ?? 0.5) : value,
            })
          }
        />
      </div>
    )}
    <div className="experience-parameter">
      <label htmlFor="image-reveal">Image presence</label>
      <Slider
        id="image-reveal"
        aria-label="Image presence"
        min={0}
        max={1}
        step={0.01}
        value={[config.reveal]}
        onValueChange={(value) =>
          onChange({
            ...config,
            reveal: Array.isArray(value) ? (value[0] ?? 0.5) : value,
          })
        }
      />
    </div>
    <Button
      variant={config.automatic ? "primary" : "default"}
      aria-pressed={config.automatic}
      onClick={() => onChange({ ...config, automatic: !config.automatic })}
    >
      Let the music lead
    </Button>
  </div>
);

export const EngineControls = ({
  config,
  onChange,
  allowUpgrade = true,
  ...props
}: {
  config: EngineConfig;
  onChange: (config: EngineConfig) => void;
  allowUpgrade?: boolean;
  deck?: "a" | "b";
  onDeck?: (deck: "a" | "b") => void;
  onLearn?: (target: MacroId | "crossfade") => void;
}) =>
  config.version === 2 ? (
    <ExperienceControls config={config} onChange={onChange} />
  ) : (
    <div className="flex flex-col gap-4">
      <InstrumentControls config={config} onChange={onChange} {...props} />
      {allowUpgrade && (
        <Button
          variant="ghost"
          onClick={() =>
            onChange({
              ...DEFAULT_EXPERIENCE,
              palette: config.palette,
              seed: config.seed,
            })
          }
        >
          Shape this as living light
        </Button>
      )}
    </div>
  );
