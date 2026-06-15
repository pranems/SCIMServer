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

export interface CredentialsTabProps {
  endpointId: string;
}

interface CreatedCredential {
  id: string;
  label: string | null;
  plaintext: string;
  createdAt: string;
}

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
