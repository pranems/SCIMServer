import React from 'react';
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
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
import {
  useEndpointEgressPolicy,
  useEndpointOverview,
  useUpdateEndpointConfig,
} from '../api/queries';
import {
  ALL_ENDPOINT_SETTINGS,
  effectiveBooleanSetting,
  effectiveNumberSetting,
  type EndpointSettingDefinition,
  type NumberSettingDefinition,
} from './endpoint-settings-definitions';
import { EGRESS_FIELD_BY_SETTING, EGRESS_SOURCE_LABEL } from './egress-policy-ui';

const useStyles = makeStyles({
  card: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
  },
  header: {
    width: '100%',
  },
  headerContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
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
  egressSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: tokens.spacingVerticalM,
  },
  egressHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
  },
  egressRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    minWidth: 0,
  },
  egressActions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
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
  const [egressEditing, setEgressEditing] = React.useState(false);
  const [egressDraft, setEgressDraft] = React.useState<Record<string, string>>({});
  const [egressInitialDraft, setEgressInitialDraft] = React.useState<Record<string, string>>({});
  const [egressResets, setEgressResets] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const definitions = settingKeys
    .map((key) => ALL_ENDPOINT_SETTINGS.get(key))
    .filter((setting): setting is EndpointSettingDefinition => setting !== undefined);
  const egressDefinitions = definitions.filter(
    (setting): setting is NumberSettingDefinition =>
      setting.kind === 'number' && EGRESS_FIELD_BY_SETTING[setting.key] !== undefined,
  );
  const standardDefinitions = definitions.filter(
    (setting) => EGRESS_FIELD_BY_SETTING[setting.key] === undefined,
  );
  const egressPolicy = useEndpointEgressPolicy(endpointId, egressDefinitions.length > 0);

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

  function beginEgressEdit(): void {
    const draft: Record<string, string> = {};
    for (const definition of egressDefinitions) {
      const fieldName = EGRESS_FIELD_BY_SETTING[definition.key];
      const field = fieldName ? egressPolicy.data?.[fieldName] : undefined;
      if (field) draft[definition.key] = String(field.configured ?? field.effective);
    }
    setEgressDraft(draft);
    setEgressInitialDraft(draft);
    setEgressResets(new Set());
    setFeedback(null);
    setEgressEditing(true);
  }

  function cancelEgressEdit(): void {
    setEgressDraft({});
    setEgressInitialDraft({});
    setEgressResets(new Set());
    setEgressEditing(false);
  }

  async function saveEgressDraft(): Promise<void> {
    const patch: Record<string, number | null> = {};
    for (const definition of egressDefinitions) {
      if (egressResets.has(definition.key)) {
        patch[definition.key] = null;
        continue;
      }
      if (egressDraft[definition.key] === egressInitialDraft[definition.key]) continue;
      const result = validateNumber(definition, egressDraft[definition.key] ?? '');
      if (typeof result === 'string') {
        setFeedback({ intent: 'error', text: result });
        return;
      }
      patch[definition.key] = result;
    }
    if (Object.keys(patch).length === 0) {
      cancelEgressEdit();
      return;
    }
    setFeedback(null);
    try {
      await update.mutateAsync({ profile: { settings: patch } });
      setFeedback({ intent: 'success', text: 'WIF/JWKS runtime overrides saved.' });
      cancelEgressEdit();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Update failed.';
      setFeedback({ intent: 'error', text: `WIF/JWKS runtime overrides: ${detail}` });
    }
  }

  return (
    <Card className={classes.card} data-testid={testId}>
      <Accordion collapsible>
        <AccordionItem value="settings">
          <AccordionHeader className={classes.header} data-testid={`${testId}-toggle`}>
            <div className={classes.headerContent}>
              <Subtitle2>{title}</Subtitle2>
              <Caption1 className={classes.description}>
                {definitions.length} {definitions.length === 1 ? 'setting' : 'settings'}
              </Caption1>
            </div>
          </AccordionHeader>
          <AccordionPanel className={classes.panel}>
            {description && <Caption1 className={classes.description}>{description}</Caption1>}
            {feedback && (
              <MessageBar intent={feedback.intent} data-testid={`${testId}-feedback`}>
                <MessageBarBody>{feedback.text}</MessageBarBody>
              </MessageBar>
            )}
            <div className={classes.grid}>
        {standardDefinitions.map((definition) => {
          const disabled = update.isPending && pendingKey === definition.key;
          if (definition.kind === 'boolean') {
            const descriptionId = `${testId}-${definition.key}-description`;
            if (definition.key === 'PersistRequestSecrets') {
              return (
                <div key={definition.key} className={classes.control} data-testid={`${testId}-${definition.key}`}>
                  <Caption1><strong>{definition.displayLabel}: always redacted</strong></Caption1>
                  <Caption1 id={descriptionId} className={classes.description}>{definition.description}</Caption1>
                </div>
              );
            }
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
            {egressDefinitions.length > 0 && (
              <div className={classes.egressSection} data-testid={`${testId}-egress-policy`}>
                <div className={classes.egressHeader}>
                  <div>
                    <Subtitle2>Effective WIF/JWKS runtime values</Subtitle2>
                    <Caption1 className={classes.description}>
                      Endpoint overrides win; otherwise the value inherits the server environment or built-in default.
                    </Caption1>
                  </div>
                  {!egressEditing && (
                    <Button
                      appearance="secondary"
                      onClick={beginEgressEdit}
                      disabled={egressPolicy.isLoading || Boolean(egressPolicy.error)}
                      data-testid={`${testId}-egress-edit`}
                    >
                      Edit
                    </Button>
                  )}
                </div>
                {egressPolicy.isLoading && <Spinner size="tiny" label="Loading effective WIF/JWKS values" />}
                {egressPolicy.error && (
                  <MessageBar intent="error">
                    <MessageBarBody>Could not load effective WIF/JWKS values.</MessageBarBody>
                  </MessageBar>
                )}
                {egressPolicy.data && (
                  <div className={classes.grid}>
                    {egressDefinitions.map((definition) => {
                      const fieldName = EGRESS_FIELD_BY_SETTING[definition.key]!;
                      const field = egressPolicy.data[fieldName];
                      const resetPending = egressResets.has(definition.key);
                      return (
                        <div key={definition.key} className={classes.egressRow} data-testid={`${testId}-egress-${definition.key}`}>
                          <Caption1><strong>{definition.displayLabel}</strong></Caption1>
                          {!egressEditing ? (
                            <>
                              <Caption1 data-testid={`${testId}-effective-${definition.key}`}>
                                Effective: {field.effective} {field.unit}
                              </Caption1>
                              <Caption1 data-testid={`${testId}-source-${definition.key}`}>
                                Source: {EGRESS_SOURCE_LABEL[field.source]}
                                {field.configured !== null ? ` (${field.configured} ${field.unit})` : ''}
                              </Caption1>
                              <Caption1 data-testid={`${testId}-bounds-${definition.key}`}>
                                Bounds: {field.min} - {field.max} {field.unit}
                              </Caption1>
                              {field.clamped && field.requested !== undefined && (
                                <Caption1 data-testid={`${testId}-clamped-${definition.key}`}>
                                  Requested {field.requested} {field.unit}; clamped to {field.effective} {field.unit}.
                                </Caption1>
                              )}
                            </>
                          ) : (
                            <>
                              <Input
                                type="number"
                                aria-label={definition.displayLabel}
                                value={resetPending ? '' : (egressDraft[definition.key] ?? '')}
                                placeholder={resetPending ? 'Will inherit after Save' : undefined}
                                min={field.min}
                                max={field.max}
                                disabled={resetPending || update.isPending}
                                onChange={(_, data) => setEgressDraft((current) => ({
                                  ...current,
                                  [definition.key]: data.value,
                                }))}
                                data-testid={`${testId}-${definition.key}-draft`}
                              />
                              <Button
                                appearance="subtle"
                                disabled={field.configured === null || resetPending || update.isPending}
                                onClick={() => setEgressResets((current) => new Set(current).add(definition.key))}
                                data-testid={`${testId}-${definition.key}-reset`}
                              >
                                Reset to inherit
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {egressEditing && (
                  <div className={classes.egressActions}>
                    <Button
                      appearance="primary"
                      onClick={() => { void saveEgressDraft(); }}
                      disabled={update.isPending}
                      data-testid={`${testId}-egress-save`}
                    >
                      Save
                    </Button>
                    <Button
                      appearance="secondary"
                      onClick={cancelEgressEdit}
                      disabled={update.isPending}
                      data-testid={`${testId}-egress-cancel`}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Card>
  );
};
