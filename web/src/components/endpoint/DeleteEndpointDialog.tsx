/**
 * DeleteEndpointDialog (Phase L1) - type-name-to-confirm safety modal.
 *
 * The DELETE side-effect on `/scim/admin/endpoints/:id` cascades to
 * every user, group, group member, credential, and request log under
 * that endpoint. Mistakenly clicking a one-step button would be the
 * largest data-loss footgun in the redesigned UI, so L1 follows the
 * GitHub-repo-delete UX pattern: the operator must type the exact
 * endpoint name into a free-text Input before the Delete button
 * enables.
 *
 * Match is case-sensitive on purpose - one character drift aborts.
 *
 * Composes:
 *   - <FormDialog /> (Phase C2 primitive) for the modal chrome,
 *     submit/cancel buttons, busy state, and structured error
 *     forwarding (FormDialog.error renders <ScimErrorMessage />)
 *   - useDeleteEndpoint() (Phase L1 hook in api/queries.ts)
 *
 * @see docs/PHASE_L1_ENDPOINT_CRUD.md S2.2
 */
import React, { useState } from 'react';
import {
  Input,
  Field,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { FormDialog } from '../primitives/FormDialog';
import { useDeleteEndpoint } from '../../api/queries';

const useStyles = makeStyles({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  echo: {
    fontFamily: tokens.fontFamilyMonospace,
    backgroundColor: tokens.colorNeutralBackground3,
    padding: '6px 10px',
    borderRadius: tokens.borderRadiusSmall,
    alignSelf: 'flex-start',
  },
});

export interface DeleteEndpointDialogProps {
  /** Whether the dialog is open. Controlled externally. */
  open: boolean;
  /** Endpoint id sent to DELETE /admin/endpoints/:id. */
  endpointId: string;
  /** Endpoint display name shown in the warning + matched against user input. */
  endpointName: string;
  /** Called when the user cancels (X / Cancel / backdrop / ESC). */
  onCancel: () => void;
  /** Called after the DELETE mutation resolves successfully. Caller is
   * responsible for navigating away from the deleted endpoint. */
  onConfirmed: () => void;
}

export const DeleteEndpointDialog: React.FC<DeleteEndpointDialogProps> = ({
  open,
  endpointId,
  endpointName,
  onCancel,
  onConfirmed,
}) => {
  const classes = useStyles();
  const [confirmText, setConfirmText] = useState('');
  const [submitError, setSubmitError] = useState<unknown>(null);
  const deleteMutation = useDeleteEndpoint();

  // Case-sensitive equality - mirrors GitHub repo-delete UX. One
  // character drift means the operator was not paying attention; the
  // Delete button stays disabled.
  const matchesName = confirmText === endpointName;

  const handleSubmit = async (): Promise<void> => {
    if (!matchesName) return;
    setSubmitError(null);
    try {
      await deleteMutation.mutateAsync(endpointId);
      // Reset before the parent unmounts the dialog so a future open
      // does not show the previously-typed name.
      setConfirmText('');
      onConfirmed();
    } catch (err) {
      setSubmitError(err);
    }
  };

  const handleCancel = (): void => {
    if (deleteMutation.isPending) return;
    setConfirmText('');
    setSubmitError(null);
    onCancel();
  };

  return (
    <FormDialog
      open={open}
      onCancel={handleCancel}
      onSubmit={() => {
        void handleSubmit();
      }}
      title={`Delete endpoint "${endpointName}"`}
      submitLabel="Delete"
      cancelLabel="Cancel"
      busy={deleteMutation.isPending}
      disabled={!matchesName}
      error={submitError}
      data-testid="delete-endpoint-dialog"
    >
      <div className={classes.body}>
        <MessageBar intent="warning" data-testid="delete-endpoint-warning">
          <MessageBarBody>
            <MessageBarTitle>This action cannot be undone</MessageBarTitle>
            Deleting this endpoint cascades to every SCIM user, group,
            group member, credential, and request log under it.
          </MessageBarBody>
        </MessageBar>

        <Text>To confirm, type the endpoint name exactly as shown:</Text>
        <Text className={classes.echo} data-testid="delete-endpoint-name-echo">
          {endpointName}
        </Text>

        <Field label="Endpoint name">
          <Input
            value={confirmText}
            onChange={(_e, d) => setConfirmText(d.value)}
            placeholder={endpointName}
            data-testid="delete-endpoint-confirm-input"
            // No autoFocus on FormDialog open; the Cancel button gets
            // focus first per Fluent default so an accidental Enter
            // does not submit.
          />
        </Field>
      </div>
    </FormDialog>
  );
};
