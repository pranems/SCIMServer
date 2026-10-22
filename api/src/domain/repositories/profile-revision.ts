import { createHash } from 'node:crypto';
import { RepositoryError } from '../errors/repository-error';

export interface ProfileSnapshotRevision {
  readonly endpointId: string;
  readonly contentRevision: string;
  readonly snapshotRevision: string;
}

export type ProfileRevision = string | ProfileSnapshotRevision;
type SnapshotIdentity = Pick<ProfileSnapshotRevision, 'endpointId' | 'snapshotRevision'>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .filter(key => key !== '_schemaCaches')
        .sort()
        .map(key => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

/** Content revision for the persisted endpoint profile, independent of object-key order. */
export function endpointProfileRevision(profile: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(profile ?? null)))
    .digest('hex');
}

export function assertProfileRevision(
  profile: unknown,
  expectedRevision: ProfileRevision | undefined,
  snapshot?: SnapshotIdentity,
): void {
  if (expectedRevision === undefined) return;
  if (typeof expectedRevision === 'object' && snapshot?.snapshotRevision &&
      snapshot.endpointId === expectedRevision.endpointId &&
      snapshot.snapshotRevision === expectedRevision.snapshotRevision) return;
  assertProfileRevisionValue(endpointProfileRevision(profile), expectedRevision);
}

export function assertProfileRevisionValue(
  actualRevision: ProfileRevision | undefined,
  expectedRevision: ProfileRevision | undefined,
): void {
  const actual = typeof actualRevision === 'object' ? actualRevision.contentRevision : actualRevision;
  const expected = typeof expectedRevision === 'object' ? expectedRevision.contentRevision : expectedRevision;
  if (expected !== undefined && actual !== expected) {
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
