import type { EndpointResponse } from '@scim/types/dashboard.types';

export type EndpointInventoryIdentity = Pick<EndpointResponse, 'id' | 'name' | 'displayName' | 'active' | 'profileSummary'>;

export function endpointProfileLabel(endpoint: EndpointInventoryIdentity): string {
  const names = endpoint.profileSummary?.schemas.map(schema => schema.name) ?? [];
  return names.length > 0 ? names.join(', ') : 'No profile summary';
}

export function matchesEndpoint(endpoint: EndpointInventoryIdentity, query: string): boolean {
  const values = [
    endpoint.id, endpoint.name, endpoint.displayName ?? '',
    endpoint.active ? 'Active' : 'Inactive', endpointProfileLabel(endpoint),
    ...(endpoint.profileSummary?.resourceTypes.map(type => type.name) ?? []),
  ];
  return values.some(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
}
