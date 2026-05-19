/**
 * Step 2 - Pick a preset (Phase N2 OnboardingWizard).
 *
 * Renders the preset grid + selection state + load/error spinner.
 * Extracted from OnboardingWizard.tsx (2026-05-17, Stage X.1 A.4
 * closure). data-testid attributes preserved exactly.
 */
import React from 'react';
import {
  Card,
  Subtitle2,
  Caption1,
  Badge,
  Spinner,
  Text,
} from '@fluentui/react-components';
import { ScimErrorMessage } from '../../components/primitives/ScimErrorMessage';
import { useOnboardingStyles } from './onboarding-styles';

export interface PresetSummary {
  schemaCount?: number;
  resourceTypeCount?: number;
}

export interface PresetEntry {
  name: string;
  default?: boolean;
  summary?: PresetSummary;
}

export interface StepPickPresetProps {
  presets: {
    isLoading: boolean;
    error: Error | null;
    data?: { presets: PresetEntry[] };
  };
  picked: string;
  onPick: (name: string) => void;
  advanceError: unknown;
}

export const StepPickPreset: React.FC<StepPickPresetProps> = ({
  presets,
  picked,
  onPick,
  advanceError,
}) => {
  const classes = useOnboardingStyles();
  return (
    <div className={classes.body} data-testid="onboarding-step-2">
      <Subtitle2>Pick the schema profile that matches your IdP.</Subtitle2>
      {presets.isLoading ? (
        <Spinner />
      ) : presets.error ? (
        <Text>Failed to load presets: {presets.error.message}</Text>
      ) : (
        <div className={classes.presetGrid}>
          {presets.data?.presets.map((p) => {
            const selected = p.name === picked;
            return (
              <Card
                key={p.name}
                className={`${classes.presetCard} ${selected ? classes.presetCardSelected : ''}`}
                onClick={() => onPick(p.name)}
                data-testid={`onboarding-preset-card-${p.name}`}
                data-selected={selected ? 'true' : 'false'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Subtitle2>{p.name}</Subtitle2>
                  {p.default ? <Badge appearance="filled" size="small">Default</Badge> : null}
                </div>
                <Caption1>
                  {p.summary?.schemaCount ?? 0} schemas /{' '}
                  {p.summary?.resourceTypeCount ?? 0} resource types
                </Caption1>
              </Card>
            );
          })}
        </div>
      )}
      <ScimErrorMessage error={advanceError} />
    </div>
  );
};
