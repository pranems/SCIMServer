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
  Dropdown,
  Option,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import {
  Add24Regular,
  Delete24Regular,
  Edit24Regular,
  Copy16Regular,
  Key24Regular,
  Warning24Regular,
  ShieldKeyhole24Regular,
  PlugConnected24Regular,
} from '@fluentui/react-icons';
import {
  useEndpointOverview,
  useCreateCredential,
  useDeleteCredential,
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
} from '../api/queries';
import type { EndpointOverviewCredential } from '@scim/types/dashboard.types';
import {
  EmptyState,
  FormDialog,
  LoadingSkeleton,
  EditableField,
  CopyableField,
  CopyJsonButton,
} from '../components/primitives';

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
  if (!trust) return null;
  const rows: Array<{ key: string; label: string; value: string | null }> = [
    { key: 'issuer', label: 'Issuer (iss)', value: trust.expectedIssuer ?? null },
    { key: 'subject', label: 'Subject (sub)', value: trust.expectedSubject ?? null },
    { key: 'audience', label: 'Audience (aud)', value: trust.expectedAudience ?? null },
    { key: 'jwks', label: 'JWKS URI', value: trust.jwksUri ?? null },
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
    <div className={styles.wifDetailGrid} data-testid={`wif-credential-details-${credId}`}>
      {rows.map((r) => (
        <React.Fragment key={r.key}>
          <Caption1 className={styles.wifDetailLabel}>{r.label}</Caption1>
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
        </React.Fragment>
      ))}
    </div>
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

  const [form, setForm] = React.useState<WifTrustForm>(EMPTY_WIF_FORM);
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const [saved, setSaved] = React.useState<{ id: string } | null>(null);
  const [testSteps, setTestSteps] = React.useState<WifTestStep[] | null>(null);
  // Item 4 - edit mode: when set, the form edits an existing trust (PUT)
  // instead of creating a new one.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const updateMutation = useUpdateWifCredential(endpointId);
  // Item 6 - server-side reachability/liveness verification.
  const verifyMutation = useVerifyWifTrust(endpointId);
  const [verifyResult, setVerifyResult] = React.useState<WifVerifyResult | null>(null);
  // Item C - when a verify-gated save fails, offer an explicit override.
  const [needsOverride, setNeedsOverride] = React.useState(false);

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

  // Item 4 - load a saved trust into the form for editing.
  const onEditTrust = (cred: EndpointOverviewCredential): void => {
    const t = cred.wif;
    if (!t) return;
    setSaved(null);
    setSaveError(null);
    setTestSteps(null);
    setEditingId(cred.id);
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
    // Bring the form into view for the operator.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onCancelEdit = (): void => {
    setEditingId(null);
    setForm(EMPTY_WIF_FORM);
    setSaveError(null);
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
  const onVerify = (): void => {
    setVerifyResult(null);
    verifyMutation.mutate(
      { expectedIssuer: trustPayload.expectedIssuer, jwksUri: trustPayload.jwksUri },
      { onSuccess: (res) => setVerifyResult(res) },
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
            <div className={wif.fieldGrid}>
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
                label="JWKS URI"
                value={form.jwksUri}
                onChange={setField('jwksUri')}
                placeholder="https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys"
                monospace
                validationMessage={httpsUrlError(form.jwksUri)}
                data-testid="wif-field-jwks"
              />
              <JwksAllowlistNotice jwksUri={form.jwksUri} styles={wif} />
              <EditableField
                label="Allowed tenant id (tid / expectedTenantId)"
                value={form.allowedTenantId}
                onChange={setField('allowedTenantId')}
                placeholder="tenant guid"
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
                          icon={<Delete24Regular />}
                          onClick={() => deleteMutation.mutate(cred.id)}
                          aria-label={`Revoke WIF credential ${cred.label ?? cred.id}`}
                          data-testid={`wif-credential-delete-${cred.id}`}
                        />
                      </div>
                    </div>
                    <WifTrustDetails credId={cred.id} trust={cred.wif} styles={wif} />
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

export const CredentialsTab: React.FC<CredentialsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpointOverview(endpointId);
  const createMutation = useCreateCredential(endpointId);
  const deleteMutation = useDeleteCredential(endpointId);
  const revealMutation = useRevealCredential(endpointId);
  const rotateMutation = useRotateCredential(endpointId);

  // Local UI state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [labelInput, setLabelInput] = React.useState('');
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

  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'error'>('idle');

  const onOpenCreate = (): void => {
    setLabelInput('');
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
      { label: labelInput.trim() || undefined },
      {
        onSuccess: (raw) => {
          // Backend returns { id, label, token, createdAt, ... } with
          // `token` as the plaintext bearer string. Locked at backend
          // by the controller comment "⚠️ Token is returned ONLY here".
          const cred = raw as unknown as {
            id: string;
            label: string | null;
            token: string;
            createdAt: string;
          };
          setCreatedCred({
            id: cred.id,
            label: cred.label,
            plaintext: cred.token,
            createdAt: cred.createdAt,
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
  // We surface the explanatory banner up front when the underlying
  // config flag is off.
  const flagEnabled = Boolean(data?.configFlags?.PerEndpointCredentialsEnabled);
  const wifEnabled = Boolean(data?.configFlags?.WifCredentialsEnabled);
  const credentials = data?.credentials ?? [];

  return (
    <div className={classes.root} data-testid="tab-credentials">
      <div className={classes.header}>
        <Subtitle1>Credentials ({credentials.length})</Subtitle1>
        <Button
          appearance="primary"
          icon={<Add24Regular />}
          onClick={onOpenCreate}
          data-testid="credentials-create-button"
          disabled={!flagEnabled}
        >
          Add credential
        </Button>
      </div>

      {!flagEnabled && (
        <MessageBar intent="warning" data-testid="credentials-flag-disabled-banner">
          <MessageBarBody>
            <MessageBarTitle>Per-endpoint credentials are disabled</MessageBarTitle>
            Enable <code>PerEndpointCredentialsEnabled</code> in the endpoint{' '}
            <a href={`/endpoints/${endpointId}/settings`}>Settings</a> tab to
            create per-endpoint bearer credentials.
          </MessageBarBody>
        </MessageBar>
      )}

      {flagEnabled && credentials.length === 0 ? (
        <EmptyState
          icon={<Key24Regular />}
          title="No credentials configured"
          body="Create a per-endpoint bearer credential so SCIM clients can authenticate without sharing the global secret."
          actionLabel="Add credential"
          onAction={onOpenCreate}
          data-testid="credentials-empty"
        />
      ) : (
        <div className={classes.list} data-testid="credentials-list">
          {credentials.map((cred) => (
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
                {cred.active && cred.credentialType !== 'wif' && (
                  <Button
                    appearance="subtle"
                    onClick={() => {
                      setRevealResult(null);
                      revealMutation.mutate(cred.id, {
                        onSuccess: (r) => setRevealResult(r),
                      });
                    }}
                    disabled={revealMutation.isPending}
                    aria-label={`Reveal secret for ${cred.label ?? cred.id}`}
                    data-testid={`credential-reveal-${cred.id}`}
                  >
                    Reveal
                  </Button>
                )}
                {cred.active && cred.credentialType !== 'wif' && (
                  <Button
                    appearance="subtle"
                    onClick={() => {
                      setRotateResult(null);
                      rotateMutation.mutate(cred.id, {
                        onSuccess: (r) => setRotateResult(r),
                      });
                    }}
                    disabled={rotateMutation.isPending}
                    aria-label={`Rotate secret for ${cred.label ?? cred.id}`}
                    data-testid={`credential-rotate-${cred.id}`}
                  >
                    Rotate
                  </Button>
                )}
                <Button
                  appearance="subtle"
                  icon={<Delete24Regular />}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(cred);
                  }}
                  aria-label={`Revoke credential ${cred.label ?? cred.id}`}
                  data-testid={`credential-delete-${cred.id}`}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Federated Identity (WIF) section (Q6.5) */}
      <WifCredentialsSection
        endpointId={endpointId}
        enabled={wifEnabled}
        credentials={credentials}
        createMutation={createMutation}
        deleteMutation={deleteMutation}
      />

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
        {createdCred && (
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
