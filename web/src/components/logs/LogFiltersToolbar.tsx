import React from 'react';
import {
  Badge,
  Button,
  Combobox,
  Field,
  Input,
  Option,
  SearchBox,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowReset24Regular } from '@fluentui/react-icons';
import { toggleChipProps } from '../../utils/interactive';
import {
  TIME_RANGE_VALUES,
  type TimeRange,
} from '../../routes/search-schemas';
import { EndpointOptionIdentity } from '../endpoints/EndpointContextSelector';

export const LOG_METHOD_VALUES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const LOG_STATUS_VALUES = [200, 201, 204, 400, 401, 403, 404, 409, 412, 429, 500] as const;

const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  '1h': 'Last 1 hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Custom',
};

const useStyles = makeStyles({
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'flex-end',
    padding: '12px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  item: { minWidth: '170px' },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  chip: { cursor: 'pointer' },
});

export interface LogFilterValues {
  urlContains?: string;
  endpointId?: string;
  method?: (typeof LOG_METHOD_VALUES)[number];
  status?: number;
  timeRange?: TimeRange;
  hasError?: boolean;
  minDurationMs?: number;
  requestId?: string;
}

export interface LogEndpointOption {
  id: string;
  name: string;
  displayName?: string;
  active: boolean;
}

export function timeRangeToSince(range: TimeRange | undefined): string | undefined {
  if (!range || range === 'custom') return undefined;
  const duration = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }[range];
  return new Date(Date.now() - duration).toISOString();
}

export const LogFiltersToolbar: React.FC<{
  values: LogFilterValues;
  onChange: (patch: Partial<LogFilterValues>) => void;
  onReset: () => void;
  endpoints?: LogEndpointOption[];
  legacyTestIds?: {
    url?: string;
    endpoint?: string;
    status?: string;
    time?: string;
  };
  'data-testid'?: string;
}> = ({ values, onChange, onReset, endpoints, legacyTestIds, 'data-testid': testId = 'log-filters' }) => {
  const classes = useStyles();
  const hasFilters = [
    values.urlContains,
    values.endpointId,
    values.method,
    values.status,
    values.timeRange,
    values.hasError,
    values.minDurationMs,
    values.requestId,
  ].some((value) => value !== undefined && value !== '');
  const endpoint = endpoints?.find((candidate) => candidate.id === values.endpointId);

  return (
    <div className={classes.toolbar} data-testid={testId}>
      <Field label="URL contains" className={classes.item}>
        <SearchBox
          placeholder="Path or ResourceType..."
          value={values.urlContains ?? ''}
          onChange={(_, data) => onChange({ urlContains: data.value || undefined })}
          data-testid={legacyTestIds?.url ?? `${testId}-url`}
        />
      </Field>

      {endpoints && (
        <Field label="Endpoint" className={classes.item}>
          <Combobox
            placeholder="All endpoints"
            value={endpoint?.displayName ?? endpoint?.name ?? values.endpointId ?? ''}
            selectedOptions={values.endpointId ? [values.endpointId] : []}
            onOptionSelect={(_, data) => onChange({ endpointId: data.optionValue || undefined })}
            clearable
            data-testid={legacyTestIds?.endpoint ?? `${testId}-endpoint`}
          >
            {endpoints.map((option) => (
              <Option key={option.id} value={option.id} text={option.displayName ?? option.name}>
                <EndpointOptionIdentity endpoint={option} />
              </Option>
            ))}
          </Combobox>
        </Field>
      )}

      <Field label="Method" className={classes.item}>
        <Combobox
          placeholder="All methods"
          value={values.method ?? ''}
          selectedOptions={values.method ? [values.method] : []}
          onOptionSelect={(_, data) => {
            const method = LOG_METHOD_VALUES.find((candidate) => candidate === data.optionValue);
            onChange({ method });
          }}
          clearable
          data-testid={`${testId}-method`}
        >
          {LOG_METHOD_VALUES.map((method) => <Option key={method} value={method}>{method}</Option>)}
        </Combobox>
      </Field>

      <Field label="Status" className={classes.item}>
        <div className={classes.chipRow} data-testid={legacyTestIds?.status ?? `${testId}-status`}>
          {LOG_STATUS_VALUES.map((status) => (
            <Badge
              key={status}
              appearance={values.status === status ? 'filled' : 'outline'}
              color={status >= 500 ? 'danger' : status >= 400 ? 'warning' : 'success'}
              className={classes.chip}
              {...toggleChipProps(() => onChange({ status: values.status === status ? undefined : status }), values.status === status)}
            >
              {status}
            </Badge>
          ))}
        </div>
      </Field>

      <Field label="Time range" className={classes.item}>
        <div className={classes.chipRow} data-testid={legacyTestIds?.time ?? `${testId}-time`}>
          {TIME_RANGE_VALUES.filter((value) => value !== 'custom').map((range) => (
            <Badge
              key={range}
              appearance={values.timeRange === range ? 'filled' : 'outline'}
              color="brand"
              className={classes.chip}
              {...toggleChipProps(() => onChange({ timeRange: values.timeRange === range ? undefined : range }), values.timeRange === range)}
            >
              {TIME_RANGE_LABEL[range]}
            </Badge>
          ))}
        </div>
      </Field>

      <Field label="Minimum duration (ms)" className={classes.item}>
        <Input
          type="number"
          min={0}
          value={values.minDurationMs === undefined ? '' : String(values.minDurationMs)}
          onChange={(_, data) => onChange({ minDurationMs: data.value === '' ? undefined : Number(data.value) })}
          data-testid={`${testId}-duration`}
        />
      </Field>

      <Field label="Request ID" className={classes.item}>
        <SearchBox
          placeholder="Correlation UUID..."
          value={values.requestId ?? ''}
          onChange={(_, data) => onChange({ requestId: data.value || undefined })}
          data-testid={`${testId}-request-id`}
        />
      </Field>

      <Badge
        appearance={values.hasError ? 'filled' : 'outline'}
        color="danger"
        className={classes.chip}
        {...toggleChipProps(() => onChange({ hasError: values.hasError ? undefined : true }), values.hasError === true)}
        data-testid={`${testId}-errors`}
      >
        Errors only
      </Badge>

      {hasFilters && (
        <Button appearance="subtle" icon={<ArrowReset24Regular />} onClick={onReset} data-testid={`${testId}-reset`}>
          Reset filters
        </Button>
      )}
    </div>
  );
};
