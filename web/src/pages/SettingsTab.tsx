/**
 * SettingsTab - per-endpoint configuration with interactive flag toggles.
 *
 * Phase E2 per UI_REDESIGN_REMAINING_GAPS_PLAN.md S8.2.
 *
 * Reads `configFlags` + endpoint summary from `useEndpointOverview` (Phase B
 * BFF, zero extra round trips on tab switch). Renders one Fluent UI Switch
 * per known boolean ProfileSetting flag (curated registry below) plus a
 * read-only line for non-boolean settings (e.g. PrimaryEnforcement,
 * logLevel) so the operator sees the full picture without an exit to the
 * raw API.
 *
 * Toggling a switch fires `useUpdateEndpointConfig` with the body shape
 *   { profile: { settings: { <flag>: <new boolean> } } }
 * and the hook (Phase E2 enhancement) deep-merges the change into both
 * the endpoint detail cache (`profile.settings`) and the overview cache
 * (`configFlags`) for an instant flip; rollback restores both on a 5xx.
 *
 * Inline MessageBar feedback ("Updated <flag>" / "Failed: <message>")
 * sits at the top of the tab and dismisses after a few seconds. The
 * Switch currently in flight is disabled to prevent double-fires.
 *
 * Coercion notes (RFC compliance):
 *   - The Entra-style preset stores boolean flags as the strings 'True'
 *     and 'False' so we coerce both string forms and native booleans
 *     into a single `boolean` for the UI.
 *   - We always send the new value as a JS boolean - the server's
 *     `AllowAndCoerceBooleanStrings` machinery accepts either form.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Switch,
  Radio,
  RadioGroup,
  Dropdown,
  Option,
  Input,
  Spinner,
  Badge,
  Text,
  Subtitle1,
  Subtitle2,
  Caption1,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import {
  useEndpointOverview,
  useUpdateEndpointConfig,
} from '../api/queries';
import type { EndpointOverviewResponse } from '@scim/types/dashboard.types';
import { LoadingSkeleton, SettingsJsonExport } from '../components/primitives';
import {
  BOOLEAN_FLAGS,
  CATEGORY_ORDER,
  ENUM_SETTINGS,
  NUMBER_SETTINGS,
  effectiveBooleanSetting as coerceFlag,
  effectiveNumberSetting as getNumberFlag,
  type BooleanSettingDefinition as BoolFlag,
  type EnumSettingDefinition as EnumSetting,
  type NumberSettingDefinition as NumberSetting,
} from './endpoint-settings-definitions';
import { AUTH_METHOD_FLAGS } from './endpoint-auth-flags';

/*
 * Setting definitions live in endpoint-settings-definitions.ts. Settings is
 * the full inventory; operational tabs consume contextual subsets from the
 * same registry so defaults, bounds, and descriptions cannot drift.
 */

/** Return the flag key currently in flight (for Switch.disabled state). */
function pendingFlagKey(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object') return undefined;
  const profile = (variables as { profile?: { settings?: Record<string, unknown> } }).profile;
  const settings = profile?.settings;
  if (!settings) return undefined;
  const keys = Object.keys(settings);
  return keys.length > 0 ? keys[0] : undefined;
}

// ─── Styles ────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: '16px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
    gap: '12px',
  },
  card: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  generalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    gap: '12px',
  },
  flagRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  flagHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
  },
  flagDescription: {
    color: tokens.colorNeutralForeground3,
  },
  monospace: { fontFamily: 'monospace' },
  center: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '150px',
  },
});

// ─── Component ─────────────────────────────────────────────────────────

export interface SettingsTabProps {
  endpointId: string;
}

interface Feedback {
  type: 'success' | 'error';
  message: string;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpointOverview(endpointId);
  const updateMutation = useUpdateEndpointConfig(endpointId);
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);

  // Auto-dismiss feedback after 4s.
  React.useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  if (isLoading) {
    // G1 - settings is a stack of form rows; mirror with several
    // shorter skeleton bands instead of an indeterminate Spinner.
    return (
      <div data-testid="settings-loading">
        <LoadingSkeleton
          count={6}
          height="56px"
          data-testid="settings-skeleton"
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={classes.center} data-testid="settings-error">
        <Text>Failed to load settings.</Text>
      </div>
    );
  }

  const overview: EndpointOverviewResponse = data;
  const flags = overview.configFlags ?? {};
  const pendingKey = pendingFlagKey(updateMutation.variables);
  const isPending = updateMutation.isPending;

  // Build the effective settings in the exact PATCH-body shape so the export
  // JSON can be pasted straight back into an API request, saved as a backup,
  // or diffed against an earlier capture.
  const effectiveSettings: Record<string, boolean | string | number> = {};
  for (const flag of BOOLEAN_FLAGS) {
    effectiveSettings[flag.key] = coerceFlag(flags[flag.key], flag.defaultValue);
  }
  effectiveSettings.CredentialSecretVisibility =
    typeof flags.CredentialSecretVisibility === 'string' &&
    flags.CredentialSecretVisibility.toLowerCase() === 'once'
      ? 'once'
      : 'always';
  for (const s of ENUM_SETTINGS) {
    const v = flags[s.key];
    effectiveSettings[s.key] = typeof v === 'string' && v !== '' ? v : s.defaultValue;
  }
  // Number settings are OPTIONAL overrides - include only the ones explicitly
  // set so the exported PATCH body reflects "unset = inherit server default".
  for (const s of NUMBER_SETTINGS) {
    const v = getNumberFlag(flags[s.key]);
    if (v !== undefined) effectiveSettings[s.key] = v;
  }
  const settingsExport = { profile: { settings: effectiveSettings } };

  async function handleToggle(flag: BoolFlag, nextChecked: boolean) {
    setFeedback(null);
    try {
      await updateMutation.mutateAsync({
        profile: { settings: { [flag.key]: nextChecked } },
      });
      setFeedback({
        type: 'success',
        message: `${flag.label} set to ${nextChecked ? 'on' : 'off'}.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed.';
      setFeedback({
        type: 'error',
        message: `Failed to update ${flag.label}: ${msg}`,
      });
    }
  }

  // WI-7: CredentialSecretVisibility is an enum (always|once), not a boolean.
  const visibilityRaw = typeof flags.CredentialSecretVisibility === 'string'
    ? flags.CredentialSecretVisibility.toLowerCase()
    : 'always';
  const visibility = visibilityRaw === 'once' ? 'once' : 'always';
  const visibilityPending = isPending && pendingKey === 'CredentialSecretVisibility';

  async function handleVisibilityChange(next: 'always' | 'once') {
    if (next === visibility) return;
    setFeedback(null);
    try {
      await updateMutation.mutateAsync({
        profile: { settings: { CredentialSecretVisibility: next } },
      });
      setFeedback({ type: 'success', message: `CredentialSecretVisibility set to ${next}.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed.';
      setFeedback({ type: 'error', message: `Failed to update CredentialSecretVisibility: ${msg}` });
    }
  }

  async function handleEnumChange(setting: EnumSetting, next: string) {
    const current = typeof flags[setting.key] === 'string' ? (flags[setting.key] as string) : setting.defaultValue;
    if (next === current) return;
    setFeedback(null);
    try {
      await updateMutation.mutateAsync({
        profile: { settings: { [setting.key]: next } },
      });
      setFeedback({ type: 'success', message: `${setting.label} set to ${next}.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed.';
      setFeedback({ type: 'error', message: `Failed to update ${setting.label}: ${msg}` });
    }
  }

  async function handleNumberChange(setting: NumberSetting, raw: string) {
    const trimmed = raw.trim();
    // Blank = inherit the server default (no-op; keep the existing value).
    if (trimmed === '') return;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      setFeedback({ type: 'error', message: `${setting.label} must be a whole number.` });
      return;
    }
    if (n < setting.min || n > setting.max) {
      setFeedback({
        type: 'error',
        message: `${setting.label} must be between ${setting.min} and ${setting.max}.`,
      });
      return;
    }
    if (getNumberFlag(flags[setting.key]) === n) return;
    setFeedback(null);
    try {
      await updateMutation.mutateAsync({
        profile: { settings: { [setting.key]: n } },
      });
      setFeedback({ type: 'success', message: `${setting.label} set to ${n}.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed.';
      setFeedback({ type: 'error', message: `Failed to update ${setting.label}: ${msg}` });
    }
  }

  return (
    <div className={classes.root} data-testid="settings-tab">
      <Subtitle1>Endpoint Configuration</Subtitle1>

      <SettingsJsonExport
        value={settingsExport}
        filename={`endpoint-${overview.endpoint.name}-settings.json`}
        copyLabel="Copy settings as JSON"
        data-testid="settings-tab-export"
      />

      {feedback && feedback.type === 'success' && (
        <MessageBar intent="success" data-testid="settings-feedback-success">
          <MessageBarBody>
            <MessageBarTitle>Saved</MessageBarTitle>
            {feedback.message}
          </MessageBarBody>
        </MessageBar>
      )}
      {feedback && feedback.type === 'error' && (
        <MessageBar intent="error" data-testid="settings-feedback-error">
          <MessageBarBody>
            <MessageBarTitle>Update failed</MessageBarTitle>
            {feedback.message}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={classes.grid}>
        {/* ── General info card ─────────────────────────────────── */}
        <Card className={classes.card}>
          <Caption1>General</Caption1>
          <div className={classes.generalRow}>
            <Text>Name</Text>
            <Text weight="semibold">{overview.endpoint.name}</Text>
          </div>
          <div className={classes.generalRow}>
            <Text>SCIM Path</Text>
            <Caption1 className={classes.monospace}>{overview.endpoint.scimBasePath}</Caption1>
          </div>
          <div className={classes.generalRow}>
            <Text>Status</Text>
            <Badge appearance="filled" color={overview.endpoint.active ? 'success' : 'warning'}>
              {overview.endpoint.active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          {overview.endpoint.preset && (
            <div className={classes.generalRow}>
              <Text>Preset</Text>
              <Badge appearance="outline">{overview.endpoint.preset}</Badge>
            </div>
          )}
        </Card>

        {/* ── Boolean toggles grouped by category ──────────────── */}
        {CATEGORY_ORDER.map((category) => {
          const flagsInCategory = BOOLEAN_FLAGS.filter((f) => f.category === category);
          if (flagsInCategory.length === 0) return null;
          const catTestId = `settings-category-${category.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
          return (
            <Card key={category} className={classes.card} data-testid={catTestId}>
              <Caption1>{category}</Caption1>
              {flagsInCategory.map((flag) => {
                const authMethod = AUTH_METHOD_FLAGS.find((candidate) => candidate.key === flag.key);
                const resolvedEnabled = authMethod
                  ? overview.connectionInfo.enabledMethods.find((method) => method.method === authMethod.method)
                  : undefined;
                const resolvedDisabled = authMethod
                  ? overview.connectionInfo.disabledMethods.find((method) => method.method === authMethod.method)
                  : undefined;
                const resolved = resolvedEnabled ?? resolvedDisabled;
                const managedByMethod = resolved?.enablementSource === 'authentication-method';
                const checked = resolved
                  ? Boolean(resolvedEnabled)
                  : coerceFlag(flags[flag.key], flag.defaultValue);
                const disabled = (isPending && pendingKey === flag.key) || managedByMethod;
                return (
                  <div key={flag.key} className={classes.flagRow} data-testid={`settings-flag-row-${flag.key}`}>
                    <div className={classes.flagHeader}>
                      <Text className={classes.monospace}>{flag.label}</Text>
                      <Switch
                        aria-label={flag.label}
                        data-testid={`settings-flag-${flag.key}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={(_, d) => { void handleToggle(flag, d.checked); }}
                      />
                    </div>
                    <Caption1 className={classes.flagDescription} data-testid={`settings-flag-desc-${flag.key}`}>
                      {flag.description}
                    </Caption1>
                    {managedByMethod && (
                      <Caption1
                        className={classes.flagDescription}
                        data-testid={`settings-flag-source-${flag.key}`}
                      >
                        Managed by Authentication methods. Change it in Connect.
                      </Caption1>
                    )}
                  </div>
                );
              })}
            </Card>
          );
        })}

        {/* ── WI-7: CredentialSecretVisibility (enum) ──────────── */}
        <Card className={classes.card} data-testid="settings-credential-visibility">
          <Caption1>Credential secret visibility</Caption1>
          <div className={classes.flagRow}>
            <RadioGroup
              layout="horizontal"
              value={visibility}
              disabled={visibilityPending}
              onChange={(_, d) => { void handleVisibilityChange(d.value as 'always' | 'once'); }}
              aria-label="CredentialSecretVisibility"
            >
              <Radio value="always" label="always (retain + reveal)" data-testid="credential-visibility-always" />
              <Radio value="once" label="once (show at create only)" data-testid="credential-visibility-once" />
            </RadioGroup>
            <Caption1 className={classes.flagDescription}>
              WI-7: whether a per-endpoint credential secret is retained (encrypted at rest) and
              re-viewable by an admin, or shown exactly once at creation. The server-scope setting
              is the ceiling - if the server is set to &quot;once&quot; this endpoint is forced to
              &quot;once&quot; regardless of the value here.
            </Caption1>
          </div>
        </Card>

        {/* ── Enumerated (multi-option) settings card ──────────── */}
        <Card className={classes.card} data-testid="settings-enum-settings">
          <Caption1>Enumerated settings</Caption1>
          {ENUM_SETTINGS.map((setting) => {
            const raw = flags[setting.key];
            const current = typeof raw === 'string' && raw !== '' ? raw : setting.defaultValue;
            const disabled = isPending && pendingKey === setting.key;
            const selectedLabel = setting.options.find((o) => o.value === current)?.label ?? current;
            return (
              <div key={setting.key} className={classes.flagRow} data-testid={`settings-enum-${setting.key}`}>
                <div className={classes.flagHeader}>
                  <Text className={classes.monospace}>{setting.label}</Text>
                  <Dropdown
                    aria-label={setting.label}
                    value={selectedLabel}
                    selectedOptions={[current]}
                    disabled={disabled}
                    onOptionSelect={(_, d) => {
                      if (d.optionValue) void handleEnumChange(setting, d.optionValue);
                    }}
                    data-testid={`settings-enum-${setting.key}-dropdown`}
                  >
                    {setting.options.map((o) => (
                      <Option key={o.value} value={o.value} text={o.label}>
                        {o.label}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
                <Caption1 className={classes.flagDescription}>{setting.description}</Caption1>
              </div>
            );
          })}
        </Card>

        {/* ── Runtime egress (WIF JWKS fetch) numeric overrides ─── */}
        <Card className={classes.card} data-testid="settings-number-settings">
          <Caption1>Runtime egress (WIF JWKS fetch)</Caption1>
          {NUMBER_SETTINGS.map((setting) => {
            const current = getNumberFlag(flags[setting.key]);
            const currentDisplay = current !== undefined ? String(current) : '';
            const disabled = isPending && pendingKey === setting.key;
            return (
              <div key={setting.key} className={classes.flagRow} data-testid={`settings-number-${setting.key}`}>
                <div className={classes.flagHeader}>
                  <Text className={classes.monospace}>{setting.label}</Text>
                  <Input
                    // Re-mount when the persisted value changes so the field
                    // reflects the latest server state (blank = inherit default).
                    key={`${setting.key}-${currentDisplay}`}
                    type="number"
                    defaultValue={currentDisplay}
                    placeholder={`server default: ${setting.serverDefault}`}
                    min={setting.min}
                    max={setting.max}
                    disabled={disabled}
                    aria-label={setting.label}
                    onBlur={(e) => { void handleNumberChange(setting, e.target.value); }}
                    data-testid={`settings-number-${setting.key}-input`}
                  />
                </div>
                <Caption1 className={classes.flagDescription}>{setting.description}</Caption1>
              </div>
            );
          })}
        </Card>
      </div>

      {/* Pending indicator at the bottom (kept separate from feedback bar) */}
      {isPending && (
        <Subtitle2>
          <Spinner size="tiny" /> Saving {pendingKey ?? 'flag'}...
        </Subtitle2>
      )}
    </div>
  );
};
