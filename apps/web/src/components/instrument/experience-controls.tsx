"use client";

import { DEFAULT_EXPERIENCE } from "@sonara/shared";
import type { EngineConfig, MaterialConfig, MacroId } from "@sonara/shared";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
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
  config: MaterialConfig;
  onChange: (config: MaterialConfig) => void;
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
        const palette = values[0] as MaterialConfig["palette"];
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
    {config.version === 3 && (
      <Field>
        <FieldLabel htmlFor="visual-response">Response</FieldLabel>
        <Slider
          id="visual-response"
          aria-label="Response"
          min={0}
          max={1}
          step={0.01}
          value={[config.response]}
          onValueChange={(value) =>
            onChange({
              ...config,
              response: Array.isArray(value) ? (value[0] ?? 0.7) : value,
            })
          }
        />
        <p className="sound-hint">
          How strongly the form moves with your music.
        </p>
      </Field>
    )}
    {!compact && (
      <>
        {(["intensity", "flow", "symmetry", "trails", "reveal"] as const).map(
          (key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`visual-${key}`}>
                {key === "reveal" ? "Image presence" : key}
              </FieldLabel>
              <Slider
                id={`visual-${key}`}
                aria-label={key === "reveal" ? "Image presence" : key}
                min={0}
                max={1}
                step={0.01}
                value={[config[key]]}
                onValueChange={(value) =>
                  onChange({
                    ...config,
                    [key]: Array.isArray(value) ? (value[0] ?? 0.5) : value,
                  })
                }
              />
            </Field>
          )
        )}
        <Field orientation="horizontal">
          <FieldLabel>
            <Switch
              checked={config.automatic}
              onCheckedChange={(checked) =>
                onChange({ ...config, automatic: checked })
              }
            />
            Follow musical build-ups
          </FieldLabel>
        </Field>
      </>
    )}
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
  config.version === 1 ? (
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
  ) : (
    <ExperienceControls config={config} onChange={onChange} />
  );
