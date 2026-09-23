import React from 'react';
import {
  Dropdown,
  Field,
  Option,
  Switch,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { EditableField } from '../components/primitives';
import type {
  EffectiveResourceShape,
  ResourceFieldDescriptor,
} from './profile-resource-shape';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minWidth: 0,
  },
  extension: {
    borderLeft: `3px solid ${tokens.colorNeutralStroke1}`,
    paddingLeft: '12px',
  },
  dropdown: {
    width: '100%',
  },
});

export interface ProfileResourceFormProps {
  shape: EffectiveResourceShape;
  values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
  'data-testid'?: string;
}

interface FieldEditorProps {
  field: ResourceFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  onJsonValidityChange: (valid: boolean) => void;
  disabled: boolean;
  testId: string;
}

function displayValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

const FieldEditor: React.FC<FieldEditorProps> = ({
  field,
  value,
  onChange,
  onJsonValidityChange,
  disabled,
  testId,
}) => {
  const classes = useStyles();
  const [jsonDraft, setJsonDraft] = React.useState(() =>
    JSON.stringify(value ?? field.example, null, 2));
  const [jsonError, setJsonError] = React.useState(false);

  React.useEffect(() => {
    if (field.inputKind !== 'json') return;
    const next = JSON.stringify(value ?? field.example, null, 2);
    try {
      const current = JSON.parse(jsonDraft) as unknown;
      if (JSON.stringify(current) !== JSON.stringify(value ?? field.example)) {
        setJsonDraft(next);
      }
    } catch {
      // Preserve an invalid draft until the operator fixes or resets it.
    }
  }, [field.example, field.inputKind, jsonDraft, value]);

  const requiredMessage = field.required && !hasValue(value)
    ? 'This attribute is required.'
    : undefined;

  if (field.inputKind === 'boolean') {
    return (
      <Switch
        label={field.label}
        checked={value === true}
        onChange={(_, data) => onChange(data.checked)}
        disabled={disabled}
        data-testid={testId}
      />
    );
  }

  if (field.inputKind === 'select') {
    const selected = displayValue(value);
    return (
      <Field label={field.label} required={field.required} hint={field.description}>
        <Dropdown
          className={classes.dropdown}
          value={selected}
          selectedOptions={selected ? [selected] : []}
          onOptionSelect={(_, data) => onChange(data.optionValue ?? '')}
          disabled={disabled}
          data-testid={testId}
        >
          {field.canonicalValues.map((option) => (
            <Option key={option} value={option}>{option}</Option>
          ))}
        </Dropdown>
      </Field>
    );
  }

  if (field.inputKind === 'json') {
    return (
      <EditableField
        label={field.label}
        value={jsonDraft}
        onChange={(next) => {
          setJsonDraft(next);
          try {
            const parsed = JSON.parse(next) as unknown;
            setJsonError(false);
            onJsonValidityChange(true);
            onChange(parsed);
          } catch {
            setJsonError(true);
            onJsonValidityChange(false);
          }
        }}
        multiline
        rows={5}
        monospace
        disabled={disabled}
        validationMessage={jsonError ? 'Enter valid JSON.' : requiredMessage}
        data-testid={testId}
      />
    );
  }

  return (
    <EditableField
      label={field.label}
      value={displayValue(value)}
      onChange={(next) => {
        if (field.inputKind === 'number') {
          onChange(next === '' ? undefined : Number(next));
          return;
        }
        onChange(next);
      }}
      disabled={disabled}
      placeholder={displayValue(field.example)}
      inputType={field.inputKind === 'number' ? 'number' : 'text'}
      validationMessage={requiredMessage}
      data-testid={testId}
    />
  );
};

export const ProfileResourceForm: React.FC<ProfileResourceFormProps> = ({
  shape,
  values,
  onChange,
  onValidityChange,
  disabled = false,
  'data-testid': testId = 'profile-resource-form',
}) => {
  const classes = useStyles();
  const [jsonValidity, setJsonValidity] = React.useState<Record<string, boolean>>({});
  const requiredValid = shape.fields.every((field) => !field.required || hasValue(values[field.id]));
  const valid = requiredValid && Object.values(jsonValidity).every(Boolean);

  React.useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  return (
    <div className={classes.root} data-testid={testId}>
      {shape.fields.map((field) => (
        <div key={field.id} className={field.extension ? classes.extension : undefined}>
          <FieldEditor
            field={field}
            value={values[field.id]}
            onChange={(value) => onChange(field.id, value)}
            onJsonValidityChange={(fieldValid) => setJsonValidity((current) => ({
              ...current,
              [field.id]: fieldValid,
            }))}
            disabled={disabled}
            testId={`${testId}-${field.name}`}
          />
        </div>
      ))}
    </div>
  );
};