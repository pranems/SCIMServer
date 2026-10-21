import React from 'react';
import { Dropdown, Option } from '@fluentui/react-components';
import { EditableField } from '../components/primitives/EditableField';

const PRESETS = [
  [60, '1 minute'],
  [300, '5 minutes'],
  [900, '15 minutes'],
  [1800, '30 minutes'],
  [3600, '1 hour (default)'],
  [7200, '2 hours'],
  [21600, '6 hours'],
  [43200, '12 hours'],
  [86400, '1 day'],
  [259200, '3 days'],
  [604800, '1 week'],
] as const;

export function tokenLifetimeError(raw: string): string | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 60 && value <= 604800
    ? undefined
    : 'Enter a whole number of seconds between 60 and 604800.';
}

interface TokenLifetimeFieldProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  onCommit?: (value: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  'data-testid': string;
}

export const TokenLifetimeField: React.FC<TokenLifetimeFieldProps> = ({
  label, value, onChange, onCommit, disabled, placeholder = 'server default: 3600',
  'data-testid': testId,
}) => {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const preset = PRESETS.find(([seconds]) => String(seconds) === draft);
  const change = (next: string) => {
    setDraft(next);
    onChange?.(next);
  };
  return (
    <div onBlur={(event) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      const raw = draft.trim();
      if (!tokenLifetimeError(raw) && raw !== value) onCommit?.(raw === '' ? null : Number(raw));
    }}>
      <EditableField
        label={label}
        value={draft}
        onChange={change}
        disabled={disabled}
        placeholder={placeholder}
        validationMessage={tokenLifetimeError(draft)}
        data-testid={testId}
        renderControls={(edit) => (
          <Dropdown
            aria-label={`${label} common values`}
            value={preset ? `${preset[1]} (${preset[0]} seconds)` : draft ? 'Custom lifetime' : 'Choose a common lifetime'}
            selectedOptions={preset ? [String(preset[0])] : []}
            disabled={disabled}
            inlinePopup
            onOptionSelect={(_, data) => {
              if (data.optionValue && data.optionValue !== draft) edit(data.optionValue);
            }}
            data-testid={`${testId}-presets`}
          >
            {PRESETS.map(([seconds, text]) => (
              <Option key={seconds} value={String(seconds)}>{`${text} (${seconds} seconds)`}</Option>
            ))}
          </Dropdown>
        )}
      />
    </div>
  );
};
