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
import React, { useEffect, useMemo, useState } from 'react';
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
import { Person24Regular, Delete24Regular } from '@fluentui/react-icons';
import { useEndpoints, useMe, usePatchMe, useDeleteMe } from '../api/queries';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';
import { EmptyState, LoadingSkeleton } from '../components/primitives';
import { FormDialog } from '../components/primitives/FormDialog';
import { ScimApiError } from '../api/scim-error';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '900px',
    margin: '0 auto',
    padding: '24px',
  },
  pickerCard: {
    padding: '12px',
    cursor: 'pointer',
    border: `1px solid transparent`,
  },
  pickerCardSelected: {
    borderColor: tokens.colorBrandStroke1,
    boxShadow: tokens.shadow4Brand,
  },
  pickerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
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

  const endpoints = useEndpoints();
  const [pickedEp, setPickedEp] = useState<string>('');
  const me = useMe(pickedEp);
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

  const isOAuthRequiredError =
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

  const endpointList = endpoints.data?.endpoints ?? [];

  return (
    <div className={classes.page} data-testid="me-profile-page">
      <Subtitle1>My profile (/Me)</Subtitle1>

      <Card className={classes.oauthHintCard}>
        <Caption1>
          /Me requires an OAuth JWT whose `sub` claim matches a SCIM User`s `userName` on the picked
          endpoint. With the global shared-secret token in TokenGate, every /Me call returns 404.
          Switch to a per-endpoint OAuth credential to use this page.
        </Caption1>
      </Card>

      <div data-testid="me-endpoint-picker">
        <Subtitle2>Pick an endpoint</Subtitle2>
        {endpoints.isLoading ? (
          <LoadingSkeleton count={2} height="60px" />
        ) : endpointList.length === 0 ? (
          <EmptyState
            title="No endpoints"
            body="Create an endpoint first, then come back to view your /Me."
          />
        ) : (
          <div className={classes.pickerGrid}>
            {endpointList.map((ep) => {
              const selected = ep.id === pickedEp;
              return (
                <Card
                  key={ep.id}
                  className={`${classes.pickerCard} ${selected ? classes.pickerCardSelected : ''}`}
                  onClick={() => setPickedEp(ep.id)}
                  role="button"
                  aria-pressed={selected}
                  data-testid={`me-endpoint-option-${ep.id}`}
                >
                  <Text weight="semibold">{ep.displayName ?? ep.name}</Text>
                  <br />
                  <Caption1 style={{ fontFamily: tokens.fontFamilyMonospace }}>
                    {ep.name}
                  </Caption1>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {!pickedEp && (
        <EmptyState
          data-testid="me-empty"
          title="Pick an endpoint to see your /Me"
          body="The /Me alias is per-endpoint (RFC 7644 S3.11)."
        />
      )}

      {pickedEp && me.isLoading && (
        <LoadingSkeleton count={4} height="40px" data-testid="me-loading" />
      )}

      {pickedEp && me.isError && (
        <div className={classes.profileBody}>
          <ScimErrorMessage error={me.error} />
          {isOAuthRequiredError && (
            <Card data-testid="me-oauth-required-hint">
              <MessageBar intent="info">
                <MessageBarBody>
                  <MessageBarTitle>OAuth required</MessageBarTitle>
                  Issue a per-endpoint OAuth credential (Credentials tab on the picked endpoint)
                  and use the JWT it produces here. The shared admin secret cannot identify a SCIM
                  user, so /Me cannot resolve.
                </MessageBarBody>
              </MessageBar>
            </Card>
          )}
        </div>
      )}

      {pickedEp && me.data && (
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

            <Field label="Display name">
              <Input
                value={displayName}
                onChange={(_e, d) => setDisplayName(d.value)}
                data-testid="me-displayname-input"
              />
            </Field>

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
