import React, { useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Combobox,
  Field,
  Option,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Checkmark16Regular } from '@fluentui/react-icons';
import { CopyableField, TruncatedText } from '../primitives';
import { endpointProfileLabel, matchesEndpoint, type EndpointInventoryIdentity } from './endpoint-inventory';

export type EndpointContextOption = EndpointInventoryIdentity;

export interface EndpointContextSelectorProps {
  endpoints: EndpointContextOption[];
  value: string;
  onChange: (endpointId: string) => void;
  label: string;
  purpose?: string;
  placeholder?: string;
  disabled?: boolean;
  allowInactive?: boolean;
  selectedRole?: 'primary' | 'secondary';
  'data-testid'?: string;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
    width: '100%',
  },
  option: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  optionMeta: {
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  selected: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minHeight: '24px',
    minWidth: 0,
    padding: '12px',
    border: `2px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  selectedIdentity: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    minWidth: 0,
    flexWrap: 'wrap',
  },
  purpose: {
    color: tokens.colorNeutralForeground3,
  },
});

export const EndpointOptionIdentity: React.FC<{ endpoint: EndpointContextOption }> = ({ endpoint }) => {
  const classes = useStyles();
  const displayName = endpoint.displayName ?? endpoint.name;
  return (
    <div className={classes.option}>
      <TruncatedText maxWidth="100%" text={displayName} />
      <TruncatedText className={classes.optionMeta} maxWidth="100%"
        text={`${endpoint.name} - ${endpoint.id} - ${endpoint.active ? 'Active' : 'Inactive'} - ${endpointProfileLabel(endpoint)}`} />
    </div>
  );
};

export const EndpointContextSelector: React.FC<EndpointContextSelectorProps> = ({
  endpoints,
  value,
  onChange,
  label,
  purpose,
  placeholder = 'Select an endpoint',
  disabled = false,
  allowInactive = false,
  selectedRole,
  'data-testid': testId = 'endpoint-context-selector',
}) => {
  const classes = useStyles();
  const selected = endpoints.find((endpoint) => endpoint.id === value);
  const [query, setQuery] = useState<string>();
  const [open, setOpen] = useState(false);
  const filtered = endpoints.filter(endpoint => matchesEndpoint(endpoint, query ?? ''));

  return (
    <div className={classes.root} data-testid={testId}>
      <Field label={label} required>
        <Combobox
          aria-label={label}
          placeholder={endpoints.length === 0 ? 'No endpoints available' : placeholder}
          value={query ?? (selected ? (selected.displayName ?? selected.name) : '')}
          open={open}
          onOpenChange={(_, data) => {
            setOpen(data.open);
            if (!data.open) setQuery(undefined);
          }}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setQuery('')}
          style={{ width: '100%', minWidth: 0 }}
          listbox={{ style: { maxHeight: '280px', overflowY: 'auto', maxWidth: 'calc(100vw - 32px)' } }}
          selectedOptions={value ? [value] : []}
          onOptionSelect={(_, data) => {
            if (data.optionValue) {
              onChange(data.optionValue);
              setQuery(undefined);
              setOpen(false);
            }
          }}
          disabled={disabled || endpoints.length === 0}
        >
          {filtered.map((endpoint) => {
            const displayName = endpoint.displayName ?? endpoint.name;
            return (
              <Option
                key={endpoint.id}
                value={endpoint.id}
                text={displayName}
                disabled={!allowInactive && !endpoint.active}
                data-testid={`${testId}-option-${endpoint.id}`}
              >
                <EndpointOptionIdentity endpoint={endpoint} />
              </Option>
            );
          })}
          {filtered.length === 0 && <Option disabled text="No matching endpoints">No matching endpoints</Option>}
        </Combobox>
      </Field>
      {purpose && <Caption1 className={classes.purpose}>{purpose}</Caption1>}
      {selected && (
        <div className={classes.selected} data-testid={selectedRole ? `${testId}-selected` : 'endpoint-context-selected'}>
          {selectedRole && (
            <Button appearance="transparent" size="small" icon={<Checkmark16Regular />} aria-pressed="true"
              aria-label={`Selected ${selectedRole} endpoint: ${selected.displayName ?? selected.name}`}
              onClick={() => onChange(selected.id)}>
              {selectedRole === 'primary' ? 'Primary selected' : 'Secondary selected'}
            </Button>
          )}
          <Badge appearance="tint" color={selected.active ? 'success' : 'danger'}>
            {selected.active ? 'Active' : 'Inactive'}
          </Badge>
          <div className={classes.selectedIdentity}>
            <CopyableField value={selected.displayName ?? selected.name} truncate maxWidth="100%" />
          </div>
          <CopyableField value={selected.id} monospace truncate maxWidth="100%" />
          <CopyableField value={selected.name} truncate maxWidth="100%" />
          <CopyableField value={endpointProfileLabel(selected)} truncate maxWidth="100%" />
        </div>
      )}
    </div>
  );
};
