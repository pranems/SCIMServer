/**
 * EditEndpointPage (Phase L1) - simple form for editing the
 * mutable scalar fields on an endpoint: displayName, description,
 * active. The profile / preset is locked at creation; per-flag
 * overrides happen in the SettingsTab.
 *
 * Save fires `useUpdateEndpointConfig` (already shipped) with a
 * shallow PATCH body. On success navigates back to the endpoint
 * detail.
 */
import React, { useState, useEffect } from 'react';
import {
  makeStyles,
  Button,
  Input,
  Field,
  Switch,
  Subtitle1,
} from '@fluentui/react-components';
import { useNavigate } from '@tanstack/react-router';
import { useEndpoint, useUpdateEndpointConfig } from '../api/queries';
import { LoadingSkeleton } from '../components/primitives';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '720px',
    margin: '0 auto',
    padding: '24px',
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  },
});

export interface EditEndpointPageProps {
  endpointId: string;
}

export const EditEndpointPage: React.FC<EditEndpointPageProps> = ({ endpointId }) => {
  const classes = useStyles();
  const navigate = useNavigate();
  const { data: endpoint, isLoading, error } = useEndpoint(endpointId);
  const updateMutation = useUpdateEndpointConfig(endpointId);

  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [submitError, setSubmitError] = useState<unknown>(null);

  useEffect(() => {
    if (endpoint) {
      setDisplayName(endpoint.displayName ?? '');
      setDescription((endpoint as { description?: string }).description ?? '');
      setActive(endpoint.active);
    }
  }, [endpoint]);

  if (isLoading) {
    return (
      <div className={classes.page} data-testid="edit-endpoint-loading">
        <LoadingSkeleton count={4} height="40px" />
      </div>
    );
  }
  if (error || !endpoint) {
    return (
      <div className={classes.page} data-testid="edit-endpoint-error">
        <ScimErrorMessage error={error ?? new Error('Endpoint not found')} />
      </div>
    );
  }

  const handleSave = async (): Promise<void> => {
    setSubmitError(null);
    const body: Record<string, unknown> = {};
    if (displayName !== (endpoint.displayName ?? '')) body.displayName = displayName;
    if (description !== ((endpoint as { description?: string }).description ?? '')) {
      body.description = description;
    }
    if (active !== endpoint.active) body.active = active;
    if (Object.keys(body).length === 0) {
      // No-op save - just go back.
      void navigate({ to: '/endpoints/$endpointId', params: { endpointId } });
      return;
    }
    try {
      await updateMutation.mutateAsync(body);
      void navigate({ to: '/endpoints/$endpointId', params: { endpointId } });
    } catch (err) {
      setSubmitError(err);
    }
  };

  return (
    <div className={classes.page} data-testid="edit-endpoint-page">
      <Subtitle1>Edit endpoint: {endpoint.name}</Subtitle1>

      <Field label="Display name">
        <Input
          value={displayName}
          onChange={(_e, d) => setDisplayName(d.value)}
          data-testid="edit-endpoint-displayname-input"
        />
      </Field>

      <Field label="Description">
        <Input
          value={description}
          onChange={(_e, d) => setDescription(d.value)}
          data-testid="edit-endpoint-description-input"
        />
      </Field>

      <Field label="Active">
        <Switch
          checked={active}
          onChange={(_e, d) => setActive(d.checked)}
          data-testid="edit-endpoint-active-switch"
        />
      </Field>

      <ScimErrorMessage error={submitError} />

      <div className={classes.buttonRow}>
        <Button
          appearance="subtle"
          onClick={() => void navigate({ to: '/endpoints/$endpointId', params: { endpointId } })}
          disabled={updateMutation.isPending}
          data-testid="edit-endpoint-cancel-button"
        >
          Cancel
        </Button>
        <Button
          appearance="primary"
          onClick={() => void handleSave()}
          disabled={updateMutation.isPending}
          data-testid="edit-endpoint-save-button"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
};
