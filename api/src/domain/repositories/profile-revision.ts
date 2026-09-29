import { createHash } from 'node:crypto';
import { RepositoryError } from '../errors/repository-error';

export type ProfileRevision = string;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Content revision for the persisted endpoint profile, independent of object-key order. */
export function endpointProfileRevision(profile: unknown): ProfileRevision {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(profile ?? null)))
    .digest('hex');
}

export function assertProfileRevision(
  profile: unknown,
  expectedRevision: ProfileRevision | undefined,
): void {
  assertProfileRevisionValue(endpointProfileRevision(profile), expectedRevision);
}

export function assertProfileRevisionValue(
  actualRevision: ProfileRevision | undefined,
  expectedRevision: ProfileRevision | undefined,
): void {
  if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
    throw new RepositoryError(
      'PROFILE_CHANGED',
      'Endpoint profile changed while the resource write was in progress.',
    );
  }
}

export function profileRevisionArgument(
  revision: ProfileRevision | undefined,
): [] | [ProfileRevision] {
  return revision === undefined ? [] : [revision];
}
