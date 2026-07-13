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
  Radio,
  RadioGroup,
  Input,
  Field,
  Divider,
  Button,
  Link,
} from '@fluentui/react-components';
import { useNavigate } from '@tanstack/react-router';
import { useVersion, useHealth, useLogConfig, useUpdateLogConfig, useJwksHostAllowlist, useAddJwksHost, useRemoveJwksHost, useUpdateJwksHost, usePatchJwksHosts, useSecuritySettings, useUpdateSecuritySettings, useServerConnectionSecrets } from '../api/queries';
import type { LogConfigResponse } from '../api/queries';
import { LoadingSkeleton, CopyableField, CopyJsonButton, CopyableJsonBlock, SettingsJsonExport } from '../components/primitives';
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
  // WI-15 - JWKS host add row
  jwksAddRow: { display: 'flex', gap: '12px', alignItems: 'flex-end' },
  jwksAddField: { flex: 1 },
  jwksDivider: { marginTop: '8px', marginBottom: '8px' },
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

      {/* R4b - SCIMServer-level (global) connection info for admins */}
      <ServerConnectionInfoCard />

      {/* Phase L4 - log config admin */}
      <LogConfigSection />

      {/* WI-15 - JWKS host allowlist admin */}
      <JwksHostAllowlistSection />

      {/* WI-8 - server-scope credential security settings */}
      <SecuritySettingsSection />

      {/* Phase N2 - re-open onboarding wizard */}
      <OnboardingResetCard />
    </div>
  );
};

// ─── R4b: ServerConnectionInfoCard ───────────────────────────────
//
// SCIMServer-level (global, not per-endpoint) connection info an admin gives
// to a client that connects at the server scope: the base URL, the GLOBAL
// OAuth token endpoint (/scim/oauth/token), the global JWKS URI, the RFC 8414
// OAuth AS metadata URL, and the SCIM ServiceProviderConfig. URLs are derived
// from the browser origin (same approach the per-endpoint ConnectionPanel
// uses), so they always match this deployment. No secret is ever shown. The
// per-endpoint equivalent lives on each endpoint's Connect tab.

const ServerConnectionInfoCard: React.FC = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const prefix = 'scim';
  const urls = {
    baseUrl: origin,
    tokenEndpoint: `${origin}/${prefix}/oauth/token`,
    jwksUri: `${origin}/${prefix}/oauth/jwks`,
    oauthMetadata: `${origin}/.well-known/oauth-authorization-server`,
    scimServiceProviderConfig: `${origin}/${prefix}/v2/ServiceProviderConfig`,
  };
  // When the server CredentialSecretVisibility is `always`, surface the global
  // secrets so an admin can copy every server-scope connection parameter for an
  // Entra gallery app in one place. Withheld (null) when `once`.
  const { data: secrets } = useServerConnectionSecrets();
  const revealed = secrets?.revealed ?? false;
  const exportValue = revealed
    ? {
        ...urls,
        sharedSecret: secrets?.sharedSecret ?? null,
        oauthClientId: secrets?.oauthClientId ?? null,
        oauthClientSecret: secrets?.oauthClientSecret ?? null,
      }
    : urls;

  return (
    <Card className={classes.logConfigCard} data-testid="server-connection-info-card">
      <div className={classes.logConfigHeader}>
        <Subtitle1>Server connection info (SCIMServer level)</Subtitle1>
        <SettingsJsonExport
          value={exportValue}
          filename="scimserver-connection-info.json"
          copyLabel="Copy as JSON"
          data-testid="server-connection-info-export"
        />
      </div>
      <Caption1>
        SCIMServer-level (global) values for a client that connects at the server scope. Each
        endpoint also has its own per-endpoint values on its Connect tab. Labels follow Microsoft
        Entra ID; other IdPs (Okta, OneLogin, Ping, custom clients) use the equivalent field.
        {revealed
          ? ' Secrets are shown because CredentialSecretVisibility is "always".'
          : ' Secrets are hidden (CredentialSecretVisibility is "once"); set it to "always" below to show them.'}
      </Caption1>

      <div className={classes.row}>
        <Text>Base URL</Text>
        <CopyableField value={urls.baseUrl} monospace data-testid="server-conn-base-url" />
      </div>
      <div className={classes.row}>
        <Text>OAuth token endpoint (global)</Text>
        <CopyableField value={urls.tokenEndpoint} monospace data-testid="server-conn-token-endpoint" />
      </div>
      <div className={classes.row}>
        <Text>JWKS URI</Text>
        <CopyableField value={urls.jwksUri} monospace data-testid="server-conn-jwks-uri" />
      </div>
      <div className={classes.row}>
        <Text>OAuth metadata (RFC 8414)</Text>
        <CopyableField value={urls.oauthMetadata} monospace data-testid="server-conn-oauth-metadata" />
      </div>
      <div className={classes.row}>
        <Text>ServiceProviderConfig</Text>
        <CopyableField value={urls.scimServiceProviderConfig} monospace data-testid="server-conn-spc" />
      </div>

      {revealed && (
        <>
          <div className={classes.row}>
            <Text>Secret Token (SCIM shared secret)</Text>
            {secrets?.sharedSecret ? (
              <CopyableField value={secrets.sharedSecret} monospace data-testid="server-conn-shared-secret" />
            ) : (
              <Caption1 data-testid="server-conn-shared-secret-unset">Not configured</Caption1>
            )}
          </div>
          <div className={classes.row}>
            <Text>OAuth client id (global)</Text>
            {secrets?.oauthClientId ? (
              <CopyableField value={secrets.oauthClientId} monospace data-testid="server-conn-oauth-client-id" />
            ) : (
              <Caption1>Not configured</Caption1>
            )}
          </div>
          <div className={classes.row}>
            <Text>OAuth client secret (global)</Text>
            {secrets?.oauthClientSecret ? (
              <CopyableField value={secrets.oauthClientSecret} monospace data-testid="server-conn-oauth-client-secret" />
            ) : (
              <Caption1 data-testid="server-conn-oauth-client-secret-unset">Not configured</Caption1>
            )}
          </div>
        </>
      )}

      <Caption1>
        For per-endpoint connection details,{' '}
        <Link
          data-testid="server-conn-link-endpoints"
          onClick={() => void navigate({ to: '/endpoints' })}
        >
          open an endpoint and its Connect tab
        </Link>
        .
      </Caption1>
    </Card>
  );
};

// ─── WI-15 / R1: JwksHostAllowlistSection ────────────────────────
//
// Server-global JWKS host allowlist manager. The effective allowlist is the
// UNION of a compiled well-known seed + the JWKS_HOST_ALLOWLIST env + a
// persisted admin-editable layer. R1: the seed is prepopulated into the
// persisted table, so every allowlist host is a full CRUD row (add / edit /
// remove) - plus a PATCH-based selective bulk add-and-remove box. Convenience/
// flexibility feature - no deny-list, no lock flag.

const JwksHostAllowlistSection: React.FC = () => {
  const classes = useStyles();
  const { data, isLoading } = useJwksHostAllowlist();
  const addHost = useAddJwksHost();
  const removeHost = useRemoveJwksHost();
  const updateHost = useUpdateJwksHost();
  const patchHosts = usePatchJwksHosts();
  const [newHost, setNewHost] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editHost, setEditHost] = useState('');
  const [bulkAdd, setBulkAdd] = useState('');
  const [bulkRemove, setBulkRemove] = useState('');

  const onAdd = (): void => {
    const host = newHost.trim().toLowerCase();
    if (host === '') return;
    addHost.mutate({ host }, { onSuccess: () => setNewHost('') });
  };

  const onStartEdit = (id: string, host: string): void => {
    setEditId(id);
    setEditHost(host);
  };
  const onSaveEdit = (): void => {
    if (!editId) return;
    const host = editHost.trim().toLowerCase();
    if (host === '') return;
    updateHost.mutate({ id: editId, host }, { onSuccess: () => { setEditId(null); setEditHost(''); } });
  };

  const parseHosts = (raw: string): string[] =>
    raw.split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter(Boolean);

  const onPatch = (): void => {
    const add = parseHosts(bulkAdd);
    const remove = parseHosts(bulkRemove);
    if (add.length === 0 && remove.length === 0) return;
    patchHosts.mutate({ add, remove }, { onSuccess: () => { setBulkAdd(''); setBulkRemove(''); } });
  };

  const entries = data?.persistedEntries ?? [];

  return (
    <Card className={classes.logConfigCard} data-testid="jwks-hosts-card">
      <div className={classes.logConfigHeader}>
        <Subtitle1>JWKS host allowlist (WIF SSRF guard)</Subtitle1>
        {data && (
          <SettingsJsonExport
            value={data}
            filename="scimserver-jwks-host-allowlist.json"
            copyLabel="Copy as JSON"
            data-testid="jwks-hosts-export"
          />
        )}
      </div>
      <Caption1>
        Server-global. The effective allowlist is the union of a built-in well-known
        IdP seed (prepopulated as editable rows below), the JWKS_HOST_ALLOWLIST env var,
        and the persisted hosts. Add, edit, or remove a host to change which IdP JWKS /
        discovery endpoints are trusted - no redeploy.
      </Caption1>

      <div className={classes.jwksAddRow}>
        <Field label="Add a host (bare hostname, no scheme/path)" className={classes.jwksAddField}>
          <Input
            value={newHost}
            onChange={(_e, d) => setNewHost(d.value)}
            placeholder="login.example.com"
            data-testid="jwks-hosts-input"
          />
        </Field>
        <Button
          appearance="primary"
          onClick={onAdd}
          disabled={newHost.trim() === '' || addHost.isPending}
          data-testid="jwks-hosts-add-button"
        >
          {addHost.isPending ? 'Adding...' : 'Add host'}
        </Button>
      </div>

      {/* R1 - PATCH selective bulk add + remove */}
      <div className={classes.jwksAddRow} data-testid="jwks-hosts-patch-row">
        <Field label="Selectively add (comma/space separated)" className={classes.jwksAddField}>
          <Input
            value={bulkAdd}
            onChange={(_e, d) => setBulkAdd(d.value)}
            placeholder="a.example.com, b.example.com"
            data-testid="jwks-hosts-patch-add"
          />
        </Field>
        <Field label="Selectively remove" className={classes.jwksAddField}>
          <Input
            value={bulkRemove}
            onChange={(_e, d) => setBulkRemove(d.value)}
            placeholder="old.example.com"
            data-testid="jwks-hosts-patch-remove"
          />
        </Field>
        <Button
          appearance="secondary"
          onClick={onPatch}
          disabled={(bulkAdd.trim() === '' && bulkRemove.trim() === '') || patchHosts.isPending}
          data-testid="jwks-hosts-patch-button"
        >
          {patchHosts.isPending ? 'Applying...' : 'Apply changes'}
        </Button>
      </div>

      <ScimErrorMessage error={addHost.error ?? removeHost.error ?? updateHost.error ?? patchHosts.error} />

      {isLoading && <Caption1>Loading...</Caption1>}
      {data && (
        <div data-testid="jwks-hosts-list">
          {entries.length === 0 && (
            <Caption1 data-testid="jwks-hosts-empty">No hosts configured yet.</Caption1>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className={classes.categoryRow} data-testid={`jwks-host-row-${entry.host}`}>
              {editId === entry.id ? (
                <>
                  <Input
                    value={editHost}
                    onChange={(_e, d) => setEditHost(d.value)}
                    data-testid={`jwks-host-edit-input-${entry.host}`}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      appearance="primary"
                      size="small"
                      onClick={onSaveEdit}
                      disabled={editHost.trim() === '' || updateHost.isPending}
                      data-testid={`jwks-host-save-${entry.host}`}
                    >
                      Save
                    </Button>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={() => { setEditId(null); setEditHost(''); }}
                      data-testid={`jwks-host-cancel-${entry.host}`}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Text>
                    {entry.host}
                    {entry.label ? ` (${entry.label})` : ''}
                  </Text>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={() => onStartEdit(entry.id, entry.host)}
                      data-testid={`jwks-host-edit-${entry.host}`}
                    >
                      Edit
                    </Button>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={() => removeHost.mutate(entry.host)}
                      disabled={removeHost.isPending}
                      data-testid={`jwks-host-remove-${entry.host}`}
                    >
                      Remove
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
          <Divider className={classes.jwksDivider} />
          <Caption1 data-testid="jwks-hosts-builtin">
            Built-in safety floor (compiled seed + env), always allowed even if a row is removed:{' '}
            {[...data.seed, ...data.env].join(', ')}
          </Caption1>
        </div>
      )}
    </Card>
  );
};

// ─── WI-8: SecuritySettingsSection ───────────────────────────────
//
// Server-scope credential security: the CredentialSecretVisibility ceiling
// (always | once) and the read-only KEK status. Setting the server value to
// `once` forces `once` on every endpoint (most-restrictive-wins) and purges
// any retained secret ciphertext.

const SecuritySettingsSection: React.FC = () => {
  const classes = useStyles();
  const { data, isLoading } = useSecuritySettings();
  const update = useUpdateSecuritySettings();

  const visibility = data?.credentialSecretVisibility ?? 'always';

  const onChange = (next: 'always' | 'once'): void => {
    if (next === visibility) return;
    update.mutate({ credentialSecretVisibility: next });
  };

  return (
    <Card className={classes.logConfigCard} data-testid="security-settings-card">
      <div className={classes.logConfigHeader}>
        <Subtitle1>Credential secret security (server)</Subtitle1>
        {data && (
          <SettingsJsonExport
            value={{ credentialSecretVisibility: data.credentialSecretVisibility }}
            filename="scimserver-security-settings.json"
            copyLabel="Copy settings as JSON"
            data-testid="security-settings-export"
          />
        )}
      </div>
      <Caption1>
        Server-scope ceiling for whether per-endpoint credential secrets are retained
        (encrypted at rest) and re-viewable by an admin. Setting this to &quot;once&quot; forces
        every endpoint to &quot;once&quot; and purges any retained secret copies, regardless of the
        per-endpoint setting.
      </Caption1>

      {isLoading && <Caption1>Loading...</Caption1>}
      {data && (
        <>
          <Field label="CredentialSecretVisibility (server ceiling)">
            <RadioGroup
              layout="horizontal"
              value={visibility}
              disabled={update.isPending}
              onChange={(_e, d) => onChange(d.value as 'always' | 'once')}
              data-testid="security-visibility-group"
            >
              <Radio value="always" label="always (retain + reveal)" data-testid="security-visibility-always" />
              <Radio value="once" label="once (show at create only)" data-testid="security-visibility-once" />
            </RadioGroup>
          </Field>

          <div className={classes.row}>
            <Text>Credential KEK</Text>
            <Text data-testid="security-kek-status">
              {data.kek.isDefault
                ? 'default (cosmetic - set a private CREDENTIAL_KEK in prod)'
                : 'configured (private)'}
            </Text>
          </div>
        </>
      )}

      <ScimErrorMessage error={update.error} />
    </Card>
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
        <SettingsJsonExport
          value={{ globalLevel: cfg.globalLevel, categoryLevels: cfg.categoryLevels }}
          filename="scimserver-log-config.json"
          copyLabel="Copy settings as JSON"
          data-testid="log-config-export"
        />
      </div>
      <Caption1>
        Audit trail for changes flows into <code>/scim/admin/logs</code> and the LogStreamDrawer (Pulse icon in the header).
      </Caption1>

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
