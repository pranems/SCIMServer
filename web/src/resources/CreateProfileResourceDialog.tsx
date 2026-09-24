import React from 'react';
import { FormDialog } from '../components/primitives';
import { ProfileResourceBodyEditor } from './ProfileResourceBodyEditor';
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
  const [payload, setPayload] = React.useState<Record<string, unknown>>(() =>
    buildCreatePayload(shape, exampleValues(shape)));
  const [valid, setValid] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (!open) return;
    setPayload(buildCreatePayload(shape, exampleValues(shape)));
    setValid(true);
    setBusy(false);
    setError(null);
  }, [open, shape]);

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
      <ProfileResourceBodyEditor
        key={`${shape.resourceType.id}-${open}`}
        shape={shape}
        body={payload}
        onChange={setPayload}
        onValidityChange={setValid}
        disabled={busy}
        data-testid="create-resource"
      />
    </FormDialog>
  );
};