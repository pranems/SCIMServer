import type { EgressPolicyFieldName, EffectiveEgressPolicyField } from '../api/queries';

export const EGRESS_FIELD_BY_SETTING: Readonly<Record<string, EgressPolicyFieldName | undefined>> = {
  JwksFetchTimeoutMs: 'timeoutMs',
  JwksFetchRetries: 'retries',
  JwksFetchRetryBackoffMs: 'retryBackoffMs',
  JwksCacheMaxAgeMs: 'cacheMaxAgeMs',
  JwksTotalDeadlineMs: 'totalDeadlineMs',
  JwksMaxResponseBytes: 'maxResponseBytes',
  JwksMaxKeys: 'maxKeys',
  JwksMaxCacheEntries: 'maxCacheEntries',
  JwksRefreshIntervalMs: 'refreshIntervalMs',
  JwksUnknownKidMinIntervalMs: 'unknownKidMinIntervalMs',
  JwksStaleIfErrorMs: 'staleIfErrorMs',
};

export const EGRESS_SOURCE_LABEL = {
  endpoint: 'Endpoint override',
  'server-env': 'Server environment',
  default: 'Built-in default',
} as const;

export function formatEgressValue(field: EffectiveEgressPolicyField): string {
  return `${field.effective} ${field.unit}`;
}
