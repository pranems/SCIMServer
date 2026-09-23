import React from 'react';
import { CopyableJsonBlock, FormDialog } from '../components/primitives';
import { ProfileResourceForm } from './ProfileResourceForm';
import {
  buildCreatePayload,
  type EffectiveResourceShape,
} from './profile-resource-shape';

export interface CreateProfileResourceDialogProps {
  open: boolean;
  shape: EffectiveResourceShape;
  onCreate: (payload: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}

function exampleValues(shape: EffectiveResourceShape): Record<string, unknown> {
  return Object.fromEntries(shape.fields.map((field) => [field.id, field.example]));
}

export const CreateProfileResourceDialog: React.FC<CreateProfileResourceDialogProps> = ({
  open,
  shape,
  onCreate,
  onClose,
}) => {
  const [values, setValues] = React.useState<Record<string, unknown>>(() => exampleValues(shape));
  const [valid, setValid] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (!open) return;
    setValues(exampleValues(shape));
    setValid(true);
    setBusy(false);
    setError(null);
  }, [open, shape]);

  const payload = buildCreatePayload(shape, values);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(payload);
      onClose();
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onCancel={onClose}
      onSubmit={() => void submit()}
      title={`Create ${shape.resourceType.name}`}
      submitLabel={`Create ${shape.resourceType.name}`}
      busy={busy}
      error={error}
      disabled={!valid}
      data-testid="create-resource-dialog"
    >
      <ProfileResourceForm
        shape={shape}
        values={values}
        onChange={(fieldId, value) => setValues((current) => ({
          ...current,
          [fieldId]: value,
        }))}
        onValidityChange={setValid}
        disabled={busy}
        data-testid="create-resource-form"
      />
      <CopyableJsonBlock
        value={payload}
        label="Request body"
        maxHeight="220px"
        data-testid="create-resource-preview"
      />
    </FormDialog>
  );
};