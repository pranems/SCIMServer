import React from 'react';
import {
  Caption1,
  Card,
  Dropdown,
  Field,
  Input,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Subtitle2,
  Switch,
  tokens,
} from '@fluentui/react-components';
import { useEndpointOverview, useUpdateEndpointConfig } from '../api/queries';
import {
  ALL_ENDPOINT_SETTINGS,
  effectiveBooleanSetting,
  effectiveNumberSetting,
  type EndpointSettingDefinition,
  type NumberSettingDefinition,
} from './endpoint-settings-definitions';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
  },
  control: {
    minWidth: '0',
  },
  description: {
    color: tokens.colorNeutralForeground3,
  },
});

export interface EndpointRelatedSettingsProps {
  endpointId: string;
  settingKeys: readonly string[];
  title?: string;
  description?: string;
  'data-testid'?: string;
}

function pendingSettingKey(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object') return undefined;
  const settings = (variables as { profile?: { settings?: Record<string, unknown> } }).profile?.settings;
  return settings ? Object.keys(settings)[0] : undefined;
}

function validateNumber(setting: NumberSettingDefinition, raw: string): number | string {
  const value = Number(raw);
  if (!Number.isInteger(value)) return `${setting.displayLabel} must be a whole number.`;
  if (value < setting.min || value > setting.max) {
    return `${setting.displayLabel} must be between ${setting.min} and ${setting.max}.`;
  }
  return value;
}

export const EndpointRelatedSettings: React.FC<EndpointRelatedSettingsProps> = ({
  endpointId,
  settingKeys,
  title = 'Related settings',
  description,
  'data-testid': testId = 'endpoint-related-settings',
}) => {
  const classes = useStyles();
  const overview = useEndpointOverview(endpointId);
  const update = useUpdateEndpointConfig(endpointId);
  const [feedback, setFeedback] = React.useState<{ intent: 'success' | 'error'; text: string } | null>(null);
  React.useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const definitions = settingKeys
    .map((key) => ALL_ENDPOINT_SETTINGS.get(key))
    .filter((setting): setting is EndpointSettingDefinition => setting !== undefined);

  if (overview.isLoading) {
    return <Spinner size="tiny" label={`Loading ${title.toLowerCase()}`} data-testid={`${testId}-loading`} />;
  }
  if (overview.error || !overview.data) {
    return (
      <MessageBar intent="error" data-testid={`${testId}-error`}>
        <MessageBarBody>Could not load related endpoint settings.</MessageBarBody>
      </MessageBar>
    );
  }

  const settings = (overview.data.configFlags ?? {}) as Record<string, unknown>;
  const pendingKey = pendingSettingKey(update.variables);

  async function persist(definition: EndpointSettingDefinition, value: boolean | string | number) {
    setFeedback(null);
    try {
      await update.mutateAsync({ profile: { settings: { [definition.key]: value } } });
      setFeedback({ intent: 'success', text: `${definition.displayLabel} saved.` });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Update failed.';
      setFeedback({ intent: 'error', text: `${definition.displayLabel}: ${detail}` });
    }
  }

  return (
    <Card className={classes.card} data-testid={testId}>
      <Subtitle2>{title}</Subtitle2>
      {description && <Caption1 className={classes.description}>{description}</Caption1>}
      {feedback && (
        <MessageBar intent={feedback.intent} data-testid={`${testId}-feedback`}>
          <MessageBarBody>{feedback.text}</MessageBarBody>
        </MessageBar>
      )}
      <div className={classes.grid}>
        {definitions.map((definition) => {
          const disabled = update.isPending && pendingKey === definition.key;
          if (definition.kind === 'boolean') {
            const descriptionId = `${testId}-${definition.key}-description`;
            return (
              <div key={definition.key} className={classes.control}>
                <Switch
                  label={definition.displayLabel}
                  aria-describedby={descriptionId}
                  checked={effectiveBooleanSetting(settings[definition.key], definition.defaultValue)}
                  disabled={disabled}
                  onChange={(_, data) => { void persist(definition, data.checked); }}
                  data-testid={`${testId}-${definition.key}`}
                />
                <Caption1 id={descriptionId} className={classes.description}>{definition.description}</Caption1>
              </div>
            );
          }
          if (definition.kind === 'enum') {
            const raw = settings[definition.key];
            const current = typeof raw === 'string' && raw !== '' ? raw : definition.defaultValue;
            const currentLabel = definition.options.find((option) => option.value === current)?.label ?? current;
            return (
              <Field key={definition.key} label={definition.displayLabel} hint={definition.description} className={classes.control}>
                <Dropdown
                  aria-label={definition.displayLabel}
                  value={currentLabel}
                  selectedOptions={[current]}
                  disabled={disabled}
                  onOptionSelect={(_, data) => {
                    if (data.optionValue) void persist(definition, data.optionValue);
                  }}
                  data-testid={`${testId}-${definition.key}`}
                >
                  {definition.options.map((option) => (
                    <Option key={option.value} value={option.value} text={option.label}>
                      {option.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            );
          }

          const current = effectiveNumberSetting(settings[definition.key]);
          const display = current === undefined ? '' : String(current);
          return (
            <Field key={definition.key} label={definition.displayLabel} hint={definition.description} className={classes.control}>
              <Input
                key={`${definition.key}-${display}`}
                type="number"
                aria-label={definition.displayLabel}
                defaultValue={display}
                placeholder={`server default: ${definition.serverDefault}`}
                min={definition.min}
                max={definition.max}
                disabled={disabled}
                onBlur={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === '') return;
                  const result = validateNumber(definition, raw);
                  if (typeof result === 'string') {
                    setFeedback({ intent: 'error', text: result });
                    return;
                  }
                  if (result !== current) void persist(definition, result);
                }}
                data-testid={`${testId}-${definition.key}`}
              />
            </Field>
          );
        })}
      </div>
    </Card>
  );
};
