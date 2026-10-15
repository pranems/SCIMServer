import type { EndpointResourceCounts } from '../../../domain/repositories/endpoint-resource-counts';

interface ResourceCountRow {
  endpointId: string;
  active: boolean;
  _count: { _all: number };
}

export function collectEndpointResourceCounts(rows: ResourceCountRow[]): EndpointResourceCounts[] {
  const counts = new Map<string, EndpointResourceCounts>();
  for (const row of rows) {
    const current = counts.get(row.endpointId) ?? {
      endpointId: row.endpointId,
      total: 0,
      active: 0,
    };
    current.total += row._count._all;
    if (row.active) {
      current.active += row._count._all;
    }
    counts.set(row.endpointId, current);
  }
  return [...counts.values()];
}
