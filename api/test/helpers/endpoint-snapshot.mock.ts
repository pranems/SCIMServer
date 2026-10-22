import { createHash } from 'node:crypto';
import type { Endpoint } from '../../src/generated/prisma/client';

export function endpointSnapshotFingerprint(endpoint: Endpoint): string {
  return createHash('sha256').update(JSON.stringify(endpoint)).digest('hex');
}

export function mockEndpointSnapshotQuery(read: (endpointId: string) => Promise<Endpoint | null>) {
  return jest.fn(async (
    _sql: TemplateStringsArray, endpointId: string, knownFingerprint: string | null,
  ) => {
    const value = await read(endpointId);
    if (!value) return [];
    const fingerprint = endpointSnapshotFingerprint(value);
    return [{
      fingerprint,
      endpoint: fingerprint === knownFingerprint ? null : {
        ...value,
        createdAt: value.createdAt.toISOString().replace(/Z$/, ''),
        updatedAt: value.updatedAt.toISOString().replace(/Z$/, ''),
      },
    }];
  });
}
