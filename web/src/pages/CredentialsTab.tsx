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
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import {
  Add24Regular,
  Delete24Regular,
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
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '12px',
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
}

const EMPTY_WIF_FORM: WifTrustForm = {
  expectedIssuer: '',
  expectedSubject: '',
  expectedAudience: '',
  jwksUri: '',
  allowedTenantId: '',
  requiredRoles: '',
  scope: '',
};

/** A single Test Connection readiness step (client-side dry-run). */
interface WifTestStep {
  label: string;
  ok: boolean;
}

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
    };
  }, [form]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const tokenUrl = `${origin}/scim/endpoints/${endpointId}/oauth/token`;
  const scimUrl = `${origin}/scim/endpoints/${endpointId}/v2`;

  const requiredOk =
    trustPayload.expectedIssuer !== '' &&
    trustPayload.expectedSubject !== '' &&
    trustPayload.expectedAudience !== '' &&
    trustPayload.jwksUri !== '' &&
    trustPayload.allowedTenantId !== '';

  const onSave = (): void => {
    setSaveError(null);
    setSaved(null);
    createMutation.mutate(
      { credentialType: 'wif', label: 'Federated Identity (WIF)', wif: trustPayload },
      {
        onSuccess: (raw) => {
          const cred = raw as unknown as { id: string };
          setSaved({ id: cred.id });
        },
        onError: (err) => setSaveError(err),
      },
    );
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
            <div className={wif.fieldGrid}>
              <EditableField
                label="Issuer (iss)"
                value={form.expectedIssuer}
                onChange={setField('expectedIssuer')}
                placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
                monospace
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
                data-testid="wif-field-jwks"
              />
              <EditableField
                label="Allowed tenant id (tid)"
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
            </div>

            <div className={wif.actions}>
              <Button
                appearance="primary"
                onClick={onSave}
                disabled={!requiredOk || createMutation.isPending}
                data-testid="wif-save-button"
              >
                Save WIF trust
              </Button>
              <Button
                icon={<PlugConnected24Regular />}
                onClick={onTestConnection}
                data-testid="wif-test-button"
              >
                Test Connection
              </Button>
              <CopyJsonButton
                value={trustPayload}
                label="Copy trust as JSON"
                data-testid="wif-copy-json"
              />
            </div>

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

            {wifCredentials.length > 0 && (
              <div className={classes.list} data-testid="wif-credentials-list">
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
                      <Button
                        appearance="subtle"
                        icon={<Delete24Regular />}
                        onClick={() => deleteMutation.mutate(cred.id)}
                        aria-label={`Revoke WIF credential ${cred.label ?? cred.id}`}
                        data-testid={`wif-credential-delete-${cred.id}`}
                      />
                    </div>
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

  // Local UI state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [labelInput, setLabelInput] = React.useState('');
  const [createError, setCreateError] = React.useState<unknown>(null);
  // Plaintext token returned ONCE on create - keep around so the user
  // can copy it. Cleared when the modal closes after acknowledgement.
  const [createdCred, setCreatedCred] = React.useState<CreatedCredential | null>(null);

  const [deleteTarget, setDeleteTarget] = React.useState<EndpointOverviewCredential | null>(null);
  const [deleteError, setDeleteError] = React.useState<unknown>(null);

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
    </div>
  );
};
