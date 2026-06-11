/**
 * SettingsPage - global app settings and version info.
 * Accessible via /settings sidebar link.
 *
 * Phase G1: loading state migrated from Spinner to LoadingSkeleton
 * (3 card-shaped tiles mirroring the final grid of Server Info /
 * Health / Storage cards).
 */
import React, { useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Text,
  Subtitle1,
  Subtitle2,
  Caption1,
  Dropdown,
  Option,
  Switch,
  Input,
  Field,
  Divider,
  Button,
} from '@fluentui/react-components';
import { useVersion, useHealth, useLogConfig, useUpdateLogConfig } from '../api/queries';
import type { LogConfigResponse } from '../api/queries';
import { LoadingSkeleton, CopyableField, CopyJsonButton, CopyableJsonBlock } from '../components/primitives';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';
import { resetOnboarding } from '../hooks/useOnboarding';

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' },
  card: { padding: '20px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' },
  // Phase L4 - log config section
  logConfigCard: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' },
  logConfigHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' },
  logConfigGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  },
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '8px',
  },
  categoryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusSmall,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

export const SettingsPage: React.FC = () => {
  const classes = useStyles();
  const { data: version, isLoading: vLoading } = useVersion();
  const { data: health, isLoading: hLoading } = useHealth();

  if (vLoading || hLoading) {
    // G1 - card-shaped skeleton mirrors the final 3-card layout.
    return (
      <div className={classes.page} data-testid="settings-page-loading">
        <div className={classes.grid} data-testid="settings-page-skeleton-grid">
          {Array.from({ length: 3 }, (_, i) => (
            <LoadingSkeleton
              key={i}
              count={1}
              height="180px"
              data-testid="settings-page-skeleton"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={classes.page} data-testid="settings-page">
      <Subtitle1>Settings</Subtitle1>

      <div className={classes.grid}>
        <Card className={classes.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Subtitle2>Server Info</Subtitle2>
            {version && (
              <CopyJsonButton
                value={version}
                label="Copy server info as JSON"
                data-testid="settings-version-copy-json"
              />
            )}
          </div>
          {version && (
            <>
              <div className={classes.row}>
                <Text>Version</Text>
                <CopyableField
                  value={version.version}
                  monospace
                  data-testid="settings-version-value"
                  ariaLabel={`Copy version ${version.version}`}
                />
              </div>
              <div className={classes.row}>
                <Text>Node.js</Text>
                <CopyableField
                  value={version.runtime?.node ?? '-'}
                  monospace
                  data-testid="settings-node-value"
                />
              </div>
              <div className={classes.row}>
                <Text>Platform</Text>
                <CopyableField
                  value={`${version.runtime?.platform ?? '?'} / ${version.runtime?.arch ?? '?'}`}
                  monospace
                  data-testid="settings-platform-value"
                />
              </div>
              <div className={classes.row}>
                <Text>Uptime</Text>
                <Caption1>{Math.floor(version.service?.uptimeSeconds / 60)}m {Math.floor(version.service?.uptimeSeconds % 60)}s</Caption1>
              </div>
            </>
          )}
        </Card>

        <Card className={classes.card}>
          <Subtitle2>Health</Subtitle2>
          <div className={classes.row}>
            <Text>Status</Text>
            <Text weight="semibold" style={{ color: health?.status === 'ok' ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
              {health?.status ?? 'unknown'}
            </Text>
          </div>
          <div className={classes.row}>
            <Text>Uptime</Text>
            <Caption1>{health?.uptime ? `${Math.floor(health.uptime)}s` : '-'}</Caption1>
          </div>
        </Card>

        {version?.storage && (
          <Card className={classes.card}>
            <Subtitle2>Storage</Subtitle2>
            <div className={classes.row}>
              <Text>Backend</Text>
              <Caption1>{version.storage.persistenceBackend}</Caption1>
            </div>
            <div className={classes.row}>
              <Text>Provider</Text>
              <Caption1>{version.storage.databaseProvider}</Caption1>
            </div>
          </Card>
        )}
      </div>

      {/* Phase L4 - log config admin */}
      <LogConfigSection />

      {/* Phase N2 - re-open onboarding wizard */}
      <OnboardingResetCard />
    </div>
  );
};

// ─── Phase N2: OnboardingResetCard ───────────────────────────────
//
// Escape hatch for operators who want to re-watch the first-run
// wizard (demos, training). Clicking the link clears the
// `scimserver.onboarding.completedAt` flag and sets the
// `scimserver.onboarding.forceOpen` flag so the wizard appears even
// on tenants that already have endpoints.

const OnboardingResetCard: React.FC = () => {
  const classes = useStyles();
  return (
    <Card className={classes.card} data-testid="settings-onboarding-reset-card">
      <Subtitle2>Onboarding</Subtitle2>
      <div className={classes.row}>
        <Text>Show the first-run onboarding wizard again</Text>
        <Button
          appearance="subtle"
          onClick={() => resetOnboarding()}
          data-testid="settings-onboarding-reset-button"
        >
          Show onboarding
        </Button>
      </div>
    </Card>
  );
};

// ─── Phase L4: LogConfigSection ─────────────────────────────────
//
// Wires GET + PUT /admin/log-config into SettingsPage. Optimistic
// merge via useUpdateLogConfig (rollback on error). Closed-set
// pickers seeded from response.availableLevels + availableCategories.

const LogConfigSection: React.FC = () => {
  const classes = useStyles();
  const { data, isLoading, isError, error } = useLogConfig();
  const update = useUpdateLogConfig();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const apply = async (body: Parameters<typeof update.mutateAsync>[0]): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(body);
    } catch (err) {
      setSubmitError(err);
    }
  };

  if (isLoading) {
    return (
      <Card className={classes.logConfigCard} data-testid="log-config-section">
        <LoadingSkeleton count={1} height="40px" />
        <LoadingSkeleton count={3} height="32px" />
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card className={classes.logConfigCard} data-testid="log-config-section">
        <Subtitle2>Log configuration</Subtitle2>
        <ScimErrorMessage error={error ?? new Error('Failed to load log config')} />
      </Card>
    );
  }

  const cfg: LogConfigResponse = data;

  return (
    <Card className={classes.logConfigCard} data-testid="log-config-section">
      <div className={classes.logConfigHeader}>
        <Subtitle1>Log configuration</Subtitle1>
        <Caption1>
          Audit trail for changes flows into <code>/scim/admin/logs</code> and the LogStreamDrawer (Pulse icon in the header).
        </Caption1>
      </div>

      <div className={classes.logConfigGrid}>
        <Field label="Global level">
          <Dropdown
            value={cfg.globalLevel}
            selectedOptions={[cfg.globalLevel]}
            onOptionSelect={(_, d) => {
              const v = d.optionValue ?? '';
              if (v && v !== cfg.globalLevel) void apply({ globalLevel: v });
            }}
            disabled={update.isPending}
            data-testid="log-config-global-level"
          >
            {cfg.availableLevels.map((lvl) => (
              <Option key={lvl} value={lvl}>{lvl}</Option>
            ))}
          </Dropdown>
        </Field>

        <Field label="Format">
          <Dropdown
            value={cfg.format}
            selectedOptions={[cfg.format]}
            onOptionSelect={(_, d) => {
              const v = d.optionValue;
              if ((v === 'pretty' || v === 'json') && v !== cfg.format) {
                void apply({ format: v });
              }
            }}
            disabled={update.isPending}
            data-testid="log-config-format"
          >
            <Option value="pretty">pretty</Option>
            <Option value="json">json</Option>
          </Dropdown>
        </Field>

        <Field label="Include payloads">
          <Switch
            checked={cfg.includePayloads}
            onChange={(_, d) => void apply({ includePayloads: d.checked })}
            disabled={update.isPending}
            data-testid="log-config-include-payloads"
          />
        </Field>

        <Field label="Include stack traces">
          <Switch
            checked={cfg.includeStackTraces}
            onChange={(_, d) => void apply({ includeStackTraces: d.checked })}
            disabled={update.isPending}
            data-testid="log-config-include-stacks"
          />
        </Field>
      </div>

      <Divider />

      <div>
        <Subtitle2>Per-category levels ({cfg.availableCategories.length})</Subtitle2>
        <Caption1>
          Empty cells inherit the global level. Pick a per-category override to scope verbosity.
        </Caption1>
        <div className={classes.categoryGrid} style={{ marginTop: '8px' }}>
          {cfg.availableCategories.map((cat) => {
            const current = cfg.categoryLevels[cat] ?? cfg.globalLevel;
            return (
              <div
                key={cat}
                className={classes.categoryRow}
                data-testid={`log-config-category-${cat}`}
              >
                <Text style={{ fontFamily: tokens.fontFamilyMonospace }}>{cat}</Text>
                <Dropdown
                  value={current}
                  selectedOptions={[current]}
                  onOptionSelect={(_, d) => {
                    const v = d.optionValue ?? '';
                    if (v && v !== current) void apply({ categoryLevels: { [cat]: v } });
                  }}
                  disabled={update.isPending}
                  data-testid={`log-config-category-${cat}-dropdown`}
                  style={{ minWidth: '110px' }}
                >
                  {cfg.availableLevels.map((lvl) => (
                    <Option key={lvl} value={lvl}>{lvl}</Option>
                  ))}
                </Dropdown>
              </div>
            );
          })}
        </div>
      </div>

      <Divider />

      <div className={classes.logConfigGrid}>
        <Field label="Max payload size (bytes)">
          <Input
            type="number"
            value={String(cfg.maxPayloadSizeBytes)}
            onChange={(_e, d) => {
              const n = Number(d.value);
              if (Number.isFinite(n) && n >= 0 && n !== cfg.maxPayloadSizeBytes) {
                void apply({ maxPayloadSizeBytes: n });
              }
            }}
            disabled={update.isPending}
            data-testid="log-config-max-payload"
          />
        </Field>

        <Field label="Slow request threshold (ms)">
          <Input
            type="number"
            value={String(cfg.slowRequestThresholdMs ?? 1000)}
            onChange={(_e, d) => {
              const n = Number(d.value);
              if (Number.isFinite(n) && n > 0 && n !== cfg.slowRequestThresholdMs) {
                void apply({ slowRequestThresholdMs: n });
              }
            }}
            disabled={update.isPending}
            data-testid="log-config-slow-threshold"
          />
        </Field>
      </div>

      <ScimErrorMessage error={submitError} />
    </Card>
  );
};
