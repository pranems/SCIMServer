import React from 'react';
import { makeStyles } from '@fluentui/react-components';
import { EditableField } from '../components/primitives';
import { ProfileResourceForm } from './ProfileResourceForm';
import {
  updateResourceField,
  valuesForResource,
  type EffectiveResourceShape,
} from './profile-resource-shape';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minWidth: 0,
  },
});

export interface ProfileResourceBodyEditorProps {
  shape: EffectiveResourceShape;
  body: Record<string, unknown>;
  onChange: (body: Record<string, unknown>) => void;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
  'data-testid'?: string;
}

function parseBody(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export const ProfileResourceBodyEditor: React.FC<ProfileResourceBodyEditorProps> = ({
  shape,
  body,
  onChange,
  onValidityChange,
  disabled = false,
  'data-testid': testId = 'profile-resource-editor',
}) => {
  const classes = useStyles();
  const [draft, setDraft] = React.useState(() => JSON.stringify(body, null, 2));
  const [bodyValid, setBodyValid] = React.useState(true);
  const [formValid, setFormValid] = React.useState(true);
  const values = React.useMemo(() => valuesForResource(shape, body), [body, shape]);
  const valid = bodyValid && formValid;

  React.useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  React.useEffect(() => {
    if (!bodyValid) return;
    const parsedDraft = parseBody(draft);
    if (JSON.stringify(parsedDraft) !== JSON.stringify(body)) {
      setDraft(JSON.stringify(body, null, 2));
    }
  }, [body, bodyValid, draft]);

  return (
    <div className={classes.root} data-testid={testId}>
      <ProfileResourceForm
        shape={shape}
        values={values}
        onChange={(fieldId, value) => onChange(updateResourceField(shape, body, fieldId, value))}
        onValidityChange={setFormValid}
        disabled={disabled}
        data-testid={`${testId}-form`}
      />
      <EditableField
        label="Request body"
        value={draft}
        onChange={(next) => {
          setDraft(next);
          const parsed = parseBody(next);
          setBodyValid(parsed !== undefined);
          if (parsed) onChange(parsed);
        }}
        multiline
        rows={10}
        monospace
        disabled={disabled}
        validationMessage={bodyValid ? undefined : 'Enter a valid JSON object.'}
        data-testid={`${testId}-body`}
      />
    </div>
  );
};