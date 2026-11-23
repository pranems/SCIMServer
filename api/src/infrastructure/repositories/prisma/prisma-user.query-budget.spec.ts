import { PrismaService } from '../../../modules/prisma/prisma.service';
import { PrismaUserRepository } from './prisma-user.repository';
import type { UniquenessPolicy } from '../../../domain/repositories/uniqueness-policy';
import type { PoolConfig } from 'pg';

const mockStatements: string[] = [];
let mockPoolOptions: PoolConfig;
const endpointId = '00000000-0000-4000-a000-000000000001';
const scimId = '00000000-0000-4000-a000-000000000002';
const snapshotRevision = '00000000-0000-4000-a000-000000000003';
const resourceId = '00000000-0000-4000-a000-000000000004';

jest.mock('pg', () => {
  const actual = jest.requireActual<typeof import('pg')>('pg');
  class OfflinePool {
    constructor(options: PoolConfig) { mockPoolOptions = options; }
    on() { return this; }
    removeListener() { return this; }
    release() { return undefined; }
    async end() { return undefined; }
    async connect() { return this; }
    async query(query: { text: string }) {
      const sql = query.text;
      mockStatements.push(sql);
      if (sql.includes('AS resources')) {
        return {
          fields: [
            { name: 'snapshotRevision', dataTypeID: 25 },
            { name: 'profile', dataTypeID: 3802 },
            { name: 'resources', dataTypeID: 3802 },
          ],
          rows: [[snapshotRevision, 'null', '[]']],
          rowCount: 1,
        };
      }
      if (/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION)/.test(sql) ||
          sql.includes('pg_advisory_xact_lock')) {
        return { fields: [], rows: [], rowCount: 0 };
      }
      const values: Record<string, { oid: number; value: unknown }> = {
        id: { oid: 2950, value: resourceId },
        endpointId: { oid: 2950, value: endpointId },
        resourceType: { oid: 25, value: 'User' },
        scimId: { oid: 2950, value: scimId },
        externalId: { oid: 25, value: null },
        userName: { oid: 25, value: 'budget@example.test' },
        displayName: { oid: 25, value: null },
        active: { oid: 16, value: true },
        payload: { oid: 3802, value: '{}' },
        version: { oid: 23, value: 1 },
        meta: { oid: 25, value: '{}' },
        createdAt: { oid: 1184, value: '2026-11-23T12:00:00.000Z' },
        updatedAt: { oid: 1184, value: '2026-11-23T12:00:00.000Z' },
      };
      const selection: string | undefined = sql.startsWith('INSERT')
        ? sql.split('RETURNING ')[1]
        : sql.split(' FROM ')[0];
      if (!selection) throw new Error(`Missing offline SQL selection: ${sql}`);
      const columns = [...selection.matchAll(/\."(\w+)"/g)]
        .map(match => match[1]).filter(name => name in values);
      if (columns.length === 0) throw new Error(`Unexpected offline SQL shape: ${sql}`);
      const conflictRead = sql.includes('"userName" =');
      return {
        fields: columns.map(name => ({ name, dataTypeID: values[name].oid })),
        rows: conflictRead ? [] : [columns.map(name =>
          sql.includes('"public"."Endpoint"') && name === 'id' ? endpointId : values[name].value)],
        rowCount: conflictRead ? 0 : 1,
      };
    }
  }
  return { __esModule: true, default: { ...actual, Pool: OfflinePool } };
});

const policy: UniquenessPolicy = [{
  schemaUrn: null,
  path: [{ name: 'userName', multiValued: false }],
  type: 'string',
  caseExact: false,
}];

describe('POST User offline SQL budget boundary (real Prisma client and adapter)', () => {
  let prisma: PrismaService;

  beforeEach(() => {
    mockStatements.length = 0;
    prisma = new PrismaService();
  });

  afterEach(async () => {
    await prisma.onApplicationShutdown();
  });

  async function createUser() {
    const repository = new PrismaUserRepository(prisma);
    return repository.create({
      endpointId, scimId, externalId: null, userName: 'budget@example.test',
      displayName: null, active: true, rawPayload: '{}', meta: '{}',
    }, policy, { endpointId, snapshotRevision, contentRevision: 'unused-matching-token' });
  }

  it('retains explicit isolation, ordered locks and a separate post-wait snapshot', async () => {
    const created = await createUser();
    expect(created).toMatchObject({ id: resourceId, endpointId, scimId, userName: 'budget@example.test' });
    expect(mockPoolOptions.options).toMatch(/-c default_transaction_isolation=read\\ committed$/);
    expect(mockStatements.some(sql => sql.startsWith('SET TRANSACTION'))).toBe(false);
    const locks = mockStatements.findIndex(sql => sql.includes('WITH profile_lock AS MATERIALIZED'));
    const snapshot = mockStatements.findIndex(sql => sql.includes('AS resources'));
    const insert = mockStatements.findIndex(sql => sql.startsWith('INSERT'));
    expect(locks).toBeGreaterThan(-1);
    expect(snapshot).toBeGreaterThan(locks);
    expect(insert).toBeGreaterThan(snapshot);
    expect(mockStatements[locks]).not.toContain('AS resources');
    expect(mockStatements[snapshot]).not.toContain('pg_advisory_xact_lock');
    expect(mockStatements.at(-1)).toBe('COMMIT');
  });

  it('fits the unchanged four-call request budget, including the endpoint auth/profile read', async () => {
    await createUser();
    const counted = mockStatements.filter(sql => !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql));
    // The request owner independently observes one authentication/profile read.
    // This offline seam does not claim PostgreSQL statistics or HTTP evidence.
    expect(counted.length + 1).toBeLessThanOrEqual(4);
  });

  it('returns the full inserted row without nested relation and readback queries', async () => {
    const created = await createUser();
    expect(created).toMatchObject({ id: resourceId, endpointId, scimId });
    const counted = mockStatements.filter(sql => !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql));
    expect(counted).toHaveLength(3);
    expect(counted[0]).toContain('WITH profile_lock AS MATERIALIZED');
    expect(counted[1]).toContain('AS resources');
    expect(counted[2]).toMatch(/^INSERT .*RETURNING/);
    expect(counted.length + 1).toBeLessThanOrEqual(4);
  });
});
