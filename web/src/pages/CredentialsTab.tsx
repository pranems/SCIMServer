/**
 * CredentialsTab - per-endpoint bearer credential manager.
 *
 * Phase E1 per UI_REDESIGN_REMAINING_GAPS_PLAN.md S8.1.
 *
 * Lists credentials from `useEndpointOverview(id).credentials` (Phase B1
 * BFF - zero extra round trips). Create button opens a FormDialog with
 * label + optional expiresAt; on submit calls `useCreateCredential` and
 * shows the plaintext token EXACTLY ONCE (the bcrypt hash is what the
 * server stores; the plaintext is unrecoverable after this view).
 *
 * Delete row -> confirm FormDialog -> `useDeleteCredential` (optimistic
 * remove from cached overview, rollback on error).
 *
 * Backend already supports CRUD per docs/auth/G11_PER_ENDPOINT_CREDENTIALS.md.
 * Requires PerEndpointCredentialsEnabled=True on the endpoint - 403
 * surfaces as a friendly explanation banner with link to settings.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Subtitle1,
  Subtitle2,
  Body1,
  Caption1,
  Button,
  Badge,
  Input,
  Field,
  Text,
  Textarea,
  Dropdown,
  Option,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Link,
  TabList,
  Tab,
  InfoLabel,
  Tooltip,
  Menu,
  MenuTrigger,
  MenuList,
  MenuItem,
  MenuPopover,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
} from '@fluentui/react-components';
import { useNavigate } from '@tanstack/react-router';
import {
  Add24Regular,
  Delete24Regular,
  Edit24Regular,
  Copy16Regular,
  Key24Regular,
  Warning24Regular,
  ShieldKeyhole24Regular,
  PlugConnected24Regular,
  MoreHorizontal24Regular,
} from '@fluentui/react-icons';
import {
  useEndpointOverview,
  useCreateCredential,
  useDeleteCredential,
  useActivateCredential,
  useDeactivateCredential,
  useEditCredentialLabel,
  useResolveWifDiscovery,
  useRevealCredential,
  type RevealResult,
  useRotateCredential,
  type RotateResult,
  useJwksHostAllowlist,
  useAddJwksHost,
  useUpdateWifCredential,
  useVerifyWifTrust,
  type WifVerifyResult,
  useDebugWifAssertion,
  type WifDebugAssertionResponse,
  useConnectionRetainedSecrets,
} from '../api/queries';
import type { EndpointOverviewCredential } from '@scim/types/dashboard.types';
import type { ConnectionInfo, ConnectionMethod } from '@scim/types/connection-info.types';
import {
  EmptyState,
  FormDialog,
  LoadingSkeleton,
  EditableField,
  CopyableField,
  CopyJsonButton,
  CopyableJsonBlock,
  ConnectionPanel,
  AuthDiagnosticsPanel,
  SettingsJsonExport,
} from '../components/primitives';

/**
 * P5 - the "Connect" half of the unified tab. For a specific method it renders
 * the connection-details bundle (copyable values + export) scoped to that ONE
 * method (the tab-level method sub-tabs are the single method axis, so the
 * panel's own selector is hidden). For the "All" overview it renders the full
 * panel with its selector. Retained secrets are fetched here (after the parent
 * guards) so the secret is ALWAYS shown when the effective visibility is
 * `always`, for every method. This is the operator's complete IdP-config bundle
 * in one place.
 */
const UnifiedConnectSection: React.FC<{
  endpointId: string;
  connectionInfo: ConnectionInfo;
  /** The active method sub-tab ('all' shows the full panel with selector). */
  activeMethod: 'all' | ConnectionMethod;
}> = ({ endpointId, connectionInfo, activeMethod }) => {
  const retainedSecrets = useConnectionRetainedSecrets(endpointId, connectionInfo.enabledMethods);

  if (activeMethod === 'all') {
    return (
      <ConnectionPanel
        connectionInfo={connectionInfo}
        retainedSecrets={retainedSecrets}
        data-testid="connect-tab-panel"
      />
    );
  }

  // Scope the panel to the single active method (no competing selector).
  const scoped: ConnectionInfo = {
    ...connectionInfo,
    enabledMethods: connectionInfo.enabledMethods.filter((m) => m.method === activeMethod),
  };
  if (scoped.enabledMethods.length === 0) return null;
  return (
    <ConnectionPanel
      connectionInfo={scoped}
      retainedSecrets={retainedSecrets}
      defaultMethod={activeMethod}
      hideMethodSelector
      data-testid="connect-tab-panel"
    />
  );
};

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  row: {
    padding: '12px 16px',
  },
  rowGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto auto',
    alignItems: 'center',
    gap: '12px',
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  connectPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  connectRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 180px) 1fr',
    columnGap: '12px',
    alignItems: 'center',
  },
  formCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  tokenBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  tokenRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  revealBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  forbiddenBlock: {
    padding: '16px',
  },
  errorBlock: {
    padding: '16px',
    color: tokens.colorPaletteRedForeground1,
  },
});

const useWifStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fieldGrid: {
    // WIF trust inputs stack ONE PER ROW at full width so long URLs
    // (issuer / JWKS URI / audience) are readable end-to-end and every
    // field expands with the window instead of being squeezed into a
    // scattered multi-column grid. minWidth:0 lets the flex children
    // shrink below their content width on narrow viewports.
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    minWidth: 0,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  returnBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
  returnRow: {
    display: 'grid',
    gridTemplateColumns: '160px 1fr',
    alignItems: 'center',
    gap: '8px',
  },
  testStep: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
  },
  wifRow: {
    padding: '12px 16px',
  },
  wifRowGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    alignItems: 'center',
    gap: '12px',
  },
  wifMeta: {
    color: tokens.colorNeutralForeground3,
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  // Trust field detail grid shown under each configured trust row so the
  // operator can read every important value (issuer / subject / audience /
  // JWKS / tenant / roles). label column is fixed, value column takes the
  // rest and wraps long URLs.
  wifDetailGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 160px) 1fr',
    columnGap: '12px',
    rowGap: '6px',
    marginTop: '10px',
    alignItems: 'start',
  },
  wifDetailLabel: {
    color: tokens.colorNeutralForeground3,
  },
  wifDetailValueCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
  },
  wifValidityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '10px',
  },
  editInCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  wifListHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '4px',
  },
  aliasHint: {
    display: 'block',
    color: tokens.colorNeutralForeground3,
    marginBottom: '8px',
  },
  resolveRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
    marginBottom: '8px',
  },
  jwksNotice: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  jwksHostList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  jwksHostChip: {
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

export interface CredentialsTabProps {
  endpointId: string;
}

interface CreatedCredential {
  id: string;
  label: string | null;
  plaintext: string;
  createdAt: string;
  /** R7 - the credential type that was created (bearer or oauth_client). */
  credentialType: 'bearer' | 'oauth_client';
  /** R7 - present for oauth_client: the public client identifier. */
  clientId?: string;
}

// ─── WIF (federated identity) section ──────────────────────────────────

interface WifTrustForm {
  expectedIssuer: string;
  expectedSubject: string;
  expectedAudience: string;
  jwksUri: string;
  allowedTenantId: string;
  requiredRoles: string;
  scope: string;
  /** Item E - how a missing required role is handled at auth time. */
  roleEnforcement: 'off' | 'shadow' | 'enforce';
}

const EMPTY_WIF_FORM: WifTrustForm = {
  expectedIssuer: '',
  expectedSubject: '',
  expectedAudience: '',
  jwksUri: '',
  allowedTenantId: '',
  requiredRoles: '',
  scope: '',
  roleEnforcement: 'off',
};

/** A single Test Connection readiness step (client-side dry-run). */
interface WifTestStep {
  label: string;
  ok: boolean;
}

/**
 * Read-only detail grid of a configured trust's public fields. Renders
 * every important value (issuer / subject / audience / JWKS / tenant /
 * roles / scope) so the operator can see exactly what was saved, each as
 * a copyable value. Fields the trust does not carry are shown as a muted
 * dash so the grid shape is stable.
 */
const WifTrustDetails: React.FC<{
  credId: string;
  trust: EndpointOverviewCredential['wif'];
  styles: ReturnType<typeof useWifStyles>;
}> = ({ credId, trust, styles }) => {
  const { data: allowlist } = useJwksHostAllowlist();
  if (!trust) return null;
  const effective = allowlist?.effective ?? [];
  const verified = typeof trust.lastVerifiedAt === 'string' && trust.lastVerifiedAt !== '';

  // U5 - compute a per-field validity status (ok | warning | error) for the
  // five identity fields, from client-side format + allowlist + gleaned-source
  // + last-verified signals (the authoritative check remains server-side).
  const fieldStatus = (key: string): { level: 'ok' | 'warning' | 'error'; hint: string } | null => {
    switch (key) {
      case 'issuer': {
        const err = httpsUrlError(trust.expectedIssuer ?? '');
        if (!trust.expectedIssuer) return { level: 'warning', hint: 'Missing issuer.' };
        if (err) return { level: 'error', hint: err };
        return verified
          ? { level: 'ok', hint: 'Verified reachable.' }
          : { level: 'warning', hint: 'Not yet verified - run Verify.' };
      }
      case 'jwks': {
        const err = httpsUrlError(trust.jwksUri ?? '');
        if (!trust.jwksUri) return { level: 'warning', hint: 'Missing JWKS URI.' };
        if (err) return { level: 'error', hint: err };
        const host = hostOf(trust.jwksUri);
        if (host != null && effective.length > 0 && !effective.includes(host)) {
          return { level: 'error', hint: 'JWKS host is not on the allowlist (SSRF guard).' };
        }
        return verified
          ? { level: 'ok', hint: 'Verified serving keys.' }
          : { level: 'warning', hint: 'Not yet verified - run Verify.' };
      }
      case 'subject':
        return trust.expectedSubject
          ? { level: 'ok', hint: 'Set.' }
          : { level: 'warning', hint: 'Missing subject.' };
      case 'audience':
        return trust.expectedAudience
          ? { level: 'ok', hint: 'Set.' }
          : { level: 'warning', hint: 'Missing audience.' };
      case 'tenant':
        if (trust.allowedTenantIdSource) {
          return {
            level: 'warning',
            hint: `Inferred from ${trust.allowedTenantIdSource === 'issuer' ? 'the issuer' : 'the JWKS URI'}.`,
          };
        }
        return trust.allowedTenantId
          ? { level: 'ok', hint: 'Set explicitly.' }
          : { level: 'warning', hint: 'Missing tenant id.' };
      default:
        return null;
    }
  };

  const rows: Array<{ key: string; label: string; value: string | null }> = [
    { key: 'issuer', label: 'Issuer (iss)', value: trust.expectedIssuer ?? null },
    { key: 'jwks', label: 'JWKS URI', value: trust.jwksUri ?? null },
    { key: 'subject', label: 'Subject (sub)', value: trust.expectedSubject ?? null },
    { key: 'audience', label: 'Audience (aud)', value: trust.expectedAudience ?? null },
    { key: 'tenant', label: 'Allowed tenant', value: trust.allowedTenantId ?? null },
    {
      key: 'roles',
      label: 'Required roles',
      value:
        trust.requiredRoles && trust.requiredRoles.length > 0
          ? trust.requiredRoles.join(', ')
          : null,
    },
    { key: 'scope', label: 'Issued scope', value: trust.scope ?? null },
    {
      key: 'enforcement',
      label: 'Role enforcement',
      value: trust.roleEnforcement && trust.roleEnforcement !== 'off' ? trust.roleEnforcement : 'advisory (default)',
    },
  ];
  return (
    <>
      {/* U7 - last-verified line + overall validity for this trust. */}
      <div className={styles.wifValidityRow} data-testid={`wif-credential-${credId}-validity`}>
        <Badge appearance="filled" color={verified ? 'success' : 'warning'}>
          {verified ? 'Verified' : 'Unverified'}
        </Badge>
        <Caption1>
          {verified
            ? `Last verified ${new Date(trust.lastVerifiedAt as string).toLocaleString()}`
            : 'Never verified - run Verify to confirm the issuer + JWKS are reachable.'}
        </Caption1>
      </div>
      <div className={styles.wifDetailGrid} data-testid={`wif-credential-details-${credId}`}>
        {rows.map((r) => {
          const status = fieldStatus(r.key);
          return (
            <React.Fragment key={r.key}>
              <Caption1 className={styles.wifDetailLabel}>{r.label}</Caption1>
              <div className={styles.wifDetailValueCell}>
                {r.value ? (
                  <CopyableField
                    value={r.value}
                    monospace
                    truncate
                    maxWidth="100%"
                    data-testid={`wif-credential-${credId}-${r.key}`}
                  />
                ) : (
                  <Caption1 data-testid={`wif-credential-${credId}-${r.key}`}>-</Caption1>
                )}
                {status && (
                  <Badge
                    appearance="tint"
                    color={status.level === 'ok' ? 'success' : status.level === 'warning' ? 'warning' : 'danger'}
                    title={status.hint}
                    data-testid={`wif-credential-${credId}-${r.key}-status`}
                  >
                    {status.level === 'ok' ? 'OK' : status.level === 'warning' ? '!' : 'ERR'}
                  </Badge>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
};

/** Extract the lowercase hostname from a URL string, or null if unparseable. */
function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Inline URL-format validation for a WIF field (item D). Returns an error
 * string when the value is non-empty but not a valid https URL, else
 * undefined. Empty is not an error here (required-ness is enforced at Save).
 */
function httpsUrlError(value: string): string | undefined {
  const v = value.trim();
  if (v === '') return undefined;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return 'Not a valid URL - include the https:// scheme.';
  }
  if (url.protocol !== 'https:') return 'Must use https.';
  return undefined;
}

/**
 * V1 - a human "how long is this valid" descriptor from a credential's
 * `expiresAt` (ISO string or null). No expiry => valid until revoked; an
 * expiry within 14 days is amber; a past expiry is an error.
 */
function validityDescriptor(expiresAt?: string | null): { text: string; level: 'ok' | 'warning' | 'error' } {
  if (!expiresAt) return { text: 'No expiry - valid until revoked', level: 'ok' };
  const exp = new Date(expiresAt).getTime();
  if (Number.isNaN(exp)) return { text: 'No expiry - valid until revoked', level: 'ok' };
  const now = Date.now();
  const when = new Date(expiresAt).toLocaleDateString();
  if (exp <= now) return { text: `Expired ${when}`, level: 'error' };
  const days = Math.floor((exp - now) / (1000 * 60 * 60 * 24));
  return {
    text: `Valid until ${when} - ${days} day${days === 1 ? '' : 's'} left`,
    level: days <= 14 ? 'warning' : 'ok',
  };
}

/**
 * JWKS allowlist awareness for the WIF form. Shows the current effective
 * allowlist (relevant context for the operator entering a JWKS URI), and
 * when the entered JWKS host is NOT allowed, surfaces a warning with a
 * one-click "Add to allowlist" that POSTs the host to the persisted layer
 * then and there - so the operator can fix an SSRF-block before saving
 * the trust instead of discovering it later at runtime.
 */
const JwksAllowlistNotice: React.FC<{
  jwksUri: string;
  styles: ReturnType<typeof useWifStyles>;
}> = ({ jwksUri, styles }) => {
  const { data: allowlist, isLoading } = useJwksHostAllowlist();
  const addHost = useAddJwksHost();
  const host = hostOf(jwksUri);
  const effective = allowlist?.effective ?? [];
  const isAllowed = host != null && effective.includes(host);
  const showWarning = host != null && !isLoading && !isAllowed;

  return (
    <div className={styles.jwksNotice} data-testid="wif-jwks-allowlist-notice">
      <Caption1>
        <strong>JWKS host allowlist</strong> (SSRF guard) - SCIMServer only fetches signing keys
        from these hosts at runtime. The JWKS URI host must be on this list.
      </Caption1>
      {isLoading ? (
        <Caption1>Loading allowlist...</Caption1>
      ) : (
        <div className={styles.jwksHostList} data-testid="wif-jwks-allowlist-hosts">
          {effective.length === 0 ? (
            <Caption1>(empty)</Caption1>
          ) : (
            effective.map((h) => (
              <span key={h} className={styles.jwksHostChip} data-testid={`wif-jwks-host-${h}`}>
                {h}
              </span>
            ))
          )}
        </div>
      )}
      {host != null && isAllowed && (
        <MessageBar intent="success" data-testid="wif-jwks-host-ok">
          <MessageBarBody>
            The JWKS host <code>{host}</code> is on the allowlist.
          </MessageBarBody>
        </MessageBar>
      )}
      {showWarning && (
        <MessageBar intent="warning" data-testid="wif-jwks-host-warning">
          <MessageBarBody>
            <MessageBarTitle>JWKS host not on the allowlist</MessageBarTitle>
            <code>{host}</code> is not allowed, so SCIMServer will refuse to fetch its signing
            keys and this trust will fail at runtime. Add it now to fix this before saving.
          </MessageBarBody>
          <Button
            appearance="primary"
            size="small"
            disabled={addHost.isPending}
            onClick={() => addHost.mutate({ host: host! })}
            data-testid="wif-jwks-add-host"
          >
            {addHost.isPending ? 'Adding...' : `Add ${host} to allowlist`}
          </Button>
        </MessageBar>
      )}
      {addHost.isError && (
        <MessageBar intent="error" data-testid="wif-jwks-add-error">
          <MessageBarBody>{(addHost.error as Error).message}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
};

interface WifCredentialsSectionProps {
  endpointId: string;
  enabled: boolean;
  credentials: EndpointOverviewCredential[];
  createMutation: ReturnType<typeof useCreateCredential>;
  deleteMutation: ReturnType<typeof useDeleteCredential>;
}

/**
 * The WIF trust form field grid (issuer / JWKS / subject / audience / tenant +
 * optional roles / scope / enforcement). Extracted so it can be rendered both
 * in the collapsed add-trust form (U3) and in the in-card edit form (U4) that
 * opens below a specific trust, from a single source of truth.
 */
const WifTrustFieldGrid: React.FC<{
  form: WifTrustForm;
  setField: (key: keyof WifTrustForm) => (next: string) => void;
  setForm: React.Dispatch<React.SetStateAction<WifTrustForm>>;
  styles: ReturnType<typeof useWifStyles>;
}> = ({ form, setField, setForm, styles }) => (
  <div className={styles.fieldGrid}>
    <EditableField
      label="Issuer (iss)"
      value={form.expectedIssuer}
      onChange={setField('expectedIssuer')}
      placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
      monospace
      validationMessage={httpsUrlError(form.expectedIssuer)}
      data-testid="wif-field-issuer"
    />
    <EditableField
      label="JWKS URI"
      value={form.jwksUri}
      onChange={setField('jwksUri')}
      placeholder="https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys"
      monospace
      validationMessage={httpsUrlError(form.jwksUri)}
      data-testid="wif-field-jwks"
    />
    <JwksAllowlistNotice jwksUri={form.jwksUri} styles={styles} />
    <EditableField
      label="Subject (sub)"
      value={form.expectedSubject}
      onChange={setField('expectedSubject')}
      placeholder="service-principal object id"
      monospace
      data-testid="wif-field-subject"
    />
    <EditableField
      label="Audience (aud)"
      value={form.expectedAudience}
      onChange={setField('expectedAudience')}
      placeholder="api://<your-app-id>"
      monospace
      data-testid="wif-field-audience"
    />
    <EditableField
      label="Allowed tenant id (tid / expectedTenantId)"
      value={form.allowedTenantId}
      onChange={setField('allowedTenantId')}
      placeholder="tenant guid - inferred from Issuer / JWKS when left blank"
      monospace
      data-testid="wif-field-tenant"
    />
    <EditableField
      label="Required roles (comma-separated, optional)"
      value={form.requiredRoles}
      onChange={setField('requiredRoles')}
      placeholder="Scim.Provision"
      data-testid="wif-field-roles"
    />
    <EditableField
      label="Issued-token scope (optional)"
      value={form.scope}
      onChange={setField('scope')}
      placeholder="scim.read scim.write"
      data-testid="wif-field-scope"
    />
    <Field
      label="Required-role enforcement"
      hint="Roles are advisory by default: a missing required role is logged but still authenticates so the flow continues. Choose Enforce to reject an assertion that lacks a required role."
    >
      <Dropdown
        value={
          form.roleEnforcement === 'enforce'
            ? 'Enforce - reject a missing required role'
            : form.roleEnforcement === 'shadow'
              ? 'Shadow - log only (advisory)'
              : 'Advisory (default) - allow + log'
        }
        selectedOptions={[form.roleEnforcement]}
        onOptionSelect={(_e, d) =>
          setForm((prev) => ({
            ...prev,
            roleEnforcement: (d.optionValue as WifTrustForm['roleEnforcement']) ?? 'off',
          }))
        }
        data-testid="wif-field-role-enforcement"
      >
        <Option value="off" text="Advisory (default) - allow + log">
          Advisory (default) - allow + log
        </Option>
        <Option value="shadow" text="Shadow - log only (advisory)">
          Shadow - log only (advisory)
        </Option>
        <Option value="enforce" text="Enforce - reject a missing required role">
          Enforce - reject a missing required role
        </Option>
      </Dropdown>
    </Field>
  </div>
);

/**
 * Federated Identity (WIF) section (Q6.5). Mirrors the three-step setup:
 *   1. Enter the Entra trust values (issuer / subject / audience / JWKS /
 *      tenant + optional required roles + scope).
 *   2. Save -> create a `wif` credential (all public values, no secret) and
 *      display the 3 ISV return values (Client ID, Token URL, SCIM URL).
 *   3. Test Connection -> a client-side readiness dry-run with a per-step
 *      pass/fail result (the authoritative validation runs server-side at the
 *      token endpoint when a real assertion is presented).
 *
 * All display values go through the R9 primitives (EditableField for inputs,
 * CopyableField for the return values, CopyJsonButton for the whole trust).
 */
const WifCredentialsSection: React.FC<WifCredentialsSectionProps> = ({
  endpointId,
  enabled,
  credentials,
  createMutation,
  deleteMutation,
}) => {
  const classes = useStyles();
  const wif = useWifStyles();
  // V2 - reactivate a deactivated WIF trust (deactivate reuses deleteMutation).
  const activateMutation = useActivateCredential(endpointId);

  const [form, setForm] = React.useState<WifTrustForm>(EMPTY_WIF_FORM);
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const [saved, setSaved] = React.useState<{ id: string } | null>(null);
  const [testSteps, setTestSteps] = React.useState<WifTestStep[] | null>(null);
  // Item 4 - edit mode: when set, the form edits an existing trust (PUT)
  // instead of creating a new one.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  // U3 - the add-trust form is collapsed behind an "Add trust" button so the
  // list of configured trusts is not buried under a form.
  const [addFormOpen, setAddFormOpen] = React.useState(false);
  // U6 - which trust's "Connect to Entra" params are expanded in-card.
  const [connectTrustId, setConnectTrustId] = React.useState<string | null>(null);
  const updateMutation = useUpdateWifCredential(endpointId);
  // Item 6 - server-side reachability/liveness verification.
  const verifyMutation = useVerifyWifTrust(endpointId);
  const [verifyResult, setVerifyResult] = React.useState<WifVerifyResult | null>(null);
  // V8 - per-card verify result (keyed by the trust's credential id).
  const [cardVerify, setCardVerify] = React.useState<{ id: string; result: WifVerifyResult | null } | null>(null);
  // Item C - when a verify-gated save fails, offer an explicit override.
  const [needsOverride, setNeedsOverride] = React.useState(false);

  // WI-D7 - assertion debugger: paste a client_assertion and dry-run it
  // against the configured trusts (real server-side checks, no mint).
  const debugMutation = useDebugWifAssertion(endpointId);
  const [debugAssertion, setDebugAssertion] = React.useState('');
  const [debugResult, setDebugResult] = React.useState<WifDebugAssertionResponse | null>(null);
  const onDebugAssertion = (): void => {
    const value = debugAssertion.trim();
    if (value.length === 0) return;
    setDebugResult(null);
    debugMutation.mutate(value, { onSuccess: (r) => setDebugResult(r) });
  };

  // WI-14 - config-time discovery resolver state.
  const resolveMutation = useResolveWifDiscovery(endpointId);
  const [resolveTenantId, setResolveTenantId] = React.useState('');
  const [resolveError, setResolveError] = React.useState<unknown>(null);

  const onResolve = (): void => {
    setResolveError(null);
    resolveMutation.mutate(
      { preset: 'entra-commercial', tenantId: resolveTenantId.trim() },
      {
        onSuccess: (res) => {
          setForm((prev) => ({
            ...prev,
            expectedIssuer: res.expectedIssuer,
            jwksUri: res.jwksUri,
            // Only propose the audience default when the admin has not typed one.
            expectedAudience: prev.expectedAudience || res.expectedAudience,
            allowedTenantId: prev.allowedTenantId || resolveTenantId.trim(),
          }));
        },
        onError: (err) => setResolveError(err),
      },
    );
  };

  const wifCredentials = credentials.filter((c) => c.credentialType === 'wif');

  const setField = (key: keyof WifTrustForm) => (next: string): void => {
    setForm((prev) => ({ ...prev, [key]: next }));
  };

  // The non-secret trust payload sent to the API (and shown via Copy as JSON).
  const trustPayload = React.useMemo(() => {
    const roles = form.requiredRoles
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    return {
      assertionProfile: 'jwt-bearer' as const,
      expectedIssuer: form.expectedIssuer.trim(),
      expectedSubject: form.expectedSubject.trim(),
      expectedAudience: form.expectedAudience.trim(),
      jwksUri: form.jwksUri.trim(),
      allowedTenantId: form.allowedTenantId.trim(),
      ...(roles.length > 0 ? { requiredRoles: roles } : {}),
      ...(form.scope.trim() ? { scope: form.scope.trim() } : {}),
      // Item E - only send a non-default enforcement mode.
      ...(form.roleEnforcement !== 'off' ? { roleEnforcement: form.roleEnforcement } : {}),
    };
  }, [form]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const tokenUrl = `${origin}/scim/endpoints/${endpointId}/oauth/token`;
  // WI-1: the SCIM base is the spec form `/scim/v2/endpoints/{id}` - the
  // `/scim/v2` version segment is a LEADING prefix that the server rewrites to
  // `/scim/endpoints/{id}`. The earlier `/scim/endpoints/{id}/v2` form put the
  // version at the tail, which is not a route the server serves.
  const scimUrl = `${origin}/scim/v2/endpoints/${endpointId}`;
  // WI-12: the per-endpoint RFC 8414 OAuth AS metadata URL (append form). A
  // standards-based OAuth client can GET this to discover the token endpoint +
  // JWKS without prior configuration.
  const metadataUrl = `${origin}/scim/endpoints/${endpointId}/.well-known/oauth-authorization-server`;

  const requiredOk =
    trustPayload.expectedIssuer !== '' &&
    trustPayload.expectedSubject !== '' &&
    trustPayload.expectedAudience !== '' &&
    trustPayload.jwksUri !== '' &&
    trustPayload.allowedTenantId !== '';

  const onSave = (): void => {
    // Item C: first attempt runs the server-side reachability + liveness gate
    // (verify:true). If it fails, the API returns 422 with the checks; we
    // render the checklist and offer an explicit "Save anyway" that re-submits
    // without the gate. A passing verify persists immediately.
    doSave(true);
  };

  const doSave = (verify: boolean): void => {
    setSaveError(null);
    setSaved(null);
    setNeedsOverride(false);
    if (verify) setVerifyResult(null);
    const onError = (err: unknown): void => {
      // A 422 from the verify gate carries the per-check checklist in rawBody.
      const e = err as { status?: number; rawBody?: { checks?: WifVerifyResult['checks'] } };
      if (e?.status === 422 && Array.isArray(e.rawBody?.checks)) {
        setVerifyResult({ ok: false, checks: e.rawBody!.checks! });
        setNeedsOverride(true);
        return;
      }
      setSaveError(err);
    };
    if (editingId != null) {
      updateMutation.mutate(
        { credentialId: editingId, wif: trustPayload, verify },
        {
          onSuccess: () => {
            setEditingId(null);
            setForm(EMPTY_WIF_FORM);
            setNeedsOverride(false);
            setVerifyResult(null);
          },
          onError,
        },
      );
      return;
    }
    createMutation.mutate(
      { credentialType: 'wif', label: 'Federated Identity (WIF)', wif: trustPayload, verify },
      {
        onSuccess: (raw) => {
          const cred = raw as unknown as { id: string };
          setSaved({ id: cred.id });
          setNeedsOverride(false);
          setVerifyResult(null);
        },
        onError,
      },
    );
  };

  // Item 4 - load a saved trust into the form for editing. V9 - togglable: a
  // second click on Edit for the trust already being edited closes the form.
  const onEditTrust = (cred: EndpointOverviewCredential): void => {
    const t = cred.wif;
    if (!t) return;
    if (editingId === cred.id) {
      onCancelEdit();
      return;
    }
    setSaved(null);
    setSaveError(null);
    setTestSteps(null);
    setEditingId(cred.id);
    setAddFormOpen(false);
    setConnectTrustId(null);
    setForm({
      expectedIssuer: t.expectedIssuer ?? '',
      expectedSubject: t.expectedSubject ?? '',
      expectedAudience: t.expectedAudience ?? '',
      jwksUri: t.jwksUri ?? '',
      allowedTenantId: t.allowedTenantId ?? '',
      requiredRoles: (t.requiredRoles ?? []).join(', '),
      scope: t.scope ?? '',
      roleEnforcement: (t.roleEnforcement as WifTrustForm['roleEnforcement']) ?? 'off',
    });
    // U4 - the edit form now opens in-card below the trust, so no scroll-to-top.
  };

  const onCancelEdit = (): void => {
    setEditingId(null);
    setForm(EMPTY_WIF_FORM);
    setSaveError(null);
    setVerifyResult(null);
    setNeedsOverride(false);
  };

  // U3 - open the collapsed add-trust form (fresh, not an edit).
  const onOpenAddForm = (): void => {
    setEditingId(null);
    setForm(EMPTY_WIF_FORM);
    setSaved(null);
    setSaveError(null);
    setVerifyResult(null);
    setNeedsOverride(false);
    setTestSteps(null);
    setAddFormOpen(true);
  };

  // U3 - close the add-trust form and discard its contents.
  const onCancelAdd = (): void => {
    setAddFormOpen(false);
    setForm(EMPTY_WIF_FORM);
    setSaveError(null);
    setVerifyResult(null);
    setNeedsOverride(false);
  };

  // Client-side readiness dry-run (the real validation is server-side).
  const onTestConnection = (): void => {
    let httpsJwks = false;
    try {
      httpsJwks = new URL(trustPayload.jwksUri).protocol === 'https:';
    } catch {
      httpsJwks = false;
    }
    setTestSteps([
      { label: 'Issuer provided', ok: trustPayload.expectedIssuer !== '' },
      { label: 'Subject provided', ok: trustPayload.expectedSubject !== '' },
      { label: 'Audience provided', ok: trustPayload.expectedAudience !== '' },
      { label: 'JWKS URI is https', ok: httpsJwks },
      { label: 'Tenant id provided', ok: trustPayload.allowedTenantId !== '' },
    ]);
  };

  // Item 6 - server-side reachability + liveness verification of issuer + JWKS.
  // V7 - when editing a saved trust, pass its credentialId so a passing verify
  // persists lastVerifiedAt and the card flips Unverified -> Verified.
  const onVerify = (): void => {
    setVerifyResult(null);
    verifyMutation.mutate(
      {
        expectedIssuer: trustPayload.expectedIssuer,
        jwksUri: trustPayload.jwksUri,
        credentialId: editingId ?? undefined,
      },
      { onSuccess: (res) => setVerifyResult(res) },
    );
  };

  // V8 - verify a specific saved trust straight from its card (no Edit needed).
  // Uses the trust's stored issuer/JWKS + its credentialId so a pass persists
  // lastVerifiedAt (V7) and the card status refreshes.
  const onVerifyTrust = (cred: EndpointOverviewCredential): void => {
    const t = cred.wif;
    if (!t) return;
    setCardVerify({ id: cred.id, result: null });
    verifyMutation.mutate(
      {
        expectedIssuer: t.expectedIssuer ?? undefined,
        jwksUri: t.jwksUri ?? undefined,
        credentialId: cred.id,
      },
      { onSuccess: (res) => setCardVerify({ id: cred.id, result: res }) },
    );
  };

  return (
    <Card className={classes.row} data-testid="wif-section">
      <div className={wif.section}>
        <div className={wif.sectionHeader}>
          <ShieldKeyhole24Regular />
          <Subtitle2>Federated Identity (WIF)</Subtitle2>
        </div>
        <Caption1>
          Trust a signed identity-provider assertion (RFC 7523 jwt-bearer) instead of a shared
          secret. All values below are public; no secret is stored.
        </Caption1>

        {!enabled ? (
          <MessageBar intent="warning" data-testid="wif-flag-disabled-banner">
            <MessageBarBody>
              <MessageBarTitle>Federated identity is disabled</MessageBarTitle>
              Enable <code>WifCredentialsEnabled</code> in the endpoint{' '}
              <a href={`/endpoints/${endpointId}/settings`}>Settings</a> tab to configure a WIF
              trust.
            </MessageBarBody>
          </MessageBar>
        ) : (
          <>
            {editingId == null && !addFormOpen && (
              <div className={wif.actions}>
                <Button
                  appearance="primary"
                  icon={<Add24Regular />}
                  onClick={onOpenAddForm}
                  data-testid="wif-add-trust-button"
                >
                  Add trust
                </Button>
              </div>
            )}
            {addFormOpen && editingId == null && (
            <div data-testid="wif-add-trust-form">
            <div className={wif.resolveRow} data-testid="wif-resolve-row">
              <EditableField
                label="Resolve from Entra tenant id (WI-14 discovery)"
                value={resolveTenantId}
                onChange={setResolveTenantId}
                placeholder="tenant guid - fills Issuer + JWKS URI automatically"
                monospace
                data-testid="wif-resolve-tenant"
              />
              <Button
                appearance="secondary"
                onClick={onResolve}
                disabled={resolveTenantId.trim() === '' || resolveMutation.isPending}
                data-testid="wif-resolve-button"
              >
                {resolveMutation.isPending ? 'Resolving...' : 'Resolve from IdP'}
              </Button>
            </div>
            {resolveError != null && (
              <MessageBar intent="error" data-testid="wif-resolve-error">
                <MessageBarBody>
                  <MessageBarTitle>Could not resolve the IdP discovery document</MessageBarTitle>
                  {(resolveError as Error).message}
                </MessageBarBody>
              </MessageBar>
            )}
            <Caption1 data-testid="wif-field-alias-hint" className={wif.aliasHint}>
              Tip: you can paste a decoded token&apos;s bare claim names - `iss`, `sub`, `aud`,
              `tid`, `roles` (or `expectedTenantId`) are accepted and normalize to these fields.
            </Caption1>
            <WifTrustFieldGrid form={form} setField={setField} setForm={setForm} styles={wif} />

            <div className={wif.actions}>
              <Button
                appearance="primary"
                onClick={onSave}
                disabled={!requiredOk || createMutation.isPending || updateMutation.isPending}
                data-testid="wif-save-button"
              >
                {editingId != null
                  ? updateMutation.isPending
                    ? 'Saving changes...'
                    : 'Save changes'
                  : 'Save WIF trust'}
              </Button>
              {editingId != null && (
                <Button
                  appearance="secondary"
                  onClick={onCancelEdit}
                  data-testid="wif-cancel-edit-button"
                >
                  Cancel edit
                </Button>
              )}
              {needsOverride && (
                <Button
                  appearance="secondary"
                  onClick={() => doSave(false)}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="wif-save-anyway-button"
                >
                  Save anyway
                </Button>
              )}
              <Button
                icon={<PlugConnected24Regular />}
                onClick={onTestConnection}
                data-testid="wif-test-button"
              >
                Test Connection
              </Button>
              <Button
                icon={<PlugConnected24Regular />}
                onClick={onVerify}
                disabled={verifyMutation.isPending}
                data-testid="wif-verify-button"
              >
                {verifyMutation.isPending ? 'Verifying...' : 'Verify issuer + JWKS reachability'}
              </Button>
              <CopyJsonButton
                value={trustPayload}
                label="Copy trust as JSON"
                data-testid="wif-copy-json"
              />
            </div>
            {editingId != null && (
              <MessageBar intent="info" data-testid="wif-editing-banner">
                <MessageBarBody>
                  Editing an existing trust. Save changes to update it, or Cancel edit to discard.
                </MessageBarBody>
              </MessageBar>
            )}

            {saveError != null && (
              <MessageBar intent="error" data-testid="wif-save-error">
                <MessageBarBody>
                  <MessageBarTitle>Could not save the WIF trust</MessageBarTitle>
                  {(saveError as Error).message}
                </MessageBarBody>
              </MessageBar>
            )}

            {saved != null && (
              <div className={wif.returnBox} data-testid="wif-return-values">
                <Text weight="semibold">Connection details for your identity provider</Text>
                <div className={wif.returnRow}>
                  <Caption1>Client ID</Caption1>
                  <CopyableField
                    value={form.expectedSubject || saved.id}
                    monospace
                    truncate
                    data-testid="wif-return-clientid"
                  />
                </div>
                <div className={wif.returnRow}>
                  <Caption1>Token URL</Caption1>
                  <CopyableField
                    value={tokenUrl}
                    monospace
                    truncate
                    data-testid="wif-return-tokenurl"
                  />
                </div>
                <div className={wif.returnRow}>
                  <Caption1>SCIM URL</Caption1>
                  <CopyableField
                    value={scimUrl}
                    monospace
                    truncate
                    data-testid="wif-return-scimurl"
                  />
                </div>
                <div className={wif.returnRow}>
                  <Caption1>OAuth metadata URL (RFC 8414)</Caption1>
                  <CopyableField
                    value={metadataUrl}
                    monospace
                    truncate
                    data-testid="wif-return-metadataurl"
                  />
                </div>
              </div>
            )}

            {testSteps != null && (
              <div data-testid="wif-test-result">
                {testSteps.map((step) => (
                  <div key={step.label} className={wif.testStep}>
                    <Badge appearance="filled" color={step.ok ? 'success' : 'danger'}>
                      {step.ok ? 'PASS' : 'FAIL'}
                    </Badge>
                    <Caption1>{step.label}</Caption1>
                  </div>
                ))}
              </div>
            )}

            {verifyMutation.isError && (
              <MessageBar intent="error" data-testid="wif-verify-error">
                <MessageBarBody>{(verifyMutation.error as Error).message}</MessageBarBody>
              </MessageBar>
            )}
            {verifyResult != null && (
              <div className={wif.jwksNotice} data-testid="wif-verify-result">
                <MessageBar intent={verifyResult.ok ? 'success' : 'warning'}>
                  <MessageBarBody>
                    <MessageBarTitle>
                      {verifyResult.ok
                        ? 'Issuer + JWKS verified reachable and serving keys'
                        : 'Some reachability checks failed - fix these before saving to avoid runtime surprises'}
                    </MessageBarTitle>
                  </MessageBarBody>
                </MessageBar>
                {verifyResult.checks.map((c) => (
                  <div key={c.id} className={wif.testStep} data-testid={`wif-verify-check-${c.id}`}>
                    <Badge appearance="filled" color={c.ok ? 'success' : 'danger'}>
                      {c.ok ? 'PASS' : 'FAIL'}
                    </Badge>
                    <Caption1>
                      <strong>{c.label}</strong> - {c.detail}
                    </Caption1>
                  </div>
                ))}
              </div>
            )}
            <div className={wif.actions}>
              <Button
                appearance="secondary"
                onClick={onCancelAdd}
                data-testid="wif-cancel-add-button"
              >
                Cancel
              </Button>
            </div>
            </div>
            )}

            {/* U1 - the assertion debugger lives behind an Advanced /
                troubleshooting accordion so the common case (viewing the
                configured trusts) is not buried under an occasional tool. */}
            <Accordion collapsible multiple data-testid="wif-advanced-accordion">
              <AccordionItem value="advanced">
                <AccordionHeader data-testid="wif-advanced-toggle">
                  Advanced / troubleshooting
                </AccordionHeader>
                <AccordionPanel>
            {/* WI-D7 - assertion debugger: paste a client_assertion, dry-run it
                against the configured trusts (real server checks, no mint). */}
            <div className={wif.jwksNotice} data-testid="wif-debug-assertion">
              <Subtitle2>Assertion debugger</Subtitle2>
              <Caption1>
                Paste a source-IdP <code>client_assertion</code> (a signed JWT) to dry-run it against
                every configured trust below. This runs the exact server-side checks a real token
                mint would - signature, issuer, subject, audience, tenant, roles - but never mints a
                token, so you can see precisely which claim is wrong before wiring the identity
                provider.
              </Caption1>
              <Textarea
                value={debugAssertion}
                onChange={(_, d) => setDebugAssertion(d.value)}
                placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6..."
                resize="vertical"
                data-testid="wif-debug-assertion-input"
              />
              <div>
                <Button
                  appearance="primary"
                  disabled={debugAssertion.trim().length === 0 || debugMutation.isPending}
                  onClick={onDebugAssertion}
                  data-testid="wif-debug-assertion-button"
                >
                  {debugMutation.isPending ? 'Evaluating...' : 'Debug assertion'}
                </Button>
              </div>
              {debugMutation.isError && (
                <MessageBar intent="error" data-testid="wif-debug-assertion-error">
                  <MessageBarBody>{(debugMutation.error as Error).message}</MessageBarBody>
                </MessageBar>
              )}
              {debugResult != null && (
                <div data-testid="wif-debug-assertion-result">
                  <MessageBar intent={debugResult.overallOutcome === 'accept' ? 'success' : 'warning'}>
                    <MessageBarBody>
                      <MessageBarTitle>
                        {debugResult.overallOutcome === 'accept'
                          ? 'This assertion WOULD be accepted (a configured trust matches).'
                          : debugResult.results.length === 0
                            ? 'No WIF trust is configured for this endpoint yet.'
                            : 'This assertion would be rejected by every configured trust.'}
                      </MessageBarTitle>
                    </MessageBarBody>
                  </MessageBar>
                  {debugResult.results.map((r, i) => (
                    <div
                      key={`${r.expectedIssuer}-${i}`}
                      className={wif.testStep}
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}
                      data-testid={`wif-debug-trust-${i}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <Badge appearance="filled" color={r.outcome === 'accept' ? 'success' : 'danger'}>
                          {r.outcome === 'accept' ? 'ACCEPT' : 'REJECT'}
                        </Badge>
                        <Caption1>
                          <strong>{r.expectedIssuer}</strong>
                          {r.reasonCode ? ` - ${r.reasonCode}` : ''}
                        </Caption1>
                      </div>
                      {r.trace.checks.map((c) => (
                        <div
                          key={c.id}
                          className={wif.testStep}
                          data-testid={`wif-debug-trust-${i}-check-${c.id}`}
                        >
                          <Badge
                            appearance="filled"
                            color={c.status === 'pass' ? 'success' : c.status === 'fail' ? 'danger' : 'warning'}
                          >
                            {c.status.toUpperCase()}
                          </Badge>
                          <Caption1>
                            <strong>{c.id}</strong>
                            {c.expected !== undefined ? ` - expected: ${c.expected}` : ''}
                            {c.received !== undefined ? `, received: ${c.received}` : ''}
                            {c.detail ? ` (${c.detail})` : ''}
                          </Caption1>
                        </div>
                      ))}
                      {r.trace.decodedClaims != null && (
                        <CopyableJsonBlock
                          value={r.trace.decodedClaims}
                          data-testid={`wif-debug-trust-${i}-claims`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
                </AccordionPanel>
              </AccordionItem>
            </Accordion>

            {wifCredentials.length > 0 && (
              <div className={classes.list} data-testid="wif-credentials-list">
                <div className={wif.wifListHeader} data-testid="wif-credentials-list-header">
                  <Subtitle2>
                    Configured federated trusts ({wifCredentials.length})
                  </Subtitle2>
                  <Caption1>
                    {wifCredentials.length > 1
                      ? 'Every active trust below authenticates at the same time - an assertion from any of these identity providers can provision this endpoint. All resources land in one common pool; for isolation, create a separate endpoint per identity provider.'
                      : 'Add another trust to let a second identity provider (for example an additional Entra tenant, Okta, or Ping) provision this same endpoint.'}
                  </Caption1>
                </div>
                {wifCredentials.map((cred) => (
                  <Card key={cred.id} className={wif.wifRow} data-testid={`wif-credential-row-${cred.id}`}>
                    <div className={wif.wifRowGrid}>
                      <div>
                        <Subtitle2>{cred.label ?? '(no label)'}</Subtitle2>
                        <div className={wif.wifMeta}>{cred.id}</div>
                      </div>
                      <Badge appearance="filled" color={cred.active ? 'success' : 'subtle'}>
                        {cred.active ? 'Active' : 'Revoked'}
                      </Badge>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {/* W7 - primary actions visible (Connect, Edit, Verify,
                            Export); Deactivate + Revoke in a "More" overflow menu. */}
                        <Tooltip content="Connect this endpoint to IdP like Entra ID" relationship="label" positioning="above">
                          <Button
                            appearance="secondary"
                            icon={<PlugConnected24Regular />}
                            onClick={() =>
                              setConnectTrustId(connectTrustId === cred.id ? null : cred.id)
                            }
                            aria-label={`Show connection parameters for WIF trust ${cred.label ?? cred.id}`}
                            data-testid={`wif-credential-connect-${cred.id}`}
                          >
                            Connect
                          </Button>
                        </Tooltip>
                        <Button
                          appearance="subtle"
                          icon={<Edit24Regular />}
                          onClick={() => onEditTrust(cred)}
                          aria-label={`Edit WIF trust ${cred.label ?? cred.id}`}
                          data-testid={`wif-credential-edit-${cred.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          appearance="subtle"
                          icon={<PlugConnected24Regular />}
                          onClick={() => onVerifyTrust(cred)}
                          disabled={verifyMutation.isPending && cardVerify?.id === cred.id}
                          aria-label={`Verify WIF trust ${cred.label ?? cred.id}`}
                          data-testid={`wif-credential-verify-${cred.id}`}
                        >
                          {verifyMutation.isPending && cardVerify?.id === cred.id ? 'Verifying...' : 'Verify'}
                        </Button>
                        {/* W5 - copy / download this trust's public object as JSON. */}
                        <SettingsJsonExport
                          value={projectCredentialPublic(cred)}
                          filename={`wif-trust-${cred.id}.json`}
                          copyLabel="Copy JSON"
                          data-testid={`wif-credential-export-${cred.id}`}
                        />
                        <Menu>
                          <MenuTrigger disableButtonEnhancement>
                            <Tooltip content="More actions" relationship="label" positioning="above">
                              <Button
                                appearance="subtle"
                                icon={<MoreHorizontal24Regular />}
                                aria-label={`More actions for WIF trust ${cred.label ?? cred.id}`}
                                data-testid={`wif-credential-more-${cred.id}`}
                              />
                            </Tooltip>
                          </MenuTrigger>
                          <MenuPopover>
                            <MenuList>
                              {/* V2 - activate / deactivate this trust (soft). */}
                              <MenuItem
                                onClick={() => {
                                  if (cred.active) deleteMutation.mutate(cred.id);
                                  else activateMutation.mutate(cred.id);
                                }}
                                disabled={activateMutation.isPending || deleteMutation.isPending}
                                data-testid={`wif-credential-toggle-active-${cred.id}`}
                              >
                                {cred.active ? 'Deactivate' : 'Activate'}
                              </MenuItem>
                              <MenuItem
                                icon={<Delete24Regular />}
                                onClick={() => deleteMutation.mutate(cred.id)}
                                data-testid={`wif-credential-delete-${cred.id}`}
                              >
                                Revoke trust
                              </MenuItem>
                            </MenuList>
                          </MenuPopover>
                        </Menu>
                      </div>
                    </div>
                    {/* V1 - validity line (a WIF trust does not expire). */}
                    <Caption1 className={wif.wifMeta} data-testid={`wif-credential-${cred.id}-expiry`}>
                      {cred.wif?.issuedTokenTtlSec
                        ? `Trust does not expire; minted tokens valid ${cred.wif.issuedTokenTtlSec}s`
                        : 'Trust does not expire; minted tokens use the default TTL'}
                    </Caption1>
                    <WifTrustDetails credId={cred.id} trust={cred.wif} styles={wif} />

                    {/* V8 - per-card verify result (in-card checklist). */}
                    {cardVerify?.id === cred.id && cardVerify.result != null && (
                      <div className={wif.jwksNotice} data-testid={`wif-credential-verify-result-${cred.id}`}>
                        <MessageBar intent={cardVerify.result.ok ? 'success' : 'warning'}>
                          <MessageBarBody>
                            <MessageBarTitle>
                              {cardVerify.result.ok
                                ? 'Verified - issuer + JWKS reachable and serving keys'
                                : 'Some reachability checks failed - fix these before relying on this trust'}
                            </MessageBarTitle>
                          </MessageBarBody>
                        </MessageBar>
                        {cardVerify.result.checks.map((c) => (
                          <div key={c.id} className={wif.testStep} data-testid={`wif-credential-${cred.id}-verify-check-${c.id}`}>
                            <Badge appearance="filled" color={c.ok ? 'success' : 'danger'}>
                              {c.ok ? 'PASS' : 'FAIL'}
                            </Badge>
                            <Caption1>
                              <strong>{c.label}</strong> - {c.detail}
                            </Caption1>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* U6 - per-trust Connect-to-Entra params (in-card). */}
                    {connectTrustId === cred.id && (
                      <div className={wif.editInCard} data-testid={`wif-credential-connect-panel-${cred.id}`}>
                        <Caption1>
                          <strong>Connect this endpoint to IdP like Entra ID</strong> - paste these
                          into your identity provider&apos;s Workload Identity Federation connection form.
                        </Caption1>
                        {/* W6 - copy / download the whole IdP-connection bundle for this trust. */}
                        <SettingsJsonExport
                          value={{
                            applicationApiUrl: scimUrl,
                            oauthTokenEndpoint: tokenUrl,
                            clientIdentifier: cred.wif?.expectedSubject ?? null,
                            ...(cred.wif ?? {}),
                          }}
                          filename={`wif-trust-${cred.id}-connection.json`}
                          copyLabel="Copy connection JSON"
                          data-testid={`wif-connect-export-${cred.id}`}
                        />
                        <div className={wif.returnRow}>
                          <InfoLabel info={CONNECT_PARAM_HELP.applicationApiUrl} data-testid={`wif-connect-appurl-info-${cred.id}`}>Application API URL</InfoLabel>
                          <CopyableField value={scimUrl} monospace truncate data-testid={`wif-connect-appurl-${cred.id}`} />
                        </div>
                        <div className={wif.returnRow}>
                          <InfoLabel info={CONNECT_PARAM_HELP.oauthTokenEndpoint} data-testid={`wif-connect-tokenurl-info-${cred.id}`}>OAuth token endpoint</InfoLabel>
                          <CopyableField value={tokenUrl} monospace truncate data-testid={`wif-connect-tokenurl-${cred.id}`} />
                        </div>
                        <div className={wif.returnRow}>
                          <InfoLabel info={CONNECT_PARAM_HELP.clientIdentifier} data-testid={`wif-connect-clientid-info-${cred.id}`}>Client identifier (sub)</InfoLabel>
                          <CopyableField
                            value={cred.wif?.expectedSubject ?? '-'}
                            monospace
                            truncate
                            data-testid={`wif-connect-clientid-${cred.id}`}
                          />
                        </div>
                      </div>
                    )}

                    {/* U4 - edit this trust in-card, below its displayed values. */}
                    {editingId === cred.id && (
                      <div className={wif.editInCard} data-testid={`wif-trust-edit-form-${cred.id}`}>
                        <Caption1>
                          <strong>Edit this trust</strong> - change any value and Save changes.
                        </Caption1>
                        <WifTrustFieldGrid form={form} setField={setField} setForm={setForm} styles={wif} />
                        <div className={wif.actions}>
                          <Button
                            appearance="primary"
                            onClick={onSave}
                            disabled={!requiredOk || updateMutation.isPending}
                            data-testid={`wif-trust-edit-save-${cred.id}`}
                          >
                            {updateMutation.isPending ? 'Saving changes...' : 'Save changes'}
                          </Button>
                          <Button
                            appearance="secondary"
                            onClick={onCancelEdit}
                            data-testid={`wif-trust-edit-cancel-${cred.id}`}
                          >
                            Cancel
                          </Button>
                          <Button
                            icon={<PlugConnected24Regular />}
                            onClick={onVerify}
                            disabled={verifyMutation.isPending}
                            data-testid={`wif-trust-edit-verify-${cred.id}`}
                          >
                            {verifyMutation.isPending ? 'Verifying...' : 'Verify'}
                          </Button>
                          {needsOverride && (
                            <Button
                              appearance="secondary"
                              onClick={() => doSave(false)}
                              disabled={updateMutation.isPending}
                              data-testid={`wif-trust-edit-save-anyway-${cred.id}`}
                            >
                              Save anyway
                            </Button>
                          )}
                        </div>
                        {saveError != null && (
                          <MessageBar intent="error" data-testid={`wif-trust-edit-error-${cred.id}`}>
                            <MessageBarBody>{(saveError as Error).message}</MessageBarBody>
                          </MessageBar>
                        )}
                        {verifyResult != null && (
                          <div className={wif.jwksNotice} data-testid={`wif-trust-edit-verify-result-${cred.id}`}>
                            <MessageBar intent={verifyResult.ok ? 'success' : 'warning'}>
                              <MessageBarBody>
                                <MessageBarTitle>
                                  {verifyResult.ok
                                    ? 'Issuer + JWKS verified reachable and serving keys'
                                    : 'Some reachability checks failed - fix these before saving'}
                                </MessageBarTitle>
                              </MessageBarBody>
                            </MessageBar>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
};

// ─── R6: per-method credential sub-tabs ───────────────────────────────
// The Credentials tab is organized into sub-tabs per ENABLED authentication
// method (driven by the endpoint's config flags) plus an "All" overview tab.
// Only methods enabled in Settings get a tab, so the operator sees exactly the
// auth surface this endpoint accepts.

type MethodTab = 'all' | 'shared_secret' | 'bearer' | 'oauth_client' | 'wif';

interface MethodTabDef {
  value: MethodTab;
  label: string;
  /** The credentialType this tab scopes the list to (null for all / shared). */
  credentialType: 'bearer' | 'oauth_client' | 'wif' | null;
}

/** Coerce 'True'/'False' (Entra style) + booleans into a JS boolean. */
function coerceCredFlag(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const l = raw.toLowerCase();
    if (l === 'true') return true;
    if (l === 'false') return false;
  }
  return fallback;
}

/**
 * Compute the enabled auth-method tabs from the endpoint config flags,
 * mirroring the backend getEffectiveAuthEnablement precedence: the two
 * per-endpoint flags fall back to the legacy PerEndpointCredentialsEnabled,
 * and the shared-secret flag defaults to on. W11 - there is no "All" tab; the
 * per-method tabs are the single method axis.
 */
function enabledMethodTabs(flags: Record<string, unknown>): MethodTabDef[] {
  const legacy = coerceCredFlag(flags.PerEndpointCredentialsEnabled, false);
  const sharedSecret = coerceCredFlag(flags.SharedSecretBearerAuthEnabled, true);
  const secretTokenBearer = coerceCredFlag(flags.SecretTokenBearerAuthEnabled, legacy);
  const oauthClient = coerceCredFlag(flags.OAuthClientCredentialsAuthEnabled, legacy);
  const wif = coerceCredFlag(flags.WifCredentialsEnabled, false);

  const tabs: MethodTabDef[] = [];
  if (oauthClient) tabs.push({ value: 'oauth_client', label: 'OAuth2 Client-Credential', credentialType: 'oauth_client' });
  if (wif) tabs.push({ value: 'wif', label: 'WIF', credentialType: 'wif' });
  if (secretTokenBearer) tabs.push({ value: 'bearer', label: 'Per-endpoint bearer', credentialType: 'bearer' });
  if (sharedSecret) tabs.push({ value: 'shared_secret', label: 'Global Shared secret', credentialType: null });
  return tabs;
}

/**
 * The auth-related endpoint config flags carried in a Connect export bundle
 * (W3/W4). These are the flags that decide which auth methods this endpoint
 * accepts + how its secrets are surfaced - the operator needs them alongside the
 * connection info to reproduce or audit the endpoint's auth posture. Never a
 * secret VALUE - only the enablement/visibility flags.
 */
const AUTH_CONFIG_FLAG_KEYS = [
  'PerEndpointCredentialsEnabled',
  'SharedSecretBearerAuthEnabled',
  'SecretTokenBearerAuthEnabled',
  'OAuthClientCredentialsAuthEnabled',
  'WifCredentialsEnabled',
  'CredentialSecretVisibility',
] as const;

/** Pick just the auth-related flags from the full endpoint config-flag map. */
function pickAuthConfigFlags(flags: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of AUTH_CONFIG_FLAG_KEYS) {
    if (flags[k] !== undefined) out[k] = flags[k];
  }
  return out;
}

/**
 * Project a credential / trust to its public (NO secret) shape for a Connect
 * export bundle. Mirrors the per-card `CopyJsonButton` projections (W5) so the
 * endpoint (W3) and per-method (W4) bundles carry the same non-secret fields.
 */
function projectCredentialPublic(cred: EndpointOverviewCredential): Record<string, unknown> {
  return {
    id: cred.id,
    credentialType: cred.credentialType,
    label: cred.label ?? null,
    active: cred.active,
    createdAt: cred.createdAt,
    expiresAt: cred.expiresAt ?? null,
    ...(cred.oauthClientId ? { oauthClientId: cred.oauthClientId } : {}),
    ...(cred.wif ? { wif: cred.wif } : {}),
  };
}

/**
 * W3 - assemble the whole-endpoint Connect bundle: every enabled auth method +
 * the connection info (URLs + Entra field mappings, no secrets) + every
 * credential/trust (public projection) + the auth-related config flags. This is
 * the one object an operator can copy / download to reproduce or audit the
 * endpoint's complete auth + connection posture.
 */
function buildEndpointConnectBundle(
  endpointId: string,
  connectionInfo: ConnectionInfo | undefined,
  credentials: EndpointOverviewCredential[],
  configFlags: Record<string, unknown>,
): Record<string, unknown> {
  return {
    endpointId,
    displayName: connectionInfo?.displayName ?? null,
    authConfigFlags: pickAuthConfigFlags(configFlags),
    connectionInfo: connectionInfo ?? null,
    credentials: credentials.map(projectCredentialPublic),
  };
}

/**
 * W4 - assemble the per-method Connect bundle: the one enabled method's
 * connection info + the credentials/trusts backing that method (public
 * projection). `method` is the active sub-tab's credential axis.
 */
function buildMethodConnectBundle(
  endpointId: string,
  method: ConnectionMethod,
  connectionInfo: ConnectionInfo | undefined,
  credentials: EndpointOverviewCredential[],
): Record<string, unknown> {
  const enabledMethod = connectionInfo?.enabledMethods.find((m) => m.method === method) ?? null;
  return {
    endpointId,
    method,
    displayName: connectionInfo?.displayName ?? null,
    urls: connectionInfo?.urls ?? null,
    enabledMethod,
    credentials: credentials.map(projectCredentialPublic),
  };
}

/**
 * W10 - the explanatory help for each Connect parameter, surfaced via a Fluent
 * `InfoLabel` (an info icon + hover/click popover) on the parameter label in
 * every Connect subpanel, instead of a wall of prose in a separate card.
 */
const CONNECT_PARAM_HELP = {
  applicationApiUrl:
    'The SCIM base URL for this endpoint. In Entra this is the provisioning app\u2019s "Tenant URL" / "Application API URL" - paste it as the target the IdP provisions to.',
  oauthTokenEndpoint:
    'The per-endpoint OAuth 2.0 token endpoint the identity provider calls to mint an access token for this endpoint.',
  clientIdentifier:
    'The client identity the IdP presents. For WIF this is the expected token "sub" claim; for OAuth2 client-credentials it is this credential\u2019s client id.',
  clientSecret:
    'The secret the IdP uses to authenticate. Shown here only when the endpoint retains it (CredentialSecretVisibility=always); otherwise Rotate to get a fresh one.',
} as const;

export const CredentialsTab: React.FC<CredentialsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const navigate = useNavigate();
  const { data, isLoading, error } = useEndpointOverview(endpointId);
  const createMutation = useCreateCredential(endpointId);
  const deleteMutation = useDeleteCredential(endpointId);
  const activateMutation = useActivateCredential(endpointId);
  const deactivateMutation = useDeactivateCredential(endpointId);
  const editLabelMutation = useEditCredentialLabel(endpointId);
  const revealMutation = useRevealCredential(endpointId);
  const rotateMutation = useRotateCredential(endpointId);

  // V3 - which credential's label is being edited inline, + its draft value.
  const [editLabelId, setEditLabelId] = React.useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = React.useState('');

  // Local UI state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [labelInput, setLabelInput] = React.useState('');
  // R7 - which credential type the create dialog will mint.
  const [createType, setCreateType] = React.useState<'bearer' | 'oauth_client'>('bearer');
  // R6 - the selected per-method sub-tab.
  const [methodTab, setMethodTab] = React.useState<MethodTab>('all');
  const [createError, setCreateError] = React.useState<unknown>(null);
  // Plaintext token returned ONCE on create - keep around so the user
  // can copy it. Cleared when the modal closes after acknowledgement.
  const [createdCred, setCreatedCred] = React.useState<CreatedCredential | null>(null);

  const [deleteTarget, setDeleteTarget] = React.useState<EndpointOverviewCredential | null>(null);
  const [deleteError, setDeleteError] = React.useState<unknown>(null);

  // WI-8: reveal result (retained secret or a "not retained" reason).
  const [revealResult, setRevealResult] = React.useState<RevealResult | null>(null);

  // WI-9: rotate result (the one-time new secret).
  const [rotateResult, setRotateResult] = React.useState<RotateResult | null>(null);

  // U2 - which oauth_client credential's Connect-to-Entra params are expanded.
  const [connectCredId, setConnectCredId] = React.useState<string | null>(null);
  // V4 - the retained secret for the credential whose Connect panel is open
  // (auto-revealed when visibility is Always), shown inline with the params.
  const [connectSecret, setConnectSecret] = React.useState<{ id: string; retained: boolean; clientSecret?: string } | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const connectScimUrl = `${origin}/scim/v2/endpoints/${endpointId}`;
  const connectTokenUrl = `${origin}/scim/endpoints/${endpointId}/oauth/token`;

  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'error'>('idle');

  const onOpenCreate = (type: 'bearer' | 'oauth_client' = 'bearer'): void => {
    setLabelInput('');
    setCreateType(type);
    setCreateError(null);
    setCreatedCred(null);
    setCreateOpen(true);
  };

  const onCloseCreate = (): void => {
    setCreateOpen(false);
    setCreatedCred(null);
    setLabelInput('');
    setCreateError(null);
  };

  const onSubmitCreate = (): void => {
    setCreateError(null);
    createMutation.mutate(
      { label: labelInput.trim() || undefined, credentialType: createType },
      {
        onSuccess: (raw) => {
          // Bearer returns { id, label, token, createdAt }; oauth_client
          // returns { id, label, clientId, clientSecret, createdAt } (R7).
          const cred = raw as unknown as {
            id: string;
            label: string | null;
            token?: string;
            clientId?: string;
            clientSecret?: string;
            createdAt: string;
          };
          setCreatedCred({
            id: cred.id,
            label: cred.label,
            plaintext: cred.clientSecret ?? cred.token ?? '',
            createdAt: cred.createdAt,
            credentialType: createType,
            clientId: cred.clientId,
          });
        },
        onError: (err) => {
          setCreateError(err);
        },
      },
    );
  };

  const onConfirmDelete = (): void => {
    if (!deleteTarget) return;
    setDeleteError(null);
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
      },
      onError: (err) => {
        setDeleteError(err);
      },
    });
  };

  const onCopyToken = async (): Promise<void> => {
    if (!createdCred) return;
    try {
      await navigator.clipboard.writeText(createdCred.plaintext);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className={classes.root} data-testid="tab-credentials">
        <Subtitle1>Credentials</Subtitle1>
        <LoadingSkeleton count={4} height="56px" data-testid="credentials-skeleton" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="tab-credentials">
        <div className={classes.errorBlock} data-testid="credentials-error">
          <Body1>Failed to load credentials: {(error as Error).message}</Body1>
        </div>
      </div>
    );
  }

  // 403 surfaces as the overview load succeeding but the credentials
  // array remaining empty + the create attempt later returning 403.
  const wifEnabled = Boolean(data?.configFlags?.WifCredentialsEnabled);
  const credentials = data?.credentials ?? [];

  // W11 - the per-method sub-tabs are the single method axis; there is no "All"
  // tab. If the current selection is not among the enabled methods (the initial
  // state, or a method that was turned off), fall back to the first enabled
  // method. `noMethods` covers the rare case where every auth method is disabled.
  const configFlags = (data?.configFlags ?? {}) as Record<string, unknown>;
  const methodTabs = enabledMethodTabs(configFlags);
  const noMethods = methodTabs.length === 0;
  // Default to the first configured PER-ENDPOINT method (bearer / oauth_client /
  // wif) when one exists - that is the auth the operator deliberately set up for
  // this endpoint - otherwise the global shared-secret method. Falls back to the
  // first tab / shared_secret when nothing matches.
  const defaultTabValue: MethodTab =
    methodTabs.find((t) => t.value !== 'shared_secret')?.value ??
    methodTabs[0]?.value ??
    'shared_secret';
  const activeTab: MethodTab = methodTabs.some((t) => t.value === methodTab)
    ? methodTab
    : defaultTabValue;
  const activeDef = methodTabs.find((t) => t.value === activeTab) ?? methodTabs[0] ?? null;
  const showGenericList = !noMethods && (activeTab === 'bearer' || activeTab === 'oauth_client');
  const showWifSection = !noMethods && activeTab === 'wif';
  const showSharedSecretInfo = !noMethods && activeTab === 'shared_secret';
  const createTypeForTab: 'bearer' | 'oauth_client' = activeTab === 'oauth_client' ? 'oauth_client' : 'bearer';
  const listCredentials = activeDef?.credentialType
    ? credentials.filter((c) => c.credentialType === activeDef.credentialType)
    : [];
  // A method tab only appears when its method is enabled, so per-tab creation is
  // always allowed.
  const flagEnabledForTab = true;

  return (
    <div className={classes.root} data-testid="tab-credentials">
      <div className={classes.header}>
        <Subtitle1>Connect ({credentials.length})</Subtitle1>
        <div className={classes.headerActions}>
          {/* W3 - copy / download the WHOLE endpoint Connect bundle: every
              enabled method + connection info + every credential/trust + the
              auth-related config flags (no secret values). */}
          {data?.connectionInfo && (
            <SettingsJsonExport
              value={buildEndpointConnectBundle(endpointId, data.connectionInfo, credentials, configFlags)}
              filename={`endpoint-${endpointId}-connect.json`}
              copyLabel="Copy all as JSON"
              data-testid="connect-endpoint-export"
            />
          )}
          {showGenericList && (
            <Button
              appearance="primary"
              icon={<Add24Regular />}
              onClick={() => onOpenCreate(createTypeForTab)}
              data-testid="credentials-create-button"
              disabled={!flagEnabledForTab}
            >
              Add credential
            </Button>
          )}
        </div>
      </div>

      <Caption1>
        Set up, connect, and monitor authentication for this endpoint. Pick a method below to
        create/rotate its credential (Setup), copy the exact values to paste into your identity
        provider (Connect), and see its recent auth outcomes (Health). Secrets are shown here when
        the credential secret visibility is set to Always.{' '}
        <Link
          data-testid="connect-tab-link-settings"
          onClick={() => void navigate({ to: '/endpoints/$endpointId/settings', params: { endpointId } })}
        >
          Enable / disable auth methods (Settings)
        </Link>
      </Caption1>

      {/* W11 - per-method sub-tabs (only enabled methods) are the single method axis. */}
      <TabList
        selectedValue={activeTab}
        onTabSelect={(_, d) => setMethodTab(d.value as MethodTab)}
        data-testid="credentials-method-tabs"
      >
        {methodTabs.map((t) => (
          <Tab key={t.value} value={t.value} data-testid={`credentials-method-tab-${t.value}`}>
            {t.label}
          </Tab>
        ))}
      </TabList>

      {noMethods && (
        <MessageBar intent="warning" data-testid="credentials-no-methods">
          <MessageBarBody>
            <MessageBarTitle>No auth methods enabled</MessageBarTitle>
            This endpoint has no authentication method enabled. Enable one in{' '}
            <a href={`/endpoints/${endpointId}/settings`}>Settings</a>.
          </MessageBarBody>
        </MessageBar>
      )}

      {/* W4 - copy / download all info for the ACTIVE method: its connection
          info + the credentials/trusts backing it (no secret values). */}
      {!noMethods && data?.connectionInfo && (
        <div className={classes.headerActions} data-testid={`connect-method-export-row-${activeTab}`}>
          <SettingsJsonExport
            value={buildMethodConnectBundle(endpointId, activeTab as ConnectionMethod, data.connectionInfo, listCredentials)}
            filename={`endpoint-${endpointId}-${activeTab}-connect.json`}
            copyLabel="Copy this method as JSON"
            data-testid={`connect-method-export-${activeTab}`}
          />
        </div>
      )}

      {showSharedSecretInfo && (
        <MessageBar intent="info" data-testid="credentials-shared-secret-info">
          <MessageBarBody>
            <MessageBarTitle>Global Shared secret (bearer)</MessageBarTitle>
            This endpoint accepts the server-wide SCIM shared secret as a bearer token. There is no
            per-endpoint credential to create here - the secret is configured at the server level.
            Turn off <code>SharedSecretBearerAuthEnabled</code> in Settings to require this endpoint
            to use only its own credentials.
          </MessageBarBody>
        </MessageBar>
      )}

      {showGenericList && (listCredentials.length === 0 ? (
        <EmptyState
          icon={<Key24Regular />}
          title="No credentials configured"
          body="Create a per-endpoint bearer credential so SCIM clients can authenticate without sharing the global secret."
          actionLabel="Add credential"
          onAction={() => onOpenCreate(createTypeForTab)}
          data-testid="credentials-empty"
        />
      ) : (
        <div className={classes.list} data-testid="credentials-list">
          {listCredentials.map((cred) => (
            <Card
              key={cred.id}
              className={classes.row}
              data-testid={`credential-row-${cred.id}`}
            >
              <div className={classes.rowGrid}>
                <div>
                  <Subtitle2>{cred.label ?? '(no label)'}</Subtitle2>
                  <div className={classes.meta}>
                    {cred.id} - {cred.credentialType}
                  </div>
                </div>
                <Caption1>
                  Created {new Date(cred.createdAt).toLocaleString()}
                </Caption1>
                <Badge appearance="filled" color={cred.active ? 'success' : 'subtle'}>
                  {cred.active ? 'Active' : 'Revoked'}
                </Badge>
                {/* W7 - primary actions first (Connect, Edit, Export), the
                    less-common + destructive actions in a "More" overflow menu. */}
                {(cred.credentialType === 'oauth_client' || cred.credentialType === 'bearer') && (
                  <Tooltip content="Connect this endpoint to IdP like Entra ID" relationship="label" positioning="above">
                    <Button
                      appearance="secondary"
                      icon={<PlugConnected24Regular />}
                      onClick={() => {
                        const next = connectCredId === cred.id ? null : cred.id;
                        setConnectCredId(next);
                        setConnectSecret(null);
                        // V4 - auto-reveal the retained secret so it shows inline
                        // with the params (a no-op when visibility is `once`).
                        if (next) {
                          revealMutation.mutate(next, {
                            onSuccess: (r) =>
                              setConnectSecret({ id: next, retained: r.retained, clientSecret: r.clientSecret }),
                          });
                        }
                      }}
                      aria-label={`Show connection parameters for ${cred.label ?? cred.id}`}
                      data-testid={`credential-connect-${cred.id}`}
                    >
                      Connect
                    </Button>
                  </Tooltip>
                )}
                {/* V3 - edit the label without rotating (any type). */}
                <Button
                  appearance="subtle"
                  icon={<Edit24Regular />}
                  onClick={() => {
                    setEditLabelId(editLabelId === cred.id ? null : cred.id);
                    setEditLabelValue(cred.label ?? '');
                  }}
                  aria-label={`Edit label for ${cred.label ?? cred.id}`}
                  data-testid={`credential-edit-label-${cred.id}`}
                >
                  Edit
                </Button>
                {/* W5 - copy / download this credential's public object as JSON. */}
                <SettingsJsonExport
                  value={projectCredentialPublic(cred)}
                  filename={`credential-${cred.id}.json`}
                  copyLabel="Copy JSON"
                  data-testid={`credential-export-${cred.id}`}
                />
                {/* W7 - overflow menu for the secondary + destructive actions. */}
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Tooltip content="More actions" relationship="label" positioning="above">
                      <Button
                        appearance="subtle"
                        icon={<MoreHorizontal24Regular />}
                        aria-label={`More actions for ${cred.label ?? cred.id}`}
                        data-testid={`credential-more-${cred.id}`}
                      />
                    </Tooltip>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      {cred.active && cred.credentialType !== 'wif' && (
                        <MenuItem
                          onClick={() => {
                            setRevealResult(null);
                            revealMutation.mutate(cred.id, { onSuccess: (r) => setRevealResult(r) });
                          }}
                          disabled={revealMutation.isPending}
                          data-testid={`credential-reveal-${cred.id}`}
                        >
                          Reveal secret
                        </MenuItem>
                      )}
                      {cred.active && cred.credentialType !== 'wif' && (
                        <MenuItem
                          onClick={() => {
                            setRotateResult(null);
                            rotateMutation.mutate(cred.id, { onSuccess: (r) => setRotateResult(r) });
                          }}
                          disabled={rotateMutation.isPending}
                          data-testid={`credential-rotate-${cred.id}`}
                        >
                          Rotate secret
                        </MenuItem>
                      )}
                      <MenuItem
                        onClick={() => {
                          if (cred.active) deactivateMutation.mutate(cred.id);
                          else activateMutation.mutate(cred.id);
                        }}
                        disabled={activateMutation.isPending || deactivateMutation.isPending}
                        data-testid={`credential-toggle-active-${cred.id}`}
                      >
                        {cred.active ? 'Deactivate' : 'Activate'}
                      </MenuItem>
                      <MenuItem
                        icon={<Delete24Regular />}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(cred);
                        }}
                        data-testid={`credential-delete-${cred.id}`}
                      >
                        Revoke credential
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              </div>
              {/* V1 - remaining-validity line. */}
              {(() => {
                const v = validityDescriptor(cred.expiresAt);
                return (
                  <Caption1
                    className={classes.meta}
                    style={{
                      color:
                        v.level === 'error'
                          ? tokens.colorPaletteRedForeground1
                          : v.level === 'warning'
                            ? tokens.colorPaletteDarkOrangeForeground1
                            : undefined,
                    }}
                    data-testid={`credential-validity-${cred.id}`}
                  >
                    {v.text}
                  </Caption1>
                );
              })()}
              {/* V3 - inline label edit form. */}
              {editLabelId === cred.id && (
                <div className={classes.connectPanel} data-testid={`credential-edit-label-form-${cred.id}`}>
                  <EditableField
                    label="Label"
                    value={editLabelValue}
                    onChange={setEditLabelValue}
                    data-testid={`credential-edit-label-input-${cred.id}`}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      appearance="primary"
                      disabled={editLabelMutation.isPending}
                      onClick={() =>
                        editLabelMutation.mutate(
                          { credentialId: cred.id, label: editLabelValue.trim() || null },
                          { onSuccess: () => setEditLabelId(null) },
                        )
                      }
                      data-testid={`credential-edit-label-save-${cred.id}`}
                    >
                      {editLabelMutation.isPending ? 'Saving...' : 'Save label'}
                    </Button>
                    <Button appearance="secondary" onClick={() => setEditLabelId(null)} data-testid={`credential-edit-label-cancel-${cred.id}`}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {/* U2 / W8 - per-credential Connect params (in-card), for both
                  oauth_client and bearer credentials. */}
              {(cred.credentialType === 'oauth_client' || cred.credentialType === 'bearer') && connectCredId === cred.id && (
                <div className={classes.connectPanel} data-testid={`credential-connect-panel-${cred.id}`}>
                  <Caption1>
                    <strong>Connect this endpoint to IdP like Entra ID</strong> - paste these into
                    your identity provider&apos;s{' '}
                    {cred.credentialType === 'oauth_client'
                      ? 'OAuth2 client-credentials'
                      : 'bearer-token (Secret Token)'}{' '}
                    connection form.
                  </Caption1>
                  {/* W6 - copy / download the whole IdP-connection bundle for this credential. */}
                  <SettingsJsonExport
                    value={
                      cred.credentialType === 'oauth_client'
                        ? {
                            applicationApiUrl: connectScimUrl,
                            oauthTokenEndpoint: connectTokenUrl,
                            clientIdentifier: cred.oauthClientId ?? null,
                          }
                        : { applicationApiUrl: connectScimUrl }
                    }
                    filename={`credential-${cred.id}-connection.json`}
                    copyLabel="Copy connection JSON"
                    data-testid={`credential-connect-export-${cred.id}`}
                  />
                  <div className={classes.connectRow}>
                    <InfoLabel info={CONNECT_PARAM_HELP.applicationApiUrl} data-testid={`credential-connect-appurl-info-${cred.id}`}>Application API URL</InfoLabel>
                    <CopyableField value={connectScimUrl} monospace truncate data-testid={`credential-connect-appurl-${cred.id}`} />
                  </div>
                  {cred.credentialType === 'oauth_client' && (
                    <>
                      <div className={classes.connectRow}>
                        <InfoLabel info={CONNECT_PARAM_HELP.oauthTokenEndpoint} data-testid={`credential-connect-tokenurl-info-${cred.id}`}>OAuth token endpoint</InfoLabel>
                        <CopyableField value={connectTokenUrl} monospace truncate data-testid={`credential-connect-tokenurl-${cred.id}`} />
                      </div>
                      <div className={classes.connectRow}>
                        <InfoLabel info={CONNECT_PARAM_HELP.clientIdentifier} data-testid={`credential-connect-clientid-info-${cred.id}`}>Client identifier</InfoLabel>
                        <CopyableField
                          value={cred.oauthClientId ?? '-'}
                          monospace
                          truncate
                          data-testid={`credential-connect-clientid-${cred.id}`}
                        />
                      </div>
                    </>
                  )}
                  {/* V4 - the secret, inline, when the endpoint retains it
                      (CredentialSecretVisibility=always). For bearer this is the
                      Secret Token; for oauth_client the client secret. */}
                  {connectSecret?.id === cred.id && connectSecret.retained && connectSecret.clientSecret ? (
                    <div className={classes.connectRow}>
                      <InfoLabel info={CONNECT_PARAM_HELP.clientSecret} data-testid={`credential-connect-secret-info-${cred.id}`}>
                        {cred.credentialType === 'oauth_client' ? 'Client secret' : 'Secret token (bearer)'}
                      </InfoLabel>
                      <CopyableField
                        value={connectSecret.clientSecret}
                        monospace
                        truncate
                        data-testid={`credential-connect-secret-${cred.id}`}
                      />
                    </div>
                  ) : (
                    <Caption1 data-testid={`credential-connect-secret-note-${cred.id}`}>
                      The {cred.credentialType === 'oauth_client' ? 'client secret' : 'bearer token'} is
                      shown here when the endpoint retains it (CredentialSecretVisibility=always);
                      otherwise Rotate to get a fresh one.
                    </Caption1>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      ))}

      {/* Federated Identity (WIF) section (Q6.5) */}
      {showWifSection && (
        <WifCredentialsSection
          endpointId={endpointId}
          enabled={wifEnabled}
          credentials={credentials}
          createMutation={createMutation}
          deleteMutation={deleteMutation}
        />
      )}

      {/* W12 - the endpoint-level ConnectionPanel is kept ONLY for the
          shared-secret method, which has no per-credential card + subpanel to
          carry its connection info. For bearer / oauth_client / wif the per-card
          Connect subpanels (W6/W8) provide the same values, so the redundant
          endpoint-level card is removed on those tabs. */}
      {showSharedSecretInfo && data?.connectionInfo && (
        <UnifiedConnectSection
          endpointId={endpointId}
          connectionInfo={data.connectionInfo}
          activeMethod="shared_secret"
        />
      )}

      {/* P5 - Health: the recent auth decisions for this endpoint, with the
          expected-vs-received diff + the P3 request-log deep-link. */}
      <AuthDiagnosticsPanel endpointId={endpointId} data-testid="connect-tab-auth-diagnostics" />

      {/* Create dialog */}
      <FormDialog
        open={createOpen}
        onCancel={onCloseCreate}
        onSubmit={createdCred ? onCloseCreate : onSubmitCreate}
        title={createdCred ? 'Credential created' : 'Add credential'}
        submitLabel={createdCred ? 'Done' : 'Create'}
        cancelLabel="Cancel"
        busy={createMutation.isPending}
        error={createError}
        data-testid="credentials-create-dialog"
      >
        {!createdCred && (
          <div className={classes.formCol}>
            <Field label="Credential type">
              <Dropdown
                value={createType === 'oauth_client' ? 'OAuth2 client credentials' : 'Bearer token'}
                selectedOptions={[createType]}
                onOptionSelect={(_, d) => setCreateType((d.optionValue as 'bearer' | 'oauth_client') ?? 'bearer')}
                data-testid="credentials-type-dropdown"
              >
                <Option value="bearer" text="Bearer token">Bearer token</Option>
                <Option value="oauth_client" text="OAuth2 client credentials">OAuth2 client credentials</Option>
              </Dropdown>
            </Field>
            <Field label="Label (optional)" hint="Human-readable name for this credential">
              <Input
                value={labelInput}
                onChange={(_, d) => setLabelInput(d.value)}
                placeholder="e.g. Entra production"
                data-testid="credentials-label-input"
              />
            </Field>
          </div>
        )}
        {createdCred && createdCred.credentialType === 'oauth_client' && (
          <div className={classes.formCol} data-testid="credentials-oauth-result">
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>
                  <Warning24Regular /> Save the client secret now
                </MessageBarTitle>
                The client identifier stays visible, but the secret is shown once here
                (unless this endpoint retains secrets). The server stores only a bcrypt hash.
              </MessageBarBody>
            </MessageBar>
            <Field label="Client Identifier">
              <CopyableField
                value={createdCred.clientId ?? ''}
                monospace
                data-testid="credentials-oauth-clientid"
              />
            </Field>
            <Field label="Client Secret">
              <CopyableField
                value={createdCred.plaintext}
                monospace
                data-testid="credentials-oauth-clientsecret"
              />
            </Field>
            <CopyJsonButton
              value={{
                clientId: createdCred.clientId,
                clientSecret: createdCred.plaintext,
                tokenEndpoint: `${window.location.origin}/scim/endpoints/${endpointId}/oauth/token`,
                grantType: 'client_credentials',
              }}
              label="Copy all as JSON"
              data-testid="credentials-oauth-copy-json"
            />
          </div>
        )}
        {createdCred && createdCred.credentialType === 'bearer' && (
          <div className={classes.formCol}>
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>
                  <Warning24Regular /> Save this token now
                </MessageBarTitle>
                It will not be shown again. The server stores only a
                bcrypt hash; if you lose this string you must create a
                new credential.
              </MessageBarBody>
            </MessageBar>
            <div className={classes.tokenBox} data-testid="credentials-plaintext">
              <div className={classes.tokenRow}>
                <Text size={400} weight="semibold">
                  Bearer token
                </Text>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Copy16Regular />}
                  onClick={() => void onCopyToken()}
                  data-testid="credentials-copy-button"
                >
                  {copyState === 'copied'
                    ? 'Copied'
                    : copyState === 'error'
                      ? 'Copy failed'
                      : 'Copy'}
                </Button>
              </div>
              <code data-testid="credentials-token-value">{createdCred.plaintext}</code>
            </div>
          </div>
        )}
      </FormDialog>

      {/* Delete confirm dialog */}
      <FormDialog
        open={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onSubmit={onConfirmDelete}
        title={`Revoke credential${deleteTarget?.label ? ` "${deleteTarget.label}"` : ''}?`}
        submitLabel="Revoke"
        cancelLabel="Keep"
        busy={deleteMutation.isPending}
        error={deleteError}
        data-testid="credentials-delete-dialog"
      >
        <Body1>
          Once revoked, any SCIM client using this token will start receiving
          401 Unauthorized. This cannot be undone.
        </Body1>
      </FormDialog>

      {/* WI-8: reveal result dialog (retained secret or "not retained" reason) */}
      <FormDialog
        open={Boolean(revealResult)}
        onCancel={() => setRevealResult(null)}
        onSubmit={() => setRevealResult(null)}
        title="Revealed credential secret"
        submitLabel="Done"
        cancelLabel="Close"
        data-testid="credentials-reveal-dialog"
      >
        {revealResult?.retained ? (
          <div className={classes.revealBox} data-testid="credentials-reveal-secret">
            <Body1>
              This is the retained secret for this credential. Handle it like any secret.
            </Body1>
            <CopyableField
              value={revealResult.clientSecret ?? revealResult.token ?? ''}
              monospace
              data-testid="credentials-reveal-value"
            />
          </div>
        ) : (
          <Body1 data-testid="credentials-reveal-not-retained">
            {revealResult?.reason ??
              'This secret is not retained. Rotate the credential to obtain a viewable secret.'}
          </Body1>
        )}
      </FormDialog>

      {/* WI-9: rotate result dialog (the one-time NEW secret) */}
      <FormDialog
        open={Boolean(rotateResult)}
        onCancel={() => setRotateResult(null)}
        onSubmit={() => setRotateResult(null)}
        title="Rotated credential - new secret"
        submitLabel="Done"
        cancelLabel="Close"
        data-testid="credentials-rotate-dialog"
      >
        {rotateResult && (
          <div className={classes.revealBox} data-testid="credentials-rotate-secret">
            <Body1>
              A new secret was minted and the old credential was revoked. Copy it now - it is shown
              once{rotateResult.clientId ? '. The client id is unchanged.' : '.'}
            </Body1>
            {rotateResult.clientId && (
              <CopyableField
                value={rotateResult.clientId}
                monospace
                data-testid="credentials-rotate-clientid"
              />
            )}
            <CopyableField
              value={rotateResult.clientSecret ?? rotateResult.token ?? ''}
              monospace
              data-testid="credentials-rotate-value"
            />
          </div>
        )}
      </FormDialog>
    </div>
  );
};
