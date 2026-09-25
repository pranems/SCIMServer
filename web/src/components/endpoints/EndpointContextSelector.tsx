import React from 'react';
import {
  Badge,
  Caption1,
  Combobox,
  Field,
  Option,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';

export interface EndpointContextOption {
  id: string;
  name: string;
  displayName?: string;
  active: boolean;
}

export interface EndpointContextSelectorProps {
  endpoints: EndpointContextOption[];
  value: string;
  onChange: (endpointId: string) => void;
  label: string;
  purpose?: string;
  placeholder?: string;
  disabled?: boolean;
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
    alignItems: 'center',
    gap: '8px',
    minHeight: '24px',
    minWidth: 0,
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
      <Text weight="semibold">{displayName}</Text>
      <span className={classes.optionMeta}>
        {endpoint.name} - {endpoint.active ? 'Active' : 'Inactive'}
      </span>
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
  'data-testid': testId = 'endpoint-context-selector',
}) => {
  const classes = useStyles();
  const selected = endpoints.find((endpoint) => endpoint.id === value);

  return (
    <div className={classes.root} data-testid={testId}>
      <Field label={label} required>
        <Combobox
          aria-label={label}
          placeholder={endpoints.length === 0 ? 'No endpoints available' : placeholder}
          value={selected ? (selected.displayName ?? selected.name) : ''}
          selectedOptions={value ? [value] : []}
          onOptionSelect={(_, data) => {
            if (data.optionValue) onChange(data.optionValue);
          }}
          disabled={disabled || endpoints.length === 0}
        >
          {endpoints.map((endpoint) => {
            const displayName = endpoint.displayName ?? endpoint.name;
            return (
              <Option
                key={endpoint.id}
                value={endpoint.id}
                text={displayName}
                disabled={!endpoint.active}
                data-testid={`${testId}-option-${endpoint.id}`}
              >
                <EndpointOptionIdentity endpoint={endpoint} />
              </Option>
            );
          })}
        </Combobox>
      </Field>
      {purpose && <Caption1 className={classes.purpose}>{purpose}</Caption1>}
      {selected && (
        <div className={classes.selected} data-testid="endpoint-context-selected">
          <Badge appearance="tint" color={selected.active ? 'success' : 'danger'}>
            {selected.active ? 'Active' : 'Inactive'}
          </Badge>
          <div className={classes.selectedIdentity}>
            <Text weight="semibold">{selected.displayName ?? selected.name}</Text>
            <Caption1 className={classes.optionMeta}>{selected.name}</Caption1>
          </div>
        </div>
      )}
    </div>
  );
};
