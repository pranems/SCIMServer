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
import { LoadingSkeleton } from '../components/primitives';

// ─── Curated boolean flag registry ────────────────────────────────────
// Each entry is a known boolean ProfileSetting (api/src/modules/scim/
// endpoint-profile/endpoint-profile.types.ts ProfileSettings interface).
// `defaultValue` mirrors the documented default when the flag is absent
// from the endpoint profile so the Switch state matches server behavior.

interface BoolFlag {
  key: string;
  label: string;
  description: string;
  defaultValue: boolean;
}

const BOOLEAN_FLAGS: ReadonlyArray<BoolFlag> = [
  // ── Validation & schema ───────────────────────────────────────────
  {
    key: 'StrictSchemaValidation',
    label: 'StrictSchemaValidation',
    description: 'Reject resources whose schemas[] is missing a declared extension URN.',
    defaultValue: false,
  },
  {
    key: 'AllowAndCoerceBooleanStrings',
    label: 'AllowAndCoerceBooleanStrings',
    description: 'Coerce "True" / "False" string values to real booleans on write.',
    defaultValue: true,
  },
  // ── Concurrency / etags ───────────────────────────────────────────
  {
    key: 'RequireIfMatch',
    label: 'RequireIfMatch',
    description: 'Mandate an If-Match ETag header on PUT, PATCH, and DELETE requests.',
    defaultValue: false,
  },
  // ── Lifecycle / deletes ───────────────────────────────────────────
  {
    key: 'UserSoftDeleteEnabled',
    label: 'UserSoftDeleteEnabled',
    description: 'PATCH active=false soft-deactivates the user (default RFC behavior).',
    defaultValue: true,
  },
  {
    key: 'UserHardDeleteEnabled',
    label: 'UserHardDeleteEnabled',
    description: 'DELETE /Users/{id} permanently removes the row.',
    defaultValue: true,
  },
  {
    key: 'GroupHardDeleteEnabled',
    label: 'GroupHardDeleteEnabled',
    description: 'DELETE /Groups/{id} permanently removes the group.',
    defaultValue: true,
  },
  // ── PATCH semantics ───────────────────────────────────────────────
  {
    key: 'MultiMemberPatchOpForGroupEnabled',
    label: 'MultiMemberPatchOpForGroupEnabled',
    description: 'Accept multi-member add/remove inside a single PATCH op on a Group.',
    defaultValue: true,
  },
  {
    key: 'PatchOpAllowRemoveAllMembers',
    label: 'PatchOpAllowRemoveAllMembers',
    description: 'Allow remove path=members (clear the entire membership list).',
    defaultValue: false,
  },
  {
    key: 'VerbosePatchSupported',
    label: 'VerbosePatchSupported',
    description: 'Resolve dot-notation paths (e.g. name.familyName) inside PATCH.',
    defaultValue: false,
  },
  {
    key: 'IncludeWarningAboutIgnoredReadOnlyAttribute',
    label: 'IncludeWarningAboutIgnoredReadOnlyAttribute',
    description: 'Append a warning header when a readOnly attribute is silently stripped.',
    defaultValue: false,
  },
  {
    key: 'IgnoreReadOnlyAttributesInPatch',
    label: 'IgnoreReadOnlyAttributesInPatch',
    description: 'Strip (instead of reject) readOnly attributes encountered in PATCH ops.',
    defaultValue: false,
  },
  // ── Discovery / auth ──────────────────────────────────────────────
  {
    key: 'SchemaDiscoveryEnabled',
    label: 'SchemaDiscoveryEnabled',
    description: 'Expose /Schemas, /ResourceTypes, /ServiceProviderConfig under this endpoint.',
    defaultValue: true,
  },
  {
    key: 'CustomResourceTypesEnabled',
    label: 'CustomResourceTypesEnabled',
    description: 'Allow registering custom resource types (beyond User and Group) on the Resource Types tab.',
    defaultValue: false,
  },
  {
    key: 'PerEndpointCredentialsEnabled',
    label: 'PerEndpointCredentialsEnabled',
    description: 'Validate the bearer token against this endpoint\'s credential set.',
    defaultValue: false,
  },
];

// Read-only (non-boolean) flag keys we still want to surface so the
// operator can see (but not toggle) the active value. PrimaryEnforcement
// is an enum and logLevel is a string|number - both need a richer
// editor that's out of scope for E2.
const READ_ONLY_KEYS = ['PrimaryEnforcement', 'logLevel'] as const;

// ─── Helpers ───────────────────────────────────────────────────────────

/** Coerce 'True'/'False' (Entra style) and booleans into a JS boolean. */
function coerceFlag(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return fallback;
}

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

  const readOnlyEntries = READ_ONLY_KEYS
    .map((k) => [k, flags[k]] as const)
    .filter(([, v]) => v !== undefined && v !== null && v !== '');

  return (
    <div className={classes.root} data-testid="settings-tab">
      <Subtitle1>Endpoint Configuration</Subtitle1>

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

        {/* ── Boolean toggles card ─────────────────────────────── */}
        <Card className={classes.card}>
          <Caption1>Configuration Flags</Caption1>
          {BOOLEAN_FLAGS.map((flag) => {
            const checked = coerceFlag(flags[flag.key], flag.defaultValue);
            const disabled = isPending && pendingKey === flag.key;
            return (
              <div key={flag.key} className={classes.flagRow}>
                <div className={classes.flagHeader}>
                  <Text className={classes.monospace}>{flag.label}</Text>
                  <Switch
                    aria-label={flag.label}
                    checked={checked}
                    disabled={disabled}
                    onChange={(_, d) => { void handleToggle(flag, d.checked); }}
                  />
                </div>
                <Caption1 className={classes.flagDescription}>{flag.description}</Caption1>
              </div>
            );
          })}
        </Card>

        {/* ── Read-only (non-boolean) settings card ────────────── */}
        {readOnlyEntries.length > 0 && (
          <Card className={classes.card}>
            <Caption1>Read-only Settings</Caption1>
            {readOnlyEntries.map(([key, value]) => (
              <div key={key} className={classes.generalRow}>
                <Text className={classes.monospace}>{key}</Text>
                <Badge appearance="outline">{String(value)}</Badge>
              </div>
            ))}
            <Caption1 className={classes.flagDescription}>
              These settings have non-boolean values; edit via the admin API.
            </Caption1>
          </Card>
        )}
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
