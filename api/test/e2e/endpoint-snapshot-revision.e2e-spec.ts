import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimGet, scimPost } from './helpers/request.helper';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { EndpointService } from '../../src/modules/endpoint/services/endpoint.service';
import { assertEndpointProfileRevision } from '../../src/infrastructure/repositories/prisma/prisma-profile-revision';

const describePostgres = process.env.PERSISTENCE_BACKEND === 'inmemory' ? describe.skip : describe;
type Revision = { snapshotRevision: string };

describePostgres('Database-owned endpoint snapshot revisions', () => {
  let writer: INestApplication;
  let reader: INestApplication;
  let prisma: PrismaService;
  let service: EndpointService;
  let token: string;
  let readerToken: string;
  let endpointId: string;
  let name: string;

  const revision = async (): Promise<string> => {
    const rows = await prisma.$queryRaw<Revision[]>`
      SELECT "snapshotRevision" FROM "public"."Endpoint" WHERE id = ${endpointId}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].snapshotRevision).toMatch(/^[a-f0-9-]{36}$/);
    return rows[0].snapshotRevision;
  };

  beforeAll(async () => {
    writer = await createTestApp();
    reader = await createTestApp();
    prisma = writer.get(PrismaService);
    service = reader.get(EndpointService);
    token = await getAuthToken(writer);
    readerToken = await getAuthToken(reader);
  });

  beforeEach(async () => {
    name = `revision-${randomUUID()}`;
    const response = await scimPost(writer, '/scim/admin/endpoints', token, {
      name, profilePreset: 'rfc-standard',
    }).expect(201);
    const body: unknown = response.body;
    if (typeof body !== 'object' || body === null || !('id' in body) || typeof body.id !== 'string') {
      throw new Error('Expected created endpoint id');
    }
    endpointId = body.id;
  });

  afterEach(async () => {
    if (endpointId) await prisma.endpoint.deleteMany({ where: { id: endpointId } });
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (reader) await reader.close();
    if (writer) await writer.close();
  });

  it('migrates a required database-generated revision and an always-enabled trigger', async () => {
    const columns = await prisma.$queryRaw<{ name: string; required: boolean; default: string }[]>`
      SELECT a.attname AS name, a.attnotnull AS required,
             pg_get_expr(d.adbin, d.adrelid) AS default
      FROM pg_attribute a
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = '"public"."Endpoint"'::regclass
        AND a.attname = 'snapshotRevision' AND NOT a.attisdropped
    `;
    expect(columns).toEqual([{
      name: 'snapshotRevision', required: true, default: 'gen_random_uuid()',
    }]);
    const triggers = await prisma.$queryRaw<{ enabled: string }[]>`
      SELECT tgenabled::text AS enabled FROM pg_trigger
      WHERE tgrelid = '"public"."Endpoint"'::regclass
        AND tgname = 'Endpoint_snapshot_revision'
    `;
    expect(triggers).toEqual([{ enabled: 'A' }]);
  });

  it('refreshes a peer after legacy ORM and direct SQL updates with unchanged timestamps', async () => {
    const path = `/scim/admin/endpoints/${endpointId}`;
    await scimGet(reader, path, readerToken).expect(200);
    const stored = await prisma.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
    const original = await revision();
    await prisma.endpoint.update({
      where: { id: endpointId },
      data: { displayName: 'Legacy writer', updatedAt: stored.updatedAt },
    });
    const changed = await revision();
    expect(changed).not.toBe(original);
    const first = await scimGet(reader, path, readerToken).expect(200);
    expect(first.body).toMatchObject({
      displayName: 'Legacy writer', updatedAt: stored.updatedAt.toISOString(),
    });
    await prisma.$executeRaw`
      UPDATE "public"."Endpoint" SET active = false WHERE id = ${endpointId}::uuid
    `;
    expect(await revision()).not.toBe(changed);
    const second = await scimGet(reader, path, readerToken).expect(200);
    expect(second.body).toMatchObject({
      active: false, updatedAt: stored.updatedAt.toISOString(),
    });
  });

  it('overrides explicitly supplied revision values, including replica-mode updates', async () => {
    const supplied = randomUUID();
    const before = await revision();
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const rows = await tx.$queryRaw<Revision[]>`
        UPDATE "public"."Endpoint"
        SET "snapshotRevision" = ${supplied}::uuid
        WHERE id = ${endpointId}::uuid
        RETURNING "snapshotRevision"
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].snapshotRevision).not.toBe(supplied);
      expect(rows[0].snapshotRevision).not.toBe(before);
    });
    expect(await revision()).not.toBe(before);
  });

  it('rolls back the revision together with a failed endpoint change', async () => {
    const before = await revision();
    const failure = new Error('Intentional endpoint revision rollback');
    await expect(prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Revision[]>`
        UPDATE "public"."Endpoint" SET active = false WHERE id = ${endpointId}::uuid
        RETURNING "snapshotRevision"
      `;
      expect(rows[0].snapshotRevision).not.toBe(before);
      throw failure;
    })).rejects.toBe(failure);
    expect(await revision()).toBe(before);
    expect((await service.getEndpoint(endpointId)).active).toBe(true);
  });

  it('does not reuse a revision when content changes and then reverts', async () => {
    const before = await revision();
    await prisma.$executeRaw`
      UPDATE "public"."Endpoint" SET description = 'Temporary value'
      WHERE id = ${endpointId}::uuid
    `;
    const intermediate = await revision();
    await prisma.$executeRaw`
      UPDATE "public"."Endpoint" SET description = NULL WHERE id = ${endpointId}::uuid
    `;
    const reverted = await revision();
    expect(new Set([before, intermediate, reverted]).size).toBe(3);
    expect((await service.getEndpoint(endpointId)).description).toBeUndefined();
  });

  it('assigns a new incarnation on delete and recreate even with a supplied old revision', async () => {
    await service.getEndpoint(endpointId);
    const before = await revision();
    await prisma.endpoint.delete({ where: { id: endpointId } });
    await prisma.$executeRaw`
      INSERT INTO "public"."Endpoint"
        (id, name, "snapshotRevision", "createdAt", "updatedAt")
      VALUES (${endpointId}::uuid, ${name}, ${before}::uuid, NOW(), NOW())
    `;
    expect(await revision()).not.toBe(before);
    const result = await service.getEndpoint(endpointId);
    expect(result.name).toBe(name);
    expect(result.profile).toBeNull();
  });

  it('retains matching, metadata-only and changed-profile checks on the profile-only path', async () => {
    const observed = await service.getEndpointForRequest(endpointId);
    expect(typeof observed.profileRevision).toBe('object');
    await prisma.$transaction(tx => assertEndpointProfileRevision(tx, endpointId, observed.profileRevision));
    await prisma.endpoint.update({ where: { id: endpointId }, data: { description: 'Metadata only' } });
    await prisma.$transaction(tx => assertEndpointProfileRevision(tx, endpointId, observed.profileRevision));
    await prisma.endpoint.update({ where: { id: endpointId }, data: { profile: { changed: true } } });
    await expect(prisma.$transaction(tx =>
      assertEndpointProfileRevision(tx, endpointId, observed.profileRevision)))
      .rejects.toMatchObject({ code: 'PROFILE_CHANGED' });
  });

  it('returns no database payload on a verified hit and never exposes the internal revision', async () => {
    await service.getEndpoint(endpointId);
    const query = jest.spyOn(reader.get(PrismaService), '$queryRaw');
    const result = await service.getEndpoint(endpointId);
    expect(query).toHaveBeenCalledTimes(1);
    await expect(query.mock.results[0].value).resolves.toEqual([{
      fingerprint: await revision(), endpoint: null,
    }]);
    const allowed = [
      'id', 'name', 'displayName', 'description', 'profile', 'profileSummary',
      'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links',
    ];
    for (const key of Object.keys(result)) expect(allowed).toContain(key);
    expect(result).toMatchObject({ id: endpointId, name, active: true });
    const response = await scimGet(reader, `/scim/admin/endpoints/${endpointId}`, readerToken).expect(200);
    const body: unknown = response.body;
    if (typeof body !== 'object' || body === null) throw new Error('Expected endpoint response object');
    for (const key of Object.keys(body)) expect(allowed).toContain(key);
    expect(body).toMatchObject({ id: endpointId, name, active: true });
  });
});
