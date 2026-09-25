/**
 * MeProfilePage (Phase L2) - per-endpoint /Me self-service.
 *
 * Wires the already-shipped /scim/endpoints/:id/Me surface
 * (RFC 7644 S3.11, v0.20.0) into the redesigned UI. Until L2 the
 * token holder could never see what the server thinks they are.
 *
 * Design constraints from analysis-doc S4.7:
 *   - Per-endpoint (the URL is /scim/endpoints/:id/Me, not a
 *     top-level /Me) so the operator must pick an endpoint first.
 *   - Server requires OAuth JWT auth with a `sub` claim matching a
 *     User's `userName`. The K3 TokenGate's shared-secret bearer
 *     ALWAYS returns 404 noTarget. The page renders a clear
 *     "OAuth required" hint in that case so the operator does not
 *     blame the UI for a backend constraint.
 *   - Save uses a SCIM PatchOp envelope (mirrors the pattern from
 *     ResourceDetailDrawer Phase E4).
 *   - Delete is gated by a type-username-to-confirm modal because
 *     deleting your own /Me is the largest data-loss footgun on
 *     the page.
 */
import React, { useEffect, useState } from 'react';
import {
  makeStyles,
  tokens,
  Button,
  Card,
  Caption1,
  Input,
  Field,
  Subtitle1,
  Subtitle2,
  Switch,
  Text,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import { Person24Regular, Delete24Regular, PlugConnected24Regular, Key24Regular } from '@fluentui/react-icons';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEndpoints, useMe, usePatchMe, useDeleteMe } from '../api/queries';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';
import { EmptyState, LoadingSkeleton, EditableField, CopyableField } from '../components/primitives';
import { EndpointContextSelector } from '../components/endpoints/EndpointContextSelector';
import { FormDialog } from '../components/primitives/FormDialog';
import { ScimApiError } from '../api/scim-error';
import { decodeJwt } from '../utils/jwt-decode';
import {
  TOKEN_CHANGED_EVENT,
  clearStoredToken,
  getStoredToken,
  notifyTokenInvalid,
} from '../auth/token';
import type { MeSearch } from '../routes/search-schemas';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '900px',
    margin: '0 auto',
    padding: '24px',
  },
  profileBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  metaRow: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'space-between',
    paddingTop: '12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  oauthHintCard: {
    padding: '12px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
  },
});

export const MeProfilePage: React.FC = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Partial<MeSearch>;

  const endpoints = useEndpoints();
  const pickedEp = search.endpointId ?? '';
  const setPickedEp = (endpointId: string): void => {
    void navigate({
      to: '/me',
      search: (previous) => ({ ...previous, endpointId }),
    });
  };
  const endpointList = endpoints.data?.endpoints ?? [];
  const selectedEndpoint = endpointList.find((endpoint) => endpoint.id === pickedEp);
  const endpointScopeIsValid = Boolean(selectedEndpoint?.active);
  const [token, setToken] = useState(() => getStoredToken());
  useEffect(() => {
    const handleTokenChange = () => setToken(getStoredToken());
    window.addEventListener(TOKEN_CHANGED_EVENT, handleTokenChange);
    return () => window.removeEventListener(TOKEN_CHANGED_EVENT, handleTokenChange);
  }, []);
  const decodedToken = React.useMemo(() => decodeJwt(token), [token]);
  const tokenSubject = typeof decodedToken.payload?.sub === 'string'
    ? decodedToken.payload.sub.trim()
    : '';
  const canResolveMe = Boolean(endpointScopeIsValid && decodedToken.isJwt && tokenSubject);
  const me = useMe(canResolveMe ? pickedEp : '');
  const patchMutation = usePatchMe(pickedEp);
  const deleteMutation = useDeleteMe(pickedEp);

  const [displayName, setDisplayName] = useState('');
  const [active, setActive] = useState(true);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Re-seed form fields when the underlying /Me payload arrives or
  // changes (post-PATCH refetch). Mirrors the pattern used by
  // EditEndpointPage to keep the form in sync with server truth.
  useEffect(() => {
    if (me.data) {
      setDisplayName(me.data.displayName ?? '');
      setActive(me.data.active ?? true);
    }
  }, [me.data]);

  const isNoTargetError =
    me.error instanceof ScimApiError &&
    me.error.status === 404 &&
    me.error.scimType === 'noTarget';

  const handleSave = async (): Promise<void> => {
    if (!me.data) return;
    setSubmitError(null);
    const ops: Array<Record<string, unknown>> = [];
    if (displayName !== (me.data.displayName ?? '')) {
      ops.push({ op: 'replace', path: 'displayName', value: displayName });
    }
    if (active !== (me.data.active ?? true)) {
      ops.push({ op: 'replace', path: 'active', value: active });
    }
    if (ops.length === 0) return;
    try {
      await patchMutation.mutateAsync({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: ops,
      });
    } catch (err) {
      setSubmitError(err);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!me.data || deleteConfirmText !== me.data.userName) return;
    setSubmitError(null);
    try {
      await deleteMutation.mutateAsync();
      setDeleteOpen(false);
      setDeleteConfirmText('');
    } catch (err) {
      setSubmitError(err);
    }
  };

  return (
    <div className={classes.page} data-testid="me-profile-page">
      <Subtitle1>Self-service profile (/Me)</Subtitle1>

      <Card className={classes.oauthHintCard}>
        <Caption1>
          Self-service view of the SCIM User identified by this OAuth token. The token subject must
          match that User&apos;s userName on the selected endpoint. This is not the SCIMServer admin
          operator&apos;s account profile.
        </Caption1>
      </Card>

      <div data-testid="me-endpoint-picker">
        {endpoints.isLoading ? (
          <LoadingSkeleton count={2} height="60px" />
        ) : endpointList.length === 0 ? (
          <EmptyState
            title="No endpoints"
            body="Create an endpoint first, then come back to view your /Me."
          />
        ) : (
          <EndpointContextSelector
            endpoints={endpointList}
            value={pickedEp}
            onChange={setPickedEp}
            label="Profile endpoint"
            purpose="The token subject is resolved independently inside the selected endpoint."
            placeholder="Select the endpoint that issued this user token"
            data-testid="me-endpoint-picker-control"
          />
        )}
      </div>

      {!pickedEp && (
        <EmptyState
          data-testid="me-empty"
          title="Pick an endpoint to see your /Me"
          body="The /Me alias is per-endpoint (RFC 7644 S3.11)."
        />
      )}

      {pickedEp && !endpoints.isLoading && !selectedEndpoint && (
        <EmptyState
          data-testid="me-stale-endpoint"
          title="Selected endpoint is no longer available"
          body="Choose an active endpoint before resolving this token subject."
          actionLabel="Clear endpoint"
          onAction={() => void navigate({
            to: '/me',
            search: (previous) => ({ ...previous, endpointId: undefined }),
          })}
        />
      )}

      {selectedEndpoint && !selectedEndpoint.active && (
        <EmptyState
          data-testid="me-inactive-endpoint"
          title="Selected endpoint is inactive"
          body="Activate the endpoint or choose another active endpoint before resolving /Me."
        />
      )}

      {endpointScopeIsValid && !canResolveMe && (
        <Card data-testid="me-oauth-preflight">
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>OAuth user token required</MessageBarTitle>
              The current token has no readable JWT subject, so it cannot identify a SCIM User.
              Configure an OAuth client credential on this endpoint, mint a user-subject token,
              then replace the current token.
            </MessageBarBody>
          </MessageBar>
          <div className={classes.buttonRow}>
            <Button
              appearance="subtle"
              icon={<Key24Regular />}
              onClick={() => { clearStoredToken(); notifyTokenInvalid(); }}
            >
              Change token
            </Button>
            <Button
              appearance="primary"
              icon={<PlugConnected24Regular />}
              onClick={() => void navigate({
                to: '/endpoints/$endpointId/connect',
                params: { endpointId: pickedEp },
                search: { method: 'oauth_client' },
              })}
            >
              Open OAuth setup
            </Button>
          </div>
        </Card>
      )}

      {canResolveMe && me.isLoading && (
        <LoadingSkeleton count={4} height="40px" data-testid="me-loading" />
      )}

      {canResolveMe && me.isError && (
        <div className={classes.profileBody}>
          {isNoTargetError ? (
            <Card data-testid="me-subject-not-found">
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>No User matches this token subject</MessageBarTitle>
                  The server verified the token, but the selected endpoint has no User whose
                  userName equals this subject:
                </MessageBarBody>
              </MessageBar>
              <CopyableField value={tokenSubject} monospace data-testid="me-token-subject" />
              <Button
                appearance="subtle"
                onClick={() => void navigate({
                  to: '/endpoints/$endpointId/users',
                  params: { endpointId: pickedEp },
                  search: { page: 1, filter: `userName eq "${tokenSubject.replace(/"/g, '\\"')}"` },
                })}
              >
                Open endpoint Users
              </Button>
            </Card>
          ) : (
            <ScimErrorMessage error={me.error} />
          )}
        </div>
      )}

      {canResolveMe && me.data && (
        <Card data-testid="me-profile-card">
          <div className={classes.profileBody}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Person24Regular />
              <Subtitle2 data-testid="me-username">{me.data.userName}</Subtitle2>
            </div>
            <div className={classes.metaRow}>
              <span data-testid="me-id">id: {me.data.id}</span>
              {me.data.meta?.version && <span>version: {me.data.meta.version}</span>}
              {me.data.meta?.lastModified && (
                <span>last modified: {me.data.meta.lastModified}</span>
              )}
            </div>

            <EditableField
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              data-testid="me-displayname"
            />

            <Field label="Active">
              <Switch
                checked={active}
                onChange={(_e, d) => setActive(d.checked)}
                data-testid="me-active-switch"
              />
            </Field>

            <ScimErrorMessage error={submitError} />

            <div className={classes.buttonRow}>
              <Button
                appearance="subtle"
                icon={<Delete24Regular />}
                onClick={() => setDeleteOpen(true)}
                data-testid="me-delete-button"
                disabled={deleteMutation.isPending}
              >
                Delete
              </Button>
              <Button
                appearance="primary"
                onClick={() => void handleSave()}
                disabled={patchMutation.isPending}
                data-testid="me-save-button"
              >
                {patchMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <FormDialog
        open={deleteOpen}
        onCancel={() => {
          if (deleteMutation.isPending) return;
          setDeleteOpen(false);
          setDeleteConfirmText('');
        }}
        onSubmit={() => {
          void handleDelete();
        }}
        title="Delete /Me"
        submitLabel="Delete /Me"
        cancelLabel="Cancel"
        busy={deleteMutation.isPending}
        disabled={!me.data || deleteConfirmText !== me.data.userName}
        data-testid="me-delete-dialog"
      >
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>This deactivates your own SCIM identity</MessageBarTitle>
            Type your userName exactly to confirm.
          </MessageBarBody>
        </MessageBar>
        {me.data && (
          <Text style={{ fontFamily: tokens.fontFamilyMonospace }}>{me.data.userName}</Text>
        )}
        <Field label="Confirm userName">
          <Input
            value={deleteConfirmText}
            onChange={(_e, d) => setDeleteConfirmText(d.value)}
            placeholder={me.data?.userName ?? ''}
            data-testid="me-delete-confirm-input"
          />
        </Field>
      </FormDialog>
    </div>
  );
};
